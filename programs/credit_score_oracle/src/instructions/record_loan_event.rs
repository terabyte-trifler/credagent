use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::OracleError;
use crate::events::CreditHistoryUpdated;

#[derive(Accounts)]
pub struct RecordLoanEvent<'info> {
    #[account(
        seeds = [ORACLE_STATE_SEED],
        bump = oracle_state.bump,
        constraint = oracle_state.admin == authority.key() @ OracleError::OracleNotAuthorized,
    )]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + CreditHistory::INIT_SPACE,
        seeds = [CREDIT_HISTORY_SEED, borrower.key().as_ref()],
        bump,
    )]
    pub credit_history: Account<'info, CreditHistory>,
    /// CHECK: Borrower whose history is updated.
    pub borrower: UncheckedAccount<'info>,
    // AUDIT: In production, restrict via CPI caller check to lending_pool only.
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_issued(ctx: Context<RecordLoanEvent>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.oracle_state.is_paused, OracleError::OraclePaused);
    let h = &mut ctx.accounts.credit_history;
    let now = Clock::get()?.unix_timestamp;

    if h.first_loan_date == 0 {
        h.first_loan_date = now;
    }
    h.borrower = ctx.accounts.borrower.key();
    h.total_loans = h.total_loans.checked_add(1).ok_or(OracleError::ArithmeticOverflow)?;
    h.total_borrowed = h.total_borrowed.checked_add(amount).ok_or(OracleError::ArithmeticOverflow)?;
    h.last_activity = now;
    h.bump = ctx.bumps.credit_history;

    emit!(CreditHistoryUpdated {
        borrower: h.borrower, event_type: 0, amount,
        total_loans: h.total_loans, repaid_loans: h.repaid_loans, defaulted_loans: h.defaulted_loans,
    });
    Ok(())
}

pub fn handler_repaid(ctx: Context<RecordLoanEvent>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.oracle_state.is_paused, OracleError::OraclePaused);
    let h = &mut ctx.accounts.credit_history;
    h.repaid_loans = h.repaid_loans.checked_add(1).ok_or(OracleError::ArithmeticOverflow)?;
    h.total_repaid = h.total_repaid.checked_add(amount).ok_or(OracleError::ArithmeticOverflow)?;
    h.last_activity = Clock::get()?.unix_timestamp;

    emit!(CreditHistoryUpdated {
        borrower: h.borrower, event_type: 1, amount,
        total_loans: h.total_loans, repaid_loans: h.repaid_loans, defaulted_loans: h.defaulted_loans,
    });
    Ok(())
}

pub fn handler_defaulted(ctx: Context<RecordLoanEvent>) -> Result<()> {
    require!(!ctx.accounts.oracle_state.is_paused, OracleError::OraclePaused);
    let h = &mut ctx.accounts.credit_history;
    h.defaulted_loans = h.defaulted_loans.checked_add(1).ok_or(OracleError::ArithmeticOverflow)?;
    h.last_activity = Clock::get()?.unix_timestamp;

    emit!(CreditHistoryUpdated {
        borrower: h.borrower, event_type: 2, amount: 0,
        total_loans: h.total_loans, repaid_loans: h.repaid_loans, defaulted_loans: h.defaulted_loans,
    });
    Ok(())
}
