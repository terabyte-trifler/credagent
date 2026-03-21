use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

// lending_pool/src/lib.rs
declare_id!("8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid");

#[program]
pub mod lending_pool {
    use super::*;

    // ═══════════════════════════════════
    // Pool Management
    // ═══════════════════════════════════

    pub fn initialize_pool(ctx: Context<InitializePool>, base_rate_bps: u16) -> Result<()> {
        instructions::initialize_pool::handler(ctx, base_rate_bps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::deposit::handler_withdraw(ctx, amount)
    }

    // ═══════════════════════════════════
    // 7 Payment Primitives
    // ═══════════════════════════════════

    /// PRIMITIVE 1: Lock collateral in escrow PDA
    pub fn lock_collateral(ctx: Context<LockCollateral>, loan_id: u64, amount: u64) -> Result<()> {
        instructions::lock_collateral::handler(ctx, loan_id, amount)
    }

    /// PRIMITIVE 2: Atomic 4-gate conditional disbursement
    pub fn conditional_disburse(
        ctx: Context<ConditionalDisburse>,
        principal: u64,
        interest_rate_bps: u16,
        duration_days: u16,
        decision_hash: [u8; 32],
    ) -> Result<()> {
        instructions::conditional_disburse::handler(ctx, principal, interest_rate_bps, duration_days, decision_hash)
    }

    /// PRIMITIVE 3: Create installment repayment schedule
    pub fn create_schedule(
        ctx: Context<CreateSchedule>,
        num_installments: u8,
        interval_secs: i64,
    ) -> Result<()> {
        instructions::create_schedule::handler_create(ctx, num_installments, interval_secs)
    }

    /// PRIMITIVE 4: Collection agent pulls scheduled installment
    pub fn pull_installment(ctx: Context<PullInstallment>) -> Result<()> {
        instructions::create_schedule::handler_pull(ctx)
    }

    /// PRIMITIVE 5: Accrue per-epoch streaming interest
    pub fn accrue_interest(ctx: Context<AccrueInterest>) -> Result<()> {
        instructions::accrue_interest::handler(ctx)
    }

    /// PRIMITIVE 6: Release collateral back to borrower (loan fully repaid)
    pub fn release_collateral(ctx: Context<ReleaseCollateral>) -> Result<()> {
        instructions::release_collateral::handler(ctx)
    }

    /// PRIMITIVE 7: Liquidate escrow collateral (loan defaulted)
    pub fn liquidate_escrow(ctx: Context<LiquidateEscrow>) -> Result<()> {
        instructions::liquidate_escrow::handler(ctx)
    }

    // ═══════════════════════════════════
    // Repayment & Default
    // ═══════════════════════════════════

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::handler(ctx, amount)
    }

    pub fn mark_default(ctx: Context<MarkDefault>) -> Result<()> {
        instructions::mark_default::handler(ctx)
    }
}
