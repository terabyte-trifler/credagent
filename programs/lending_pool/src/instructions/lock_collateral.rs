use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::CollateralLocked;

/// PAYMENT PRIMITIVE 1: Escrow PDA
///
/// Creates a program-owned escrow vault and transfers borrower's
/// collateral SPL tokens into it. Tokens can ONLY be released by
/// release_collateral (full repayment) or liquidate_escrow (default).
///
/// AUDIT:
/// - Escrow vault authority is the EscrowVaultState PDA (program-owned)
/// - No EOA ever has custody of escrowed funds
/// - Token transfer via SPL CPI — no raw lamport manipulation
/// - loan_id ties escrow to exactly one loan
#[derive(Accounts)]
#[instruction(loan_id: u64, amount: u64)]
pub struct LockCollateral<'info> {
    #[account(
        mut, seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        init, payer = borrower,
        space = 8 + EscrowVaultState::INIT_SPACE,
        seeds = [ESCROW_SEED, loan_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub escrow_state: Account<'info, EscrowVaultState>,
    #[account(
        init, payer = borrower,
        seeds = [ESCROW_VAULT_SEED, loan_id.to_le_bytes().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = escrow_state, // AUDIT: PDA-owned, not EOA
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    pub collateral_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = borrower_ata.mint == collateral_mint.key() @ LendError::MintMismatch,
        constraint = borrower_ata.owner == borrower.key(),
    )]
    pub borrower_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub borrower: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<LockCollateral>, loan_id: u64, amount: u64) -> Result<()> {
    require!(amount > 0, LendError::ZeroAmount);
    require!(!ctx.accounts.pool_state.is_paused, LendError::Paused);
    require!(loan_id == ctx.accounts.pool_state.next_loan_id, LendError::LoanIdMismatch);

    // Transfer collateral from borrower to escrow vault
    token::transfer(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrower_ata.to_account_info(),
            to: ctx.accounts.escrow_vault.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info(),
        },
    ), amount)?;

    // Initialize escrow state
    let e = &mut ctx.accounts.escrow_state;
    e.loan_id = loan_id;
    e.borrower = ctx.accounts.borrower.key();
    e.collateral_mint = ctx.accounts.collateral_mint.key();
    e.collateral_amount = amount;
    e.status = EscrowStatus::Locked;
    e.locked_at = Clock::get()?.unix_timestamp;
    e.released_at = 0;
    e.bump = ctx.bumps.escrow_state;
    e.vault_bump = ctx.bumps.escrow_vault;

    emit!(CollateralLocked {
        loan_id, borrower: e.borrower,
        mint: e.collateral_mint, amount,
    });
    Ok(())
}
