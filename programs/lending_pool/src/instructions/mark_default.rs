use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LendError;
use crate::events::LoanDefaulted;

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
    /// Collection agent or anyone (after grace period, permissionless)
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<MarkDefault>) -> Result<()> {
    let loan = &ctx.accounts.loan;
    let now = Clock::get()?.unix_timestamp;

    // AUDIT: Cannot default before grace period expires
    let default_threshold = loan.due_date
        .checked_add(GRACE_PERIOD_SECS)
        .ok_or(LendError::Overflow)?;
    require!(now > default_threshold, LendError::GracePeriodActive);

    let outstanding = loan.principal.saturating_sub(loan.repaid_amount);

    // Update loan
    let loan = &mut ctx.accounts.loan;
    loan.status = LoanStatus::Defaulted;

    // Update pool
    let p = &mut ctx.accounts.pool_state;
    p.total_borrowed = p.total_borrowed.saturating_sub(loan.principal);
    p.total_defaults = p.total_defaults
        .checked_add(outstanding)
        .ok_or(LendError::Overflow)?;
    p.active_loans = p.active_loans.saturating_sub(1);

    emit!(LoanDefaulted {
        loan_id: loan.loan_id, borrower: loan.borrower, outstanding,
    });
    Ok(())
}
