use anchor_lang::prelude::*;
use crate::errors::LendError;
use crate::events::{CollateralPriceOracleUpdated, NextLoanIdUpdated};
use crate::state::*;

#[derive(Accounts)]
pub struct SetNextLoanId<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
        has_one = authority,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub authority: Signer<'info>,
}

pub fn handler_set_next_loan_id(ctx: Context<SetNextLoanId>, new_next_loan_id: u64) -> Result<()> {
    require!(new_next_loan_id > 0, LendError::ZeroAmount);

    let pool = &mut ctx.accounts.pool_state;
    require!(new_next_loan_id >= pool.next_loan_id, LendError::LoanIdMismatch);
    let old_next_loan_id = pool.next_loan_id;
    pool.next_loan_id = new_next_loan_id;
    emit!(NextLoanIdUpdated {
        pool: pool.key(),
        old_next_loan_id,
        new_next_loan_id,
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetCollateralPriceOracle<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
        has_one = authority,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub authority: Signer<'info>,
    /// CHECK: Dedicated oracle signer for collateral pricing.
    pub new_oracle: UncheckedAccount<'info>,
}

pub fn handler_set_collateral_price_oracle(
    ctx: Context<SetCollateralPriceOracle>,
) -> Result<()> {
    let old_oracle = ctx.accounts.pool_state.collateral_price_oracle;
    ctx.accounts.pool_state.collateral_price_oracle = ctx.accounts.new_oracle.key();
    emit!(CollateralPriceOracleUpdated {
        pool: ctx.accounts.pool_state.key(),
        old_oracle,
        new_oracle: ctx.accounts.new_oracle.key(),
        authority: ctx.accounts.authority.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateCollateralPrice<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
        constraint = pool_state.collateral_price_oracle == oracle.key() @ LendError::UnauthorizedAgent,
    )]
    pub pool_state: Account<'info, PoolState>,
    pub oracle: Signer<'info>,
}

pub fn handler_update_collateral_price(
    ctx: Context<UpdateCollateralPrice>,
    collateral_price_usdt_6: u64,
) -> Result<()> {
    require!(collateral_price_usdt_6 > 0, LendError::InvalidCollateralPrice);
    let now = Clock::get()?.unix_timestamp;
    let pool = &mut ctx.accounts.pool_state;
    pool.collateral_price_usdt_6 = collateral_price_usdt_6;
    pool.collateral_price_updated_at = now;
    Ok(())
}
