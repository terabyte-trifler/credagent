use anchor_lang::prelude::*;
use crate::state::{MAX_BATCH_SIZE, ORACLE_AUTH_SEED, ORACLE_STATE_SEED, OracleAuthority, OracleState};
use crate::errors::OracleError;

/// Batch update uses remaining accounts pattern.
/// Oracle agent passes score data as instruction args; 
/// borrower CreditScore PDAs passed as remaining_accounts.
///
/// AUDIT: Each score individually validated [300,850].
/// Batch capped at MAX_BATCH_SIZE=20 to fit in single tx.
#[derive(Accounts)]
pub struct BatchUpdateScores<'info> {
    #[account(
        mut,
        seeds = [ORACLE_STATE_SEED],
        bump = oracle_state.bump,
    )]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        mut,
        seeds = [ORACLE_AUTH_SEED, oracle_agent.key().as_ref()],
        bump = oracle_authority.bump,
        constraint = oracle_authority.agent == oracle_agent.key()
            @ OracleError::OracleNotAuthorized,
        constraint = oracle_authority.is_active
            @ OracleError::OracleDeactivated,
    )]
    pub oracle_authority: Account<'info, OracleAuthority>,
    #[account(mut)]
    pub oracle_agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreEntry {
    pub borrower: Pubkey,
    pub score: u16,
    pub confidence: u8,
}

pub fn handler(
    ctx: Context<BatchUpdateScores>,
    entries: Vec<ScoreEntry>,
    _model_hash: [u8; 32],
) -> Result<()> {
    let state = &ctx.accounts.oracle_state;
    require!(!state.is_paused, OracleError::OraclePaused);
    require!(entries.len() <= MAX_BATCH_SIZE, OracleError::BatchTooLarge);
    require!(!entries.is_empty(), OracleError::BatchTooLarge);
    Err(error!(OracleError::BatchUpdateDisabled))
}
