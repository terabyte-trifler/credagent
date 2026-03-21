use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::{ScheduleCreated, InstallmentPulled};

// ═══════════════════════════════════════════
// PAYMENT PRIMITIVE 3: Installment Schedule
// ═══════════════════════════════════════════

/// Creates a repayment schedule PDA with N installments.
/// The collection agent is authorized to pull payments on due dates.
///
/// AUDIT:
/// - Schedule tied to exactly one loan via loan_id seed
/// - collection_agent pubkey stored; only that agent can pull
/// - Installment count capped at MAX_INSTALLMENTS (52)
/// - Amount calculated with checked division
#[derive(Accounts)]
#[instruction(num_installments: u8, interval_secs: i64)]
pub struct CreateSchedule<'info> {
    #[account(
        mut,
        constraint = loan.status == LoanStatus::Active @ LendError::NotActive,
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        init, payer = lending_agent,
        space = 8 + InstallmentSchedule::INIT_SPACE,
        seeds = [SCHEDULE_SEED, loan.loan_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub schedule: Account<'info, InstallmentSchedule>,
    /// CHECK: Collection agent pubkey authorized to pull installments.
    pub collection_agent: UncheckedAccount<'info>,
    #[account(mut)]
    pub lending_agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler_create(
    ctx: Context<CreateSchedule>,
    num_installments: u8,
    interval_secs: i64,
) -> Result<()> {
    require!(num_installments > 0 && num_installments <= MAX_INSTALLMENTS, LendError::TooManyInstallments);
    require!(interval_secs > 0, LendError::ZeroAmount);

    let loan = &ctx.accounts.loan;

    // AUDIT: checked division for amount per installment
    let amount_per = loan.principal
        .checked_div(num_installments as u64)
        .ok_or(LendError::Overflow)?;
    // Add remainder to last installment (handled in pull logic)

    let now = Clock::get()?.unix_timestamp;
    let first_due = now.checked_add(interval_secs).ok_or(LendError::Overflow)?;
    let schedule_key = ctx.accounts.schedule.key();

    let s = &mut ctx.accounts.schedule;
    s.loan_id = loan.loan_id;
    s.borrower = loan.borrower;
    s.pool = loan.pool;
    s.total_installments = num_installments;
    s.paid_installments = 0;
    s.amount_per_installment = amount_per;
    s.interval_secs = interval_secs;
    s.next_due_date = first_due;
    s.collection_agent = ctx.accounts.collection_agent.key();
    s.is_active = true;
    s.bump = ctx.bumps.schedule;

    // Link schedule to loan
    let loan_mut = &mut ctx.accounts.loan;
    loan_mut.schedule = schedule_key;

    emit!(ScheduleCreated {
        loan_id: s.loan_id,
        installments: num_installments,
        amount_each: amount_per,
        interval_secs,
    });
    Ok(())
}

// ═══════════════════════════════════════════
// PAYMENT PRIMITIVE 4: Pull Installment
// ═══════════════════════════════════════════

/// Collection agent pulls a scheduled installment payment.
/// Uses borrower's pre-approved SPL token delegation.
///
/// AUDIT:
/// - Only the designated collection_agent can call this
/// - Checks that next_due_date has passed (no early pulls)
/// - Increments paid_installments counter (prevents double-pull)
/// - Last installment sweeps remaining balance (handles rounding)
/// - Updates loan.repaid_amount
#[derive(Accounts)]
pub struct PullInstallment<'info> {
    #[account(
        mut,
        constraint = schedule.is_active @ LendError::ScheduleComplete,
        constraint = schedule.collection_agent == collection_agent.key()
            @ LendError::NotCollectionAgent,
    )]
    pub schedule: Account<'info, InstallmentSchedule>,
    #[account(
        mut,
        constraint = loan.loan_id == schedule.loan_id,
        constraint = loan.status == LoanStatus::Active @ LendError::NotActive,
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        mut,
        seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.vault_bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    /// Borrower's token account (must have delegated authority to collection_agent)
    #[account(
        mut,
        constraint = borrower_ata.mint == pool_state.token_mint @ LendError::MintMismatch,
    )]
    pub borrower_ata: Account<'info, TokenAccount>,
    /// Collection agent authorized to pull installments
    pub collection_agent: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler_pull(ctx: Context<PullInstallment>) -> Result<()> {
    let s = &ctx.accounts.schedule;
    let now = Clock::get()?.unix_timestamp;

    // AUDIT: Cannot pull before due date
    require!(now >= s.next_due_date, LendError::NotDue);

    // AUDIT: Cannot pull if all installments paid
    require!(s.paid_installments < s.total_installments, LendError::ScheduleComplete);

    let is_last = s.paid_installments + 1 == s.total_installments;

    // Last installment sweeps remaining loan balance
    let pull_amount = if is_last {
        let loan = &ctx.accounts.loan;
        loan.principal.checked_sub(loan.repaid_amount).ok_or(LendError::Overflow)?
    } else {
        s.amount_per_installment
    };

    // Pull from borrower to pool vault via delegate authority
    // NOTE: Borrower must have called SPL approve() for collection_agent
    token::transfer(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrower_ata.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.collection_agent.to_account_info(),
        },
    ), pull_amount)?;

    // Update schedule
    let s = &mut ctx.accounts.schedule;
    s.paid_installments = s.paid_installments.checked_add(1).ok_or(LendError::Overflow)?;
    s.next_due_date = s.next_due_date
        .checked_add(s.interval_secs)
        .ok_or(LendError::Overflow)?;

    if s.paid_installments >= s.total_installments {
        s.is_active = false;
    }

    // Update loan repaid amount
    let loan = &mut ctx.accounts.loan;
    loan.repaid_amount = loan.repaid_amount
        .checked_add(pull_amount)
        .ok_or(LendError::Overflow)?;

    emit!(InstallmentPulled {
        loan_id: s.loan_id,
        amount: pull_amount,
        paid: s.paid_installments,
        remaining: s.total_installments.saturating_sub(s.paid_installments),
    });
    Ok(())
}
