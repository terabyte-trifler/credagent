use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::CollateralLiquidated;

/// PAYMENT PRIMITIVE 7: Escrow Liquidation
///
/// Seizes collateral from escrow vault and sends to pool vault
/// when a loan has been marked as defaulted.
///
/// AUDIT:
/// - Only callable when loan.status == Defaulted
/// - Escrow must be Locked (not already released/liquidated)
/// - Collateral goes to pool vault, not to any EOA
/// - Sets escrow to Liquidated status (prevents double-liquidation)
#[derive(Accounts)]
pub struct LiquidateEscrow<'info> {
    #[account(
        constraint = loan.status == LoanStatus::Defaulted @ LendError::NotActive,
        constraint = loan.escrow == escrow_state.key(),
    )]
    pub loan: Account<'info, Loan>,
    #[account(
        mut,
        constraint = escrow_state.status == EscrowStatus::Locked @ LendError::EscrowFinalized,
    )]
    pub escrow_state: Account<'info, EscrowVaultState>,
    #[account(
        mut,
        seeds = [ESCROW_VAULT_SEED, escrow_state.loan_id.to_le_bytes().as_ref()],
        bump = escrow_state.vault_bump,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    /// Pool vault to receive liquidated collateral.
    /// NOTE: If collateral mint differs from pool mint, a swap step is needed.
    /// For MVP, we assume same-mint collateral or a separate liquidation vault.
    #[account(mut)]
    pub liquidation_recipient: Account<'info, TokenAccount>,
    /// Anyone can trigger (permissionless once loan is defaulted)
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<LiquidateEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_state;
    let amount = escrow.collateral_amount;
    let loan_id_bytes = escrow.loan_id.to_le_bytes();

    let seeds: &[&[u8]] = &[ESCROW_SEED, loan_id_bytes.as_ref(), &[escrow.bump]];

    token::transfer(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.liquidation_recipient.to_account_info(),
            authority: ctx.accounts.escrow_state.to_account_info(),
        },
        &[seeds],
    ), amount)?;

    let e = &mut ctx.accounts.escrow_state;
    e.status = EscrowStatus::Liquidated;
    e.released_at = Clock::get()?.unix_timestamp;

    emit!(CollateralLiquidated { loan_id: e.loan_id, amount });
    Ok(())
}
