use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::OracleError;
use crate::events::ScoreUpdated;

#[derive(Accounts)]
pub struct UpdateScore<'info> {
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
    )]
    pub oracle_authority: Account<'info, OracleAuthority>,
    #[account(
        init_if_needed,
        payer = oracle_agent,
        space = 8 + CreditScore::INIT_SPACE,
        seeds = [CREDIT_SCORE_SEED, borrower.key().as_ref()],
        bump,
    )]
    pub credit_score: Account<'info, CreditScore>,
    /// CHECK: Borrower being scored. Validated as non-zero.
    pub borrower: UncheckedAccount<'info>,
    #[account(mut)]
    pub oracle_agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateScore>,
    score: u16,
    confidence: u8,
    model_hash: [u8; 32],
    zk_proof_hash: [u8; 32],
) -> Result<()> {
    // AUDIT: Check pause state
    let state = &ctx.accounts.oracle_state;
    require!(!state.is_paused, OracleError::OraclePaused);

    // AUDIT: Check oracle is active
    let auth = &ctx.accounts.oracle_authority;
    require!(auth.is_active, OracleError::OracleDeactivated);

    // AUDIT: Validate borrower is not system program / zero
    require!(
        ctx.accounts.borrower.key() != Pubkey::default(),
        OracleError::InvalidBorrower
    );

    // AUDIT: Strict score range [300, 850]
    require!(
        score >= MIN_SCORE && score <= MAX_SCORE,
        OracleError::ScoreOutOfRange
    );
    require!(confidence <= 100, OracleError::ConfidenceOutOfRange);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // AUDIT: checked_add prevents i64 overflow on expiry
    let expires_at = now
        .checked_add(state.score_validity_secs)
        .ok_or(OracleError::ArithmeticOverflow)?;

    let risk_tier = calculate_risk_tier(score);

    // Write score
    let cs = &mut ctx.accounts.credit_score;
    cs.borrower = ctx.accounts.borrower.key();
    cs.score = score;
    cs.confidence = confidence;
    cs.risk_tier = risk_tier;
    cs.timestamp = now;
    cs.expires_at = expires_at;
    cs.model_hash = model_hash;
    cs.zk_proof_hash = zk_proof_hash;
    cs.oracle_agent = ctx.accounts.oracle_agent.key();
    cs.bump = ctx.bumps.credit_score;

    // Update oracle stats with checked arithmetic
    let auth_mut = &mut ctx.accounts.oracle_authority;
    auth_mut.scores_pushed = auth_mut.scores_pushed
        .checked_add(1)
        .ok_or(OracleError::ArithmeticOverflow)?;

    let state_mut = &mut ctx.accounts.oracle_state;
    state_mut.total_scores_issued = state_mut.total_scores_issued
        .checked_add(1)
        .ok_or(OracleError::ArithmeticOverflow)?;

    emit!(ScoreUpdated {
        borrower: cs.borrower,
        score,
        risk_tier,
        confidence,
        model_hash,
        oracle_agent: cs.oracle_agent,
        timestamp: now,
        expires_at,
    });

    Ok(())
}
