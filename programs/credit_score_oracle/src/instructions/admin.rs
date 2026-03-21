use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::OracleError;
use crate::events::{HistoryAuthorityUpdated, OraclePaused, OracleRoleRevoked, OracleUnpaused};

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut, seeds = [ORACLE_STATE_SEED], bump = oracle_state.bump, has_one = admin)]
    pub oracle_state: Account<'info, OracleState>,
    pub admin: Signer<'info>,
}

pub fn handler_pause(ctx: Context<AdminAction>) -> Result<()> {
    ctx.accounts.oracle_state.is_paused = true;
    emit!(OraclePaused { admin: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn handler_unpause(ctx: Context<AdminAction>) -> Result<()> {
    ctx.accounts.oracle_state.is_paused = false;
    emit!(OracleUnpaused { admin: ctx.accounts.admin.key(), timestamp: Clock::get()?.unix_timestamp });
    Ok(())
}

pub fn handler_set_validity(ctx: Context<AdminAction>, new_period: i64) -> Result<()> {
    require!(
        new_period >= MIN_VALIDITY_SECS && new_period <= MAX_VALIDITY_SECS,
        OracleError::InvalidValidityPeriod
    );
    ctx.accounts.oracle_state.score_validity_secs = new_period;
    Ok(())
}

pub fn handler_set_history_authority(
    ctx: Context<AdminAction>,
    new_authority: Pubkey,
) -> Result<()> {
    require!(new_authority != Pubkey::default(), OracleError::InvalidHistoryAuthority);
    ctx.accounts.oracle_state.history_authority = new_authority;
    emit!(HistoryAuthorityUpdated {
        admin: ctx.accounts.admin.key(),
        history_authority: new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeOracleRole<'info> {
    #[account(seeds = [ORACLE_STATE_SEED], bump = oracle_state.bump, has_one = admin)]
    pub oracle_state: Account<'info, OracleState>,
    #[account(mut)]
    pub oracle_authority: Account<'info, OracleAuthority>,
    pub admin: Signer<'info>,
}

pub fn handler_revoke(ctx: Context<RevokeOracleRole>) -> Result<()> {
    ctx.accounts.oracle_authority.is_active = false;
    emit!(OracleRoleRevoked {
        agent: ctx.accounts.oracle_authority.agent,
        revoked_by: ctx.accounts.admin.key(),
    });
    Ok(())
}
