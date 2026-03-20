use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::OracleError;
use crate::events::ScoreUpdated;

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
    model_hash: [u8; 32],
) -> Result<()> {
    let state = &ctx.accounts.oracle_state;
    require!(!state.is_paused, OracleError::OraclePaused);
    require!(entries.len() <= MAX_BATCH_SIZE, OracleError::BatchTooLarge);
    require!(!entries.is_empty(), OracleError::BatchTooLarge);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let expires_at = now
        .checked_add(state.score_validity_secs)
        .ok_or(OracleError::ArithmeticOverflow)?;

    let mut count: u64 = 0;

    for entry in entries.iter() {
        if entry.score < MIN_SCORE || entry.score > MAX_SCORE { continue; }
        if entry.confidence > 100 { continue; }
        if entry.borrower == Pubkey::default() { continue; }

        let risk_tier = calculate_risk_tier(entry.score);

        emit!(ScoreUpdated {
            borrower: entry.borrower,
            score: entry.score,
            risk_tier,
            confidence: entry.confidence,
            model_hash,
            oracle_agent: ctx.accounts.oracle_agent.key(),
            timestamp: now,
            expires_at,
        });

        count = count.checked_add(1).ok_or(OracleError::ArithmeticOverflow)?;
    }

    // Update stats
    let auth = &mut ctx.accounts.oracle_authority;
    auth.scores_pushed = auth.scores_pushed
        .checked_add(count)
        .ok_or(OracleError::ArithmeticOverflow)?;

    let state_mut = &mut ctx.accounts.oracle_state;
    state_mut.total_scores_issued = state_mut.total_scores_issued
        .checked_add(count)
        .ok_or(OracleError::ArithmeticOverflow)?;

    Ok(())
}
