use anchor_lang::prelude::*;

// agent_permissions/src/lib.rs
declare_id!("6cKABjL45MFFJPAZ9EbJJjNxbNRJpGUVhbJLFHako39R");

// ═══════════════════════════════════════════
// Seeds & Constants
// ═══════════════════════════════════════════
pub const PERM_STATE_SEED: &[u8] = b"perm_state";
pub const AGENT_IDENTITY_SEED: &[u8] = b"agent_id";
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const CIRCUIT_BREAKER_LOSS_BPS: u16 = 1000; // 10% triggers pause

// ═══════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════
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
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentIdentity {
    pub wallet: Pubkey,
    pub role: AgentRole,
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
    #[msg("System is paused by admin")]
    Paused,
    #[msg("Agent deactivated")]
    Deactivated,
    #[msg("Daily spending limit exceeded")]
    LimitExceeded,
    #[msg("Signer does not match agent identity")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Agent already registered")]
    AlreadyRegistered,
    #[msg("Invalid daily limit")]
    InvalidLimit,
    #[msg("Wrong agent role for this operation")]
    WrongRole,
}

// ═══════════════════════════════════════════
// Events
// ═══════════════════════════════════════════
#[event]
pub struct AgentRegistered { pub wallet: Pubkey, pub role: AgentRole, pub daily_limit: u64 }
#[event]
pub struct SpendRecorded { pub agent: Pubkey, pub amount: u64, pub daily_spent: u64, pub daily_limit: u64 }
#[event]
pub struct SystemPaused { pub admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct SystemUnpaused { pub admin: Pubkey, pub timestamp: i64 }
#[event]
pub struct AgentDeactivated { pub wallet: Pubkey, pub by: Pubkey }
#[event]
pub struct LimitUpdated { pub wallet: Pubkey, pub old_limit: u64, pub new_limit: u64 }

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
        s.bump = ctx.bumps.perm_state;
        Ok(())
    }

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        role: AgentRole,
        daily_limit: u64,
    ) -> Result<()> {
        require!(daily_limit > 0, PermError::InvalidLimit);

        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.agent_identity;
        a.wallet = ctx.accounts.agent_wallet.key();
        a.role = role;
        a.daily_limit = daily_limit;
        a.daily_spent = 0;
        a.limit_reset_epoch = now.checked_add(SECONDS_PER_DAY).ok_or(PermError::Overflow)?;
        a.is_active = true;
        a.registered_at = now;
        a.total_operations = 0;
        a.bump = ctx.bumps.agent_identity;

        let s = &mut ctx.accounts.perm_state;
        s.total_agents = s.total_agents.checked_add(1).ok_or(PermError::Overflow)?;

        emit!(AgentRegistered { wallet: a.wallet, role, daily_limit });
        Ok(())
    }

    /// CPI-callable: check spending limit and deduct.
    /// Called by LendingPool before disbursement.
    ///
    /// AUDIT:
    /// - Resets daily counter on epoch boundary
    /// - Cumulative tracking prevents split-transaction bypass
    /// - Checked arithmetic on all additions
    pub fn check_and_spend(ctx: Context<CheckAndSpend>, amount: u64) -> Result<()> {
        let s = &ctx.accounts.perm_state;
        require!(!s.is_paused, PermError::Paused);

        let a = &mut ctx.accounts.agent_identity;
        require!(a.is_active, PermError::Deactivated);

        let now = Clock::get()?.unix_timestamp;

        // AUDIT: Reset on new epoch
        if now >= a.limit_reset_epoch {
            a.daily_spent = 0;
            a.limit_reset_epoch = now.checked_add(SECONDS_PER_DAY).ok_or(PermError::Overflow)?;
        }

        // AUDIT: Cumulative check prevents split-tx bypass
        let new_spent = a.daily_spent.checked_add(amount).ok_or(PermError::Overflow)?;
        require!(new_spent <= a.daily_limit, PermError::LimitExceeded);

        a.daily_spent = new_spent;
        a.total_operations = a.total_operations.checked_add(1).ok_or(PermError::Overflow)?;

        emit!(SpendRecorded {
            agent: a.wallet, amount, daily_spent: a.daily_spent, daily_limit: a.daily_limit,
        });
        Ok(())
    }

    /// Verify an agent has a specific role. View-like, no state change.
    pub fn verify_role(ctx: Context<VerifyRole>, expected_role: AgentRole) -> Result<()> {
        let a = &ctx.accounts.agent_identity;
        require!(a.is_active, PermError::Deactivated);
        require!(a.role == expected_role, PermError::WrongRole);
        require!(!ctx.accounts.perm_state.is_paused, PermError::Paused);
        Ok(())
    }

    pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
        let s = &mut ctx.accounts.perm_state;
        s.is_paused = true;
        s.pause_timestamp = Clock::get()?.unix_timestamp;
        emit!(SystemPaused { admin: ctx.accounts.admin.key(), timestamp: s.pause_timestamp });
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.perm_state.is_paused = false;
        emit!(SystemUnpaused { admin: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
        Ok(())
    }

    pub fn set_daily_limit(ctx: Context<UpdateAgent>, new_limit: u64) -> Result<()> {
        require!(new_limit > 0, PermError::InvalidLimit);
        let a = &mut ctx.accounts.agent_identity;
        let old = a.daily_limit;
        a.daily_limit = new_limit;
        emit!(LimitUpdated { wallet: a.wallet, old_limit: old, new_limit });
        Ok(())
    }

    pub fn deactivate_agent(ctx: Context<UpdateAgent>) -> Result<()> {
        let a = &mut ctx.accounts.agent_identity;
        a.is_active = false;
        emit!(AgentDeactivated { wallet: a.wallet, by: ctx.accounts.admin.key() });
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
pub struct CheckAndSpend<'info> {
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
pub struct VerifyRole<'info> {
    #[account(seeds = [PERM_STATE_SEED], bump = perm_state.bump)]
    pub perm_state: Account<'info, PermState>,
    #[account(
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
pub struct UpdateAgent<'info> {
    #[account(seeds = [PERM_STATE_SEED], bump = perm_state.bump, has_one = admin)]
    pub perm_state: Account<'info, PermState>,
    #[account(mut)]
    pub agent_identity: Account<'info, AgentIdentity>,
    pub admin: Signer<'info>,
}
