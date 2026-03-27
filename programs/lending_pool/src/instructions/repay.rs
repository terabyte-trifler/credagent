use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::{LoanRepaid, LoanFullyRepaid};
use crate::instructions::accrue_interest;

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(
        mut, seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        mut, seeds = [POOL_VAULT_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.vault_bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = loan.status == LoanStatus::Active @ LendError::NotActive,
        constraint = loan.pool == pool_state.key(),
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        mut,
        constraint = borrower_ata.mint == pool_state.token_mint @ LendError::MintMismatch,
    )]
    pub borrower_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, LendError::ZeroAmount);

    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool_state.key();
    {
        let pool = &mut ctx.accounts.pool_state;
        accrue_interest::accrue_pool_state(pool, pool_key, now)?;
    }

    // Calculate total owed with streamed interest
    let total = accrue_interest::total_owed(&ctx.accounts.loan, ctx.accounts.pool_state.interest_index)?;
    let remaining = total.checked_sub(ctx.accounts.loan.repaid_amount).ok_or(LendError::Overflow)?;

    // AUDIT: Cap payment at remaining balance (no overpayment)
    let pay_amount = core::cmp::min(amount, remaining);

    // Transfer from borrower to pool vault
    token::transfer(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrower_ata.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info(),
        },
    ), pay_amount)?;

    // Update loan
    let loan = &mut ctx.accounts.loan;
    loan.repaid_amount = loan.repaid_amount
        .checked_add(pay_amount)
        .ok_or(LendError::Overflow)?;

    let new_remaining = total.checked_sub(loan.repaid_amount).ok_or(LendError::Overflow)?;

    emit!(LoanRepaid {
        loan_id: loan.loan_id, borrower: loan.borrower,
        amount: pay_amount, remaining: new_remaining,
    });

    // Check if fully repaid
    if loan.repaid_amount >= total {
        loan.status = LoanStatus::Repaid;

        let p = &mut ctx.accounts.pool_state;
        p.total_borrowed = p.total_borrowed.checked_sub(loan.principal).ok_or(LendError::Overflow)?;
        let interest_earned = loan.repaid_amount.checked_sub(loan.principal).ok_or(LendError::Overflow)?;
        p.total_interest_earned = p.total_interest_earned
            .checked_add(interest_earned)
            .ok_or(LendError::Overflow)?;
        p.active_loans = p.active_loans.checked_sub(1).ok_or(LendError::Overflow)?;

        emit!(LoanFullyRepaid {
            loan_id: loan.loan_id, borrower: loan.borrower,
            total_paid: loan.repaid_amount,
        });
    }

    Ok(())
}
