use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::CollateralReleased;

/// PAYMENT PRIMITIVE 6: Escrow Release
///
/// Returns collateral to borrower when loan is fully repaid.
/// Multi-condition check:
///   1. Loan status == Repaid
///   2. Escrow status == Locked (not already released/liquidated)
///   3. Escrow borrower matches loan borrower
///
/// AUDIT:
/// - Transfer via PDA signer (escrow_state owns the vault)
/// - Sets escrow status to Released (prevents double-release)
/// - Records release timestamp for audit trail
#[derive(Accounts)]
pub struct ReleaseCollateral<'info> {
    #[account(
        constraint = loan.status == LoanStatus::Repaid @ LendError::LoanNotFullyRepaid,
        constraint = loan.escrow == escrow_state.key(),
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        mut,
        constraint = escrow_state.status == EscrowStatus::Locked @ LendError::EscrowFinalized,
        constraint = escrow_state.borrower == borrower.key(),
    )]
    pub escrow_state: Account<'info, EscrowVaultState>,
    #[account(
        mut,
        seeds = [ESCROW_VAULT_SEED, escrow_state.loan_id.to_le_bytes().as_ref()],
        bump = escrow_state.vault_bump,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = borrower_ata.mint == escrow_state.collateral_mint @ LendError::MintMismatch,
        constraint = borrower_ata.owner == borrower.key(),
        constraint = borrower_ata.key() == get_associated_token_address(&borrower.key(), &escrow_state.collateral_mint),
    )]
    pub borrower_ata: Account<'info, TokenAccount>,
    /// CHECK: Borrower receiving collateral back.
    pub borrower: UncheckedAccount<'info>,
    /// Anyone can trigger release (permissionless once conditions met)
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseCollateral>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_state;
    let amount = escrow.collateral_amount;
    let loan_id_bytes = escrow.loan_id.to_le_bytes();

    // PDA signer for escrow_state (vault authority)
    let seeds: &[&[u8]] = &[ESCROW_SEED, loan_id_bytes.as_ref(), &[escrow.bump]];

    token::transfer(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.borrower_ata.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        },
        &[seeds],
    ), amount)?;

    let e = &mut ctx.accounts.escrow_state;
    e.status = EscrowStatus::Released;
    e.released_at = Clock::get()?.unix_timestamp;

    emit!(CollateralReleased {
        loan_id: e.loan_id, borrower: e.borrower, amount,
    });
    Ok(())
}
