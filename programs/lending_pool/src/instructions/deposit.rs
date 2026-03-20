use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::LendError;
use crate::events::{Deposited, Withdrawn};

// ═══════════════════════════════════════════
// Deposit
// ═══════════════════════════════════════════
#[derive(Accounts)]
pub struct Deposit<'info> {
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
    #[account(mut, constraint = depositor_ata.mint == pool_state.token_mint @ LendError::MintMismatch)]
    pub depositor_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, LendError::ZeroAmount);
    require!(!ctx.accounts.pool_state.is_paused, LendError::Paused);

    token::transfer(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.depositor_ata.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    ), amount)?;

    let p = &mut ctx.accounts.pool_state;
    p.total_deposited = p.total_deposited.checked_add(amount).ok_or(LendError::Overflow)?;

    emit!(Deposited { depositor: ctx.accounts.depositor.key(), amount, total_deposited: p.total_deposited });
    Ok(())
}

// ═══════════════════════════════════════════
// Withdraw (yield agent or authority)
// ═══════════════════════════════════════════
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut, seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
        has_one = authority,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        mut, seeds = [POOL_VAULT_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.vault_bump,
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = recipient_ata.mint == pool_state.token_mint @ LendError::MintMismatch)]
    pub recipient_ata: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, LendError::ZeroAmount);
    let p = &mut ctx.accounts.pool_state;

    let available = p.total_deposited.checked_sub(p.total_borrowed).ok_or(LendError::Overflow)?;
    require!(amount <= available, LendError::InsufficientLiquidity);

    // PDA signer seeds for pool_state (vault authority)
    let mint_key = p.token_mint;
    let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[p.bump]];

    token::transfer(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.recipient_ata.to_account_info(),
            authority: ctx.accounts.pool_state.to_account_info(),
        },
        &[seeds],
    ), amount)?;

    p.total_deposited = p.total_deposited.checked_sub(amount).ok_or(LendError::Overflow)?;

    emit!(Withdrawn { to: ctx.accounts.recipient_ata.key(), amount, total_deposited: p.total_deposited });
    Ok(())
}
