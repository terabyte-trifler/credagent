use anchor_lang::prelude::*;
use crate::state::*;
use crate::events::OracleRoleGranted;

#[derive(Accounts)]
pub struct GrantOracleRole<'info> {
    #[account(
        mut,
        seeds = [ORACLE_STATE_SEED],
        bump = oracle_state.bump,
        has_one = admin,
    )]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        init,
        payer = admin,
        space = 8 + OracleAuthority::INIT_SPACE,
        seeds = [ORACLE_AUTH_SEED, oracle_agent.key().as_ref()],
        bump,
    )]
    pub oracle_authority: Account<'info, OracleAuthority>,
    /// CHECK: Wallet being granted oracle update rights.
    pub oracle_agent: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<GrantOracleRole>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let auth = &mut ctx.accounts.oracle_authority;
    auth.agent = ctx.accounts.oracle_agent.key();
    auth.granted_by = ctx.accounts.admin.key();
    auth.granted_at = now;
    auth.is_active = true;
    auth.scores_pushed = 0;
    auth.bump = ctx.bumps.oracle_authority;

    emit!(OracleRoleGranted {
        agent: auth.agent,
        granted_by: auth.granted_by,
    });

    Ok(())
}
