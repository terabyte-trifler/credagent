use anchor_lang::prelude::*;

#[error_code]
pub enum CreditScoreOracleError {
    #[msg("Score is stale.")]
    ScoreStale,
}
