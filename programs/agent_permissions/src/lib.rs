use anchor_lang::prelude::*;

declare_id!("57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG");

// ═══════════════════════════════════════════
// Seeds & Constants
// ═══════════════════════════════════════════
pub const PERM_STATE_SEED: &[u8] = b"perm_state";
pub const AGENT_IDENTITY_SEED: &[u8] = b"agent_id";
pub const ROTATION_REQUEST_SEED: &[u8] = b"rotation";
pub const SECONDS_PER_DAY: i64 = 86_400;

/// T4A.3: Circuit breaker triggers if pool losses exceed this ratio
/// in the trailing 24h window. 1000 = 10%.
pub const CIRCUIT_BREAKER_LOSS_BPS: u16 = 1000;

/// T4A.5: Admin key rotation requires a 48-hour time lock.
/// New admin cannot act until this delay has elapsed.
pub const ROTATION_DELAY_SECS: i64 = 172_800; // 48 hours

// ═══════════════════════════════════════════
// T4A.1: 4-Tier Permission Model
// ═══════════════════════════════════════════
//
// Tier 0 — READ:   Query balances, scores, pool state. No tx.
// Tier 1 — OPERATE: Send tokens, pull installments, push scores.
// Tier 2 — MANAGE:  Disburse loans, lock collateral, create schedules,
//                    bridge capital, adjust rates.
// Tier 3 — ADMIN:   Register/deactivate agents, pause/unpause,
//                    set limits, rotate admin key. HUMAN-ONLY.
//
// Each agent has exactly one tier. Higher tier has all lower permissions.
// Tier is checked on every CPI call via check_permission.

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PermissionTier {
    Read    = 0,
    Operate = 1,
    Manage  = 2,
    Admin   = 3,
}

impl PermissionTier {
    /// AUDIT: Tier comparison — higher tier has all lower permissions.
    pub fn has_permission(&self, required: &PermissionTier) -> bool {
        (*self as u8) >= (*required as u8)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AgentRole { Oracle, Lending, Collection, Yield }

// ═══════════════════════════════════════════
// Accounts
// ═══════════════════════════════════════════

#[account]
#[derive(InitSpace)]
pub struct PermState {
    pub admin: Pubkey,
    pub is_paused: bool,
    pub pause_timestamp: i64,
    pub total_agents: u32,
    /// T4A.3: Circuit breaker state
    pub circuit_breaker_active: bool,
    pub losses_24h: u64,
    pub deposits_snapshot: u64,
    pub snapshot_timestamp: i64,
    /// T4A.5: Pending admin rotation
    pub pending_admin: Pubkey,
    pub rotation_request_time: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentIdentity {
    pub wallet: Pubkey,
    pub role: AgentRole,
    pub tier: PermissionTier,
    pub daily_limit: u64,
    pub daily_spent: u64,
    pub limit_reset_epoch: i64,
    pub is_active: bool,
    pub registered_at: i64,
    pub total_operations: u64,
    pub bump: u8,
}

// ═══════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════

#[error_code]
pub enum PermError {
    #[msg("System is paused by admin or circuit breaker")]
    Paused,
    #[msg("Circuit breaker tripped: pool losses exceed 10% in 24h")]
    CircuitBreakerTripped,
    #[msg("Agent deactivated")]
    Deactivated,
    #[msg("Daily spending limit exceeded")]
    LimitExceeded,
    #[msg("Signer does not match agent identity")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid daily limit")]
    InvalidLimit,
    #[msg("Insufficient permission tier for this operation")]
    InsufficientTier,
    #[msg("Admin rotation time lock has not elapsed (48h required)")]
    RotationTimeLockActive,
    #[msg("No pending admin rotation to finalize")]
    NoPendingRotation,
    #[msg("Only Tier 3 (Admin) can perform this action")]
    AdminOnly,
    #[msg("Cannot set tier to Admin via register — use admin rotation")]
    CannotGrantAdmin,
    #[msg("Agent role does not match the required operation role")]
    WrongRole,
}

// ═══════════════════════════════════════════
// Events
// ═══════════════════════════════════════════

#[event]
pub struct AgentRegistered { pub wallet: Pubkey, pub role: AgentRole, pub tier: PermissionTier, pub daily_limit: u64 }
#[event]
pub struct SpendRecorded { pub agent: Pubkey, pub amount: u64, pub daily_spent: u64, pub daily_limit: u64, pub tier: PermissionTier }
#[event]
pub struct PermissionChecked { pub agent: Pubkey, pub required_tier: u8, pub agent_tier: u8, pub allowed: bool }
#[event]
pub struct CircuitBreakerTripped { pub losses: u64, pub deposits: u64, pub loss_bps: u16, pub timestamp: i64 }
#[event]
pub struct CircuitBreakerReset { pub admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct AdminRotationRequested { pub current_admin: Pubkey, pub new_admin: Pubkey, pub effective_after: i64 }
#[event]
pub struct AdminRotationFinalized { pub old_admin: Pubkey, pub new_admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct AdminRotationCancelled { pub admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct SystemPaused { pub admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct SystemUnpaused { pub admin: Pubkey, pub timestamp: i64 }

// ═══════════════════════════════════════════
// Program
// ═══════════════════════════════════════════

#[program]
pub mod agent_permissions {
    use super::*;

    pub fn initialize(ctx: Context<InitPerms>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        s.admin = ctx.accounts.admin.key();
        s.is_paused = false;
        s.pause_timestamp = 0;
        s.total_agents = 0;
        s.circuit_breaker_active = false;
        s.losses_24h = 0;
        s.deposits_snapshot = 0;
        s.snapshot_timestamp = Clock::get()?.unix_timestamp;
        s.pending_admin = Pubkey::default();
        s.rotation_request_time = 0;
        s.bump = ctx.bumps.perm_state;
        Ok(())
    }

    /// T4A.1: Register agent with explicit permission tier.
    /// AUDIT: Cannot grant Tier 3 (Admin) via this instruction.
    /// Admin privileges require the time-locked rotation flow.
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        role: AgentRole,
        tier: PermissionTier,
        daily_limit: u64,
    ) -> Result<()> {
        require!(daily_limit > 0, PermError::InvalidLimit);
        // AUDIT: Cannot grant Admin tier through register_agent
        require!(tier != PermissionTier::Admin, PermError::CannotGrantAdmin);

        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.agent_identity;
        a.wallet = ctx.accounts.agent_wallet.key();
        a.role = role;
        a.tier = tier;
        a.daily_limit = daily_limit;
        a.daily_spent = 0;
        a.limit_reset_epoch = now.checked_add(SECONDS_PER_DAY).ok_or(PermError::Overflow)?;
        a.is_active = true;
        a.registered_at = now;
        a.total_operations = 0;
        a.bump = ctx.bumps.agent_identity;

        let s = &mut ctx.accounts.perm_state;
        s.total_agents = s.total_agents.checked_add(1).ok_or(PermError::Overflow)?;

        emit!(AgentRegistered { wallet: a.wallet, role, tier, daily_limit });
        Ok(())
    }

    /// T4A.1: Check permission tier AND spending limit in one CPI call.
    /// Called by lending_pool.conditional_disburse before disbursement.
    ///
    /// AUDIT:
    /// - Checks pause state (manual + circuit breaker)
    /// - Checks agent is active
    /// - Checks tier >= required_tier
    /// - Resets daily counter on epoch boundary
    /// - Cumulative spend check prevents split-tx bypass
    /// - All checks atomic — either all pass or entire tx reverts
    pub fn check_permission_and_spend(
        ctx: Context<CheckPermissionAndSpend>,
        required_role: AgentRole,
        required_tier: PermissionTier,
        amount: u64,
    ) -> Result<()> {
        let s = &ctx.accounts.perm_state;

        // AUDIT: Check both manual pause AND circuit breaker
        require!(!s.is_paused, PermError::Paused);
        require!(!s.circuit_breaker_active, PermError::CircuitBreakerTripped);

        let a = &mut ctx.accounts.agent_identity;
        require!(a.is_active, PermError::Deactivated);
        require!(a.role == required_role, PermError::WrongRole);

        // T4A.1: Tier check
        require!(
            a.tier.has_permission(&required_tier),
            PermError::InsufficientTier
        );

        emit!(PermissionChecked {
            agent: a.wallet,
            required_tier: required_tier as u8,
            agent_tier: a.tier as u8,
            allowed: true,
        });

        // Spending limit check (only if amount > 0)
        if amount > 0 {
            let now = Clock::get()?.unix_timestamp;

            // Reset on new epoch
            if now >= a.limit_reset_epoch {
                a.daily_spent = 0;
                a.limit_reset_epoch = now.checked_add(SECONDS_PER_DAY).ok_or(PermError::Overflow)?;
            }

            let new_spent = a.daily_spent.checked_add(amount).ok_or(PermError::Overflow)?;
            require!(new_spent <= a.daily_limit, PermError::LimitExceeded);

            a.daily_spent = new_spent;
            a.total_operations = a.total_operations.checked_add(1).ok_or(PermError::Overflow)?;

            emit!(SpendRecorded {
                agent: a.wallet, amount, daily_spent: a.daily_spent,
                daily_limit: a.daily_limit, tier: a.tier,
            });
        }

        Ok(())
    }

    // ═══════════════════════════════════════
    // T4A.3: Circuit Breaker
    // ═══════════════════════════════════════

    /// Record a loss event (default, liquidation shortfall).
    /// Admin-only until a dedicated trusted caller path is implemented.
    /// Auto-pauses if cumulative 24h losses exceed 10% of deposits snapshot.
    ///
    /// AUDIT:
    /// - Rolling 24h window: resets snapshot if > 24h since last snapshot
    /// - Loss ratio calculated with checked arithmetic
    /// - Circuit breaker can only be reset by admin (manual review required)
    pub fn record_loss(ctx: Context<AdminOnly>, loss_amount: u64, current_deposits: u64) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        let now = Clock::get()?.unix_timestamp;

        // Reset window if > 24h since snapshot
        let window_elapsed = now.saturating_sub(s.snapshot_timestamp);
        if window_elapsed > SECONDS_PER_DAY {
            s.losses_24h = 0;
            s.deposits_snapshot = current_deposits;
            s.snapshot_timestamp = now;
        }

        // Accumulate loss
        s.losses_24h = s.losses_24h.checked_add(loss_amount).ok_or(PermError::Overflow)?;

        // Check circuit breaker threshold
        if s.deposits_snapshot > 0 {
            // loss_bps = (losses_24h * 10000) / deposits_snapshot
            let loss_bps = (s.losses_24h as u128)
                .checked_mul(10_000)
                .and_then(|v| v.checked_div(s.deposits_snapshot as u128))
                .unwrap_or(0) as u16;

            if loss_bps >= CIRCUIT_BREAKER_LOSS_BPS {
                s.circuit_breaker_active = true;
                s.is_paused = true;
                s.pause_timestamp = now;

                emit!(CircuitBreakerTripped {
                    losses: s.losses_24h,
                    deposits: s.deposits_snapshot,
                    loss_bps,
                    timestamp: now,
                });
            }
        }

        Ok(())
    }

    /// Admin resets circuit breaker after manual review.
    /// AUDIT: Only admin (Tier 3) can reset. Resets loss counter.
    pub fn reset_circuit_breaker(ctx: Context<AdminOnly>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        s.circuit_breaker_active = false;
        s.losses_24h = 0;
        s.snapshot_timestamp = Clock::get()?.unix_timestamp;
        // Note: is_paused stays as-is — admin must explicitly unpause

        emit!(CircuitBreakerReset {
            admin: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    // ═══════════════════════════════════════
    // T4A.4: Escrow-Preserving Pause
    // ═══════════════════════════════════════

    /// Pause all lending operations.
    /// AUDIT: Escrow PDAs remain locked — funds are safe.
    /// Only new disbursements and pulls are halted.
    /// Borrowers can still repay (repay checks pause separately).
    pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        s.is_paused = true;
        s.pause_timestamp = Clock::get()?.unix_timestamp;
        emit!(SystemPaused { admin: ctx.accounts.admin.key(), timestamp: s.pause_timestamp });
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        // AUDIT: Cannot unpause while circuit breaker is active
        // Admin must first reset_circuit_breaker, then unpause
        require!(!s.circuit_breaker_active, PermError::CircuitBreakerTripped);
        s.is_paused = false;
        emit!(SystemUnpaused { admin: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    // ═══════════════════════════════════════
    // T4A.5: Time-Locked Admin Rotation
    // ═══════════════════════════════════════

    /// Step 1: Current admin requests rotation to new admin.
    /// Starts 48-hour time lock. No immediate effect.
    pub fn request_admin_rotation(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        let now = Clock::get()?.unix_timestamp;
        let effective_after = now.checked_add(ROTATION_DELAY_SECS).ok_or(PermError::Overflow)?;

        s.pending_admin = new_admin;
        s.rotation_request_time = now;

        emit!(AdminRotationRequested {
            current_admin: s.admin,
            new_admin,
            effective_after,
        });
        Ok(())
    }

    /// Step 2: Finalize rotation after 48h time lock.
    /// AUDIT: Can be called by EITHER old or new admin (both should agree).
    /// Time lock ensures community/team has 48h to notice and cancel if compromised.
    pub fn finalize_admin_rotation(ctx: Context<FinalizeRotation>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        let now = Clock::get()?.unix_timestamp;

        // Must have a pending rotation
        require!(s.pending_admin != Pubkey::default(), PermError::NoPendingRotation);

        // 48h must have elapsed
        let elapsed = now.saturating_sub(s.rotation_request_time);
        require!(elapsed >= ROTATION_DELAY_SECS, PermError::RotationTimeLockActive);

        let old_admin = s.admin;
        s.admin = s.pending_admin;
        s.pending_admin = Pubkey::default();
        s.rotation_request_time = 0;

        emit!(AdminRotationFinalized { old_admin, new_admin: s.admin, timestamp: now });
        Ok(())
    }

    /// Cancel a pending rotation (only current admin).
    pub fn cancel_admin_rotation(ctx: Context<AdminOnly>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        s.pending_admin = Pubkey::default();
        s.rotation_request_time = 0;
        emit!(AdminRotationCancelled { admin: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    // ═══════════════════════════════════════
    // Agent Management
    // ═══════════════════════════════════════

    pub fn set_daily_limit(ctx: Context<UpdateAgent>, new_limit: u64) -> Result<()> {
        require!(new_limit > 0, PermError::InvalidLimit);
        ctx.accounts.agent_identity.daily_limit = new_limit;
        Ok(())
    }

    pub fn set_agent_tier(ctx: Context<UpdateAgent>, new_tier: PermissionTier) -> Result<()> {
        require!(new_tier != PermissionTier::Admin, PermError::CannotGrantAdmin);
        ctx.accounts.agent_identity.tier = new_tier;
        Ok(())
    }

    pub fn deactivate_agent(ctx: Context<UpdateAgent>) -> Result<()> {
        ctx.accounts.agent_identity.is_active = false;
        Ok(())
    }
}

// ═══════════════════════════════════════════
// Instruction Contexts
// ═══════════════════════════════════════════

#[derive(Accounts)]
pub struct InitPerms<'info> {
    #[account(init, payer = admin, space = 8 + PermState::INIT_SPACE, seeds = [PERM_STATE_SEED], bump)]
    pub perm_state: Account<'info, PermState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(mut, seeds = [PERM_STATE_SEED], bump = perm_state.bump, has_one = admin)]
    pub perm_state: Account<'info, PermState>,
    #[account(
        init, payer = admin, space = 8 + AgentIdentity::INIT_SPACE,
        seeds = [AGENT_IDENTITY_SEED, agent_wallet.key().as_ref()], bump,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,
    /// CHECK: Agent wallet being registered.
    pub agent_wallet: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckPermissionAndSpend<'info> {
    #[account(seeds = [PERM_STATE_SEED], bump = perm_state.bump)]
    pub perm_state: Account<'info, PermState>,
    #[account(
        mut,
        seeds = [AGENT_IDENTITY_SEED, agent_signer.key().as_ref()],
        bump = agent_identity.bump,
        constraint = agent_identity.wallet == agent_signer.key() @ PermError::Unauthorized,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,
    pub agent_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [PERM_STATE_SEED], bump = perm_state.bump, has_one = admin)]
    pub perm_state: Account<'info, PermState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeRotation<'info> {
    #[account(
        mut, seeds = [PERM_STATE_SEED], bump = perm_state.bump,
        // Either current admin OR pending admin can finalize
        constraint = (
            perm_state.admin == finalizer.key() ||
            perm_state.pending_admin == finalizer.key()
        ) @ PermError::Unauthorized,
    )]
    pub perm_state: Account<'info, PermState>,
    pub finalizer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(seeds = [PERM_STATE_SEED], bump = perm_state.bump, has_one = admin)]
    pub perm_state: Account<'info, PermState>,
    #[account(mut)]
    pub agent_identity: Account<'info, AgentIdentity>,
    pub admin: Signer<'info>,
}
