use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LendError;
use crate::events::{LiquidationIntentReady, LoanDefaulted};
use crate::instructions::accrue_interest;

/// Mark a loan as defaulted. Only callable after due_date + grace_period.
///
/// AUDIT:
/// - Verifies loan is Active (not already defaulted/repaid)
/// - Verifies current time > due_date + GRACE_PERIOD_SECS
/// - Updates pool stats (total_borrowed, total_defaults, active_loans)
/// - Does NOT liquidate escrow — that's a separate permissionless call
#[derive(Accounts)]
pub struct MarkDefault<'info> {
    #[account(
        mut, seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        mut,
        constraint = loan.status == LoanStatus::Active @ LendError::NotActive,
        constraint = loan.pool == pool_state.key(),
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        constraint = loan.escrow == escrow_state.key(),
    )]
    pub escrow_state: Account<'info, EscrowVaultState>,
    /// Collection agent or anyone (after grace period, permissionless)
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<MarkDefault>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool_state.key();
    {
        let pool = &mut ctx.accounts.pool_state;
        accrue_interest::accrue_pool_state(pool, pool_key, now)?;
    }

    let loan = &ctx.accounts.loan;

    // AUDIT: Cannot default before grace period expires
    let default_threshold = loan.due_date
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(LendError::Overflow)?;
    require!(now > default_threshold, LendError::GracePeriodActive);

    let total_owed = accrue_interest::total_owed(loan, ctx.accounts.pool_state.interest_index)?;
    let debt_outstanding = total_owed
        .checked_sub(loan.repaid_amount)
        .ok_or(LendError::Overflow)?;
    let minimum_recovery_target = compute_minimum_recovery_target(debt_outstanding)
        .ok_or(LendError::Overflow)?;
    let intent_expiry = now
        .checked_add(DEFAULT_INTENT_TTL_SECS)
        .ok_or(LendError::Overflow)?;

    // Update loan
    let loan = &mut ctx.accounts.loan;
    loan.status = LoanStatus::Defaulted;

    // Update pool
    let p = &mut ctx.accounts.pool_state;
    p.total_borrowed = p.total_borrowed.checked_sub(loan.principal).ok_or(LendError::Overflow)?;
    p.total_defaults = p.total_defaults
        .checked_add(debt_outstanding)
        .ok_or(LendError::Overflow)?;
    p.total_deposited = p.total_deposited
        .checked_sub(debt_outstanding)
        .ok_or(LendError::Overflow)?;
    p.active_loans = p.active_loans.checked_sub(1).ok_or(LendError::Overflow)?;

    emit!(LoanDefaulted {
        loan_id: loan.loan_id, borrower: loan.borrower, outstanding: debt_outstanding,
    });

    emit!(LiquidationIntentReady {
        loan_id: loan.loan_id,
        pool: loan.pool,
        borrower: loan.borrower,
        collateral_mint: ctx.accounts.escrow_state.collateral_mint,
        collateral_amount: ctx.accounts.escrow_state.collateral_amount,
        debt_outstanding,
        minimum_recovery_target,
        liquidation_mode: LiquidationMode::Immediate,
        liquidation_urgency: LiquidationUrgency::High,
        intent_expiry,
        nonce: loan.loan_id,
        target_chain_id: EVM_TARGET_CHAIN_ID,
    });
    Ok(())
}
