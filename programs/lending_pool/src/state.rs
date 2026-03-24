use anchor_lang::prelude::*;

// ═══════════════════════════════════════════
// PDA Seeds
// ═══════════════════════════════════════════
pub const POOL_SEED: &[u8] = b"pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const LOAN_SEED: &[u8] = b"loan";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const ESCROW_VAULT_SEED: &[u8] = b"escrow_vault";
pub const SCHEDULE_SEED: &[u8] = b"schedule";

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════
pub const MAX_INTEREST_RATE_BPS: u16 = 5000;
pub const MAX_LOAN_DURATION_DAYS: u16 = 365;
pub const GRACE_PERIOD_SECS: i64 = 259_200;      // 3 days
pub const MAX_UTILIZATION_BPS: u16 = 8000;        // 80%
pub const MAX_INSTALLMENTS: u8 = 52;              // weekly for 1 year
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const SECONDS_PER_YEAR: u128 = 31_536_000;
pub const DEFAULT_INTENT_TTL_SECS: i64 = 1_800;   // 30 minutes
pub const LIQUIDATION_PENALTY_BPS: u16 = 300;     // 3.0%
pub const PROTOCOL_FEE_BPS: u16 = 50;             // 0.5%
pub const EVM_TARGET_CHAIN_ID: u64 = 1;           // Ethereum mainnet semantics for MVP
/// Precision multiplier for interest index (1e18)
pub const PRECISION: u128 = 1_000_000_000_000_000_000;

// ═══════════════════════════════════════════
// Enums
// ═══════════════════════════════════════════
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LoanStatus { Active, Repaid, Defaulted, Liquidated }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus { Locked, Released, Liquidated }

/// Cross-chain liquidation execution policy chosen at default time.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LiquidationMode {
    Immediate,
    Partial,
    Urgent,
}

/// Severity hint used by the relayer and EVM config contract.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LiquidationUrgency {
    Low,
    Medium,
    High,
}

// ═══════════════════════════════════════════
// Accounts
// ═══════════════════════════════════════════

/// Global pool state per token mint.
/// PDA: [POOL_SEED, token_mint]
#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub total_deposited: u64,
    pub total_borrowed: u64,
    pub total_interest_earned: u64,
    pub total_defaults: u64,
    pub active_loans: u32,
    pub total_loans_issued: u32,
    pub next_loan_id: u64,
    pub base_rate_bps: u16,
    pub max_utilization_bps: u16,
    /// Cumulative interest index (scaled by PRECISION=1e18)
    pub interest_index: u128,
    pub last_update_ts: i64,
    pub is_paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Individual loan account.
/// PDA: [LOAN_SEED, pool, loan_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub loan_id: u64,
    pub pool: Pubkey,
    pub borrower: Pubkey,
    pub lending_agent: Pubkey,
    pub principal: u64,
    pub interest_rate_bps: u16,
    pub start_time: i64,
    pub due_date: i64,
    pub repaid_amount: u64,
    pub status: LoanStatus,
    pub escrow: Pubkey,
    pub schedule: Pubkey,
    pub agent_decision_hash: [u8; 32],
    /// Snapshot of pool interest_index at loan creation
    pub index_snapshot: u128,
    pub bump: u8,
}

/// Escrow vault metadata. Actual tokens held in associated token PDA.
/// PDA: [ESCROW_SEED, loan_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct EscrowVaultState {
    pub loan_id: u64,
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub status: EscrowStatus,
    pub locked_at: i64,
    pub released_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

/// Installment schedule for automated repayment.
/// PDA: [SCHEDULE_SEED, loan_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct InstallmentSchedule {
    pub loan_id: u64,
    pub borrower: Pubkey,
    pub pool: Pubkey,
    pub total_installments: u8,
    pub paid_installments: u8,
    pub amount_per_installment: u64,
    pub interval_secs: i64,
    pub next_due_date: i64,
    pub collection_agent: Pubkey,
    pub is_active: bool,
    pub bump: u8,
}

// ═══════════════════════════════════════════
// Interest Math Helpers
// ═══════════════════════════════════════════

/// Calculate updated interest index based on elapsed time.
/// Uses: new_index = old_index + (old_index * rate * dt) / (YEAR * BPS)
///
/// AUDIT: All operations use checked arithmetic. Returns None on overflow.
pub fn compute_new_index(
    current_index: u128,
    rate_bps: u16,
    elapsed_secs: i64,
) -> Option<u128> {
    if elapsed_secs <= 0 || rate_bps == 0 {
        return Some(current_index);
    }
    let dt = elapsed_secs as u128;
    let rate = rate_bps as u128;

    // interest_delta = current_index * rate * dt / (SECONDS_PER_YEAR * BPS_DENOMINATOR)
    let numerator = current_index.checked_mul(rate)?.checked_mul(dt)?;
    let denominator = SECONDS_PER_YEAR.checked_mul(BPS_DENOMINATOR)?;
    let delta = numerator.checked_div(denominator)?;

    current_index.checked_add(delta)
}

/// Calculate interest owed on a loan since its snapshot.
/// owed = principal * (current_index - snapshot_index) / PRECISION
pub fn compute_interest_owed(
    principal: u64,
    current_index: u128,
    snapshot_index: u128,
) -> Option<u64> {
    if current_index <= snapshot_index {
        return Some(0);
    }
    let index_diff = current_index.checked_sub(snapshot_index)?;
    let interest = (principal as u128)
        .checked_mul(index_diff)?
        .checked_div(PRECISION)?;
    // AUDIT: Safe cast — interest should be << u64::MAX for reasonable loans
    u64::try_from(interest).ok()
}

/// Minimum stablecoin proceeds that must be recovered for the default intent.
pub fn compute_minimum_recovery_target(debt_outstanding: u64) -> Option<u64> {
    let retained_bps = BPS_DENOMINATOR
        .checked_sub(LIQUIDATION_PENALTY_BPS as u128)?
        .checked_sub(PROTOCOL_FEE_BPS as u128)?;
    let recovery = (debt_outstanding as u128)
        .checked_mul(retained_bps)?
        .checked_div(BPS_DENOMINATOR)?;
    u64::try_from(recovery).ok()
}

/// Pool utilization in basis points.
pub fn utilization_bps(deposited: u64, borrowed: u64) -> u16 {
    if deposited == 0 { return 0; }
    let util = (borrowed as u128)
        .saturating_mul(10_000)
        .checked_div(deposited as u128)
        .unwrap_or(10_000);
    core::cmp::min(util, 10_000) as u16
}
