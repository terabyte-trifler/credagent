use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::OracleError;
use crate::events::OracleInitialized;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + OracleState::INIT_SPACE,
        seeds = [ORACLE_STATE_SEED],
        bump,
    )]
    pub oracle_state: Account<'info, OracleState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, validity_secs: i64) -> Result<()> {
    require!(
        validity_secs >= MIN_VALIDITY_SECS && validity_secs <= MAX_VALIDITY_SECS,
        OracleError::InvalidValidityPeriod
    );

    let state = &mut ctx.accounts.oracle_state;
    state.admin = ctx.accounts.admin.key();
    state.history_authority = ctx.accounts.admin.key();
    state.score_validity_secs = validity_secs;
    state.is_paused = false;
    state.total_scores_issued = 0;
    state.bump = ctx.bumps.oracle_state;

    emit!(OracleInitialized {
        admin: state.admin,
        validity_secs,
    });
    Ok(())
}
