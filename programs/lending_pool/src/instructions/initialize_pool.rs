use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::state::*;
use crate::events::PoolInitialized;

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init, payer = authority,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [POOL_SEED, token_mint.key().as_ref()], bump,
    )]
    pub pool_state: Account<'info, PoolState>,
    #[account(
        init, payer = authority,
        seeds = [POOL_VAULT_SEED, token_mint.key().as_ref()], bump,
        token::mint = token_mint,
        token::authority = pool_state,
    )]
    pub pool_vault: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitializePool>, base_rate_bps: u16) -> Result<()> {
    let pool_key = ctx.accounts.pool_state.key();
    let authority_key = ctx.accounts.authority.key();
    let token_mint_key = ctx.accounts.token_mint.key();
    let p = &mut ctx.accounts.pool_state;
    p.authority = authority_key;
    p.collateral_price_oracle = authority_key;
    p.token_mint = token_mint_key;
    p.total_deposited = 0;
    p.total_borrowed = 0;
    p.total_interest_earned = 0;
    p.total_defaults = 0;
    p.active_loans = 0;
    p.total_loans_issued = 0;
    p.next_loan_id = 1;
    p.base_rate_bps = base_rate_bps;
    p.max_utilization_bps = MAX_UTILIZATION_BPS;
    // Start fail-closed: the oracle must publish a fresh collateral price
    // before any loan can pass the collateral gate.
    p.collateral_price_usdt_6 = 0;
    p.collateral_price_updated_at = 0;
    p.max_price_age_secs = DEFAULT_PRICE_MAX_AGE_SECS;
    p.interest_index = PRECISION; // starts at 1.0 (scaled)
    p.last_update_ts = Clock::get()?.unix_timestamp;
    p.is_paused = false;
    p.bump = ctx.bumps.pool_state;
    p.vault_bump = ctx.bumps.pool_vault;

    emit!(PoolInitialized {
        pool: pool_key,
        token_mint: p.token_mint,
        authority: p.authority,
    });
    Ok(())
}
