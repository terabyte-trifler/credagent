use anchor_lang::prelude::*;
use crate::errors::LendError;
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

    pool.next_loan_id = new_next_loan_id;
    Ok(())
}
