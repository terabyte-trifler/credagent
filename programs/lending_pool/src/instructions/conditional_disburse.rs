use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use agent_permissions::{self, AgentIdentity, AgentRole, PermState, PermissionTier};
use credit_score_oracle::{program::CreditScoreOracle, state::CreditScore};
use crate::state::*;
use crate::errors::LendError;
use crate::events::LoanDisbursed;
use crate::instructions::accrue_interest;

const STARTER_MAX_PRINCIPAL: u64 = 100_000_000; // 100 USDT (6 decimals)
const STARTER_MAX_DURATION_DAYS: u16 = 14;
const STARTER_MIN_RATE_BPS: u16 = 1_800;

/// PAYMENT PRIMITIVE 2: Conditional Disbursement
///
/// Atomically validates 4 gates before releasing loan funds:
///   GATE 1: Credit score valid (not expired, tier >= BB or bounded starter micro-loan)
///   GATE 2: Collateral locked in escrow (status == Locked)
///   GATE 3: Pool utilization below maximum after this loan
///   GATE 4: Agent authorized and within spending limit
///
/// If ANY gate fails, the ENTIRE transaction reverts.
/// No partial disbursement possible.
///
/// AUDIT:
/// - All 4 gates checked BEFORE any token transfer
/// - Uses CreditScore PDA for gate 1 (on-chain, not off-chain input)
/// - Uses EscrowVaultState PDA for gate 2 (verifiable on-chain)
/// - Utilization calculated from pool state, not external input
/// - Loan PDA created with deterministic seeds
/// - Interest index snapshot captured for streaming calculation
#[derive(Accounts)]
#[instruction(
    principal: u64,
    interest_rate_bps: u16,
    duration_days: u16,
    decision_hash: [u8; 32],
)]
pub struct ConditionalDisburse<'info> {
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

    /// The credit score PDA for the borrower (GATE 1)
    #[account(
        seeds = [b"credit_score", borrower.key().as_ref()],
        bump,
        seeds::program = credit_oracle_program.key(),
    )]
    pub credit_score_account: Account<'info, CreditScore>,

    /// The escrow state PDA for this loan (GATE 2)
    #[account(
        mut,
        constraint = escrow_state.borrower == borrower.key() @ LendError::InvalidScore,
        constraint = escrow_state.status == EscrowStatus::Locked @ LendError::EscrowNotLocked,
        constraint = escrow_state.loan_id == pool_state.next_loan_id @ LendError::LoanIdMismatch,
    )]
    pub escrow_state: Account<'info, EscrowVaultState>,

    /// Loan account to be created
    #[account(
        init, payer = lending_agent,
        space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED, pool_state.key().as_ref(), pool_state.next_loan_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        constraint = borrower_ata.mint == pool_state.token_mint @ LendError::MintMismatch,
        constraint = borrower_ata.owner == borrower.key(),
        constraint = borrower_ata.key() == get_associated_token_address(&borrower.key(), &pool_state.token_mint) @ LendError::UnauthorizedAgent,
    )]
    pub borrower_ata: Account<'info, TokenAccount>,

    /// CHECK: Borrower receiving funds.
    pub borrower: UncheckedAccount<'info>,

    #[account(mut)]
    pub lending_agent: Signer<'info>,

    #[account(
        seeds = [agent_permissions::PERM_STATE_SEED],
        bump = perm_state.bump,
        seeds::program = agent_permissions_program.key(),
    )]
    pub perm_state: Account<'info, PermState>,

    #[account(
        mut,
        seeds = [agent_permissions::AGENT_IDENTITY_SEED, lending_agent.key().as_ref()],
        bump = agent_identity.bump,
        seeds::program = agent_permissions_program.key(),
        constraint = agent_identity.wallet == lending_agent.key() @ LendError::UnauthorizedAgent,
    )]
    pub agent_identity: Account<'info, AgentIdentity>,

    pub credit_oracle_program: Program<'info, CreditScoreOracle>,

    pub agent_permissions_program: Program<'info, agent_permissions::program::AgentPermissions>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<ConditionalDisburse>,
    principal: u64,
    interest_rate_bps: u16,
    duration_days: u16,
    decision_hash: [u8; 32],
) -> Result<()> {
    require!(principal > 0, LendError::ZeroAmount);
    require!(interest_rate_bps > 0 && interest_rate_bps <= MAX_INTEREST_RATE_BPS, LendError::RateExceeded);
    require!(duration_days > 0 && duration_days <= MAX_LOAN_DURATION_DAYS, LendError::DurationExceeded);

    let now = Clock::get()?.unix_timestamp;
    let pool_key = ctx.accounts.pool_state.key();
    {
        let pool = &mut ctx.accounts.pool_state;
        accrue_interest::accrue_pool_state(pool, pool_key, now)?;
    }

    let pool = &ctx.accounts.pool_state;
    require!(!pool.is_paused, LendError::Paused);

    // ════════════════════════════════════
    // GATE 1: Valid credit score (not expired, tier >= BB)
    // ════════════════════════════════════
    let credit_score = &ctx.accounts.credit_score_account;
    require!(credit_score.borrower == ctx.accounts.borrower.key(), LendError::InvalidScore);
    require!(credit_score.expires_at > now, LendError::InvalidScore);

    let starter_profile = principal <= STARTER_MAX_PRINCIPAL
        && duration_days <= STARTER_MAX_DURATION_DAYS
        && interest_rate_bps >= STARTER_MIN_RATE_BPS;
    require!(credit_score.risk_tier >= 1 || starter_profile, LendError::ScoreTooLow);

    // ════════════════════════════════════
    // GATE 2: Collateral locked in escrow
    // ════════════════════════════════════
    // Already validated by account constraints:
    //   escrow_state.status == Locked (enforced in derive)
    //   escrow_state.borrower == borrower.key()
    require!(
        ctx.accounts.escrow_state.collateral_amount > 0,
        LendError::InsufficientCollateral
    );
    require!(
        ctx.accounts.escrow_state.collateral_mint == pool.collateral_mint,
        LendError::MintMismatch
    );
    require!(
        pool.collateral_price_usdt_6 > 0,
        LendError::InvalidCollateralPrice
    );
    let price_age = now
        .checked_sub(pool.collateral_price_updated_at)
        .ok_or(LendError::Overflow)?;
    require!(
        price_age >= 0 && price_age <= pool.max_price_age_secs,
        LendError::CollateralPriceStale
    );
    let collateral_value = compute_collateral_value_from_price_usdt_6(
        ctx.accounts.escrow_state.collateral_amount,
        pool.collateral_price_usdt_6,
    )
        .ok_or(LendError::Overflow)?;
    let minimum_collateral_value = (principal as u128)
        .checked_mul(MIN_COLLATERAL_RATIO_BPS as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LendError::Overflow)?;
    require!(
        (collateral_value as u128) >= minimum_collateral_value,
        LendError::InsufficientCollateral
    );

    // ════════════════════════════════════
    // GATE 3: Pool utilization below max
    // ════════════════════════════════════
    let new_borrowed = pool.total_borrowed
        .checked_add(principal)
        .ok_or(LendError::Overflow)?;
    let new_util = utilization_bps(pool.total_deposited, new_borrowed);
    require!(new_util <= pool.max_utilization_bps, LendError::UtilizationExceeded);

    // Available liquidity check
    let available = pool.total_deposited
        .checked_sub(pool.total_borrowed)
        .ok_or(LendError::Overflow)?;
    require!(principal <= available, LendError::InsufficientLiquidity);

    // ════════════════════════════════════
    // GATE 4: Agent authorized and within spending limit
    // ════════════════════════════════════
    let spend_ctx = CpiContext::new(
        ctx.accounts.agent_permissions_program.to_account_info(),
        agent_permissions::cpi::accounts::CheckPermissionAndSpend {
            perm_state: ctx.accounts.perm_state.to_account_info(),
            agent_identity: ctx.accounts.agent_identity.to_account_info(),
            agent_signer: ctx.accounts.lending_agent.to_account_info(),
        },
    );
    agent_permissions::cpi::check_permission_and_spend(
        spend_ctx,
        AgentRole::Lending,
        PermissionTier::Manage,
        principal,
    )?;

    // ════════════════════════════════════
    // ALL GATES PASSED — Execute disbursement
    // ════════════════════════════════════

    let due_date = now
        .checked_add((duration_days as i64).checked_mul(86_400).ok_or(LendError::Overflow)?)
        .ok_or(LendError::Overflow)?;

    let loan_id = pool.next_loan_id;

    // Create loan record
    let loan = &mut ctx.accounts.loan;
    loan.loan_id = loan_id;
    loan.pool = ctx.accounts.pool_state.key();
    loan.borrower = ctx.accounts.borrower.key();
    loan.lending_agent = ctx.accounts.lending_agent.key();
    loan.principal = principal;
    loan.interest_rate_bps = interest_rate_bps;
    loan.start_time = now;
    loan.due_date = due_date;
    loan.repaid_amount = 0;
    loan.status = LoanStatus::Active;
    loan.escrow = ctx.accounts.escrow_state.key();
    loan.schedule = Pubkey::default(); // Set later by create_schedule
    loan.agent_decision_hash = decision_hash;
    loan.index_snapshot = pool.interest_index;
    loan.bump = ctx.bumps.loan;

    // Transfer principal from pool vault to borrower
    let mint_key = pool.token_mint;
    let pool_bump = pool.bump;
    let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[pool_bump]];

    token::transfer(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.borrower_ata.to_account_info(),
            authority: ctx.accounts.pool_state.to_account_info(),
        },
        &[seeds],
    ), principal)?;

    // Update pool state
    let p = &mut ctx.accounts.pool_state;
    p.total_borrowed = new_borrowed;
    p.active_loans = p.active_loans.checked_add(1).ok_or(LendError::Overflow)?;
    p.total_loans_issued = p.total_loans_issued.checked_add(1).ok_or(LendError::Overflow)?;
    p.next_loan_id = loan_id.checked_add(1).ok_or(LendError::Overflow)?;

    emit!(LoanDisbursed {
        loan_id, borrower: loan.borrower, agent: loan.lending_agent,
        principal, rate_bps: interest_rate_bps, due_date, decision_hash,
    });

    Ok(())
}
