use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Score must be between 300 and 850")]
    ScoreOutOfRange,
    #[msg("Confidence must be between 0 and 100")]
    ConfidenceOutOfRange,
    #[msg("Oracle is paused by admin")]
    OraclePaused,
    #[msg("Signer is not an authorized oracle agent")]
    OracleNotAuthorized,
    #[msg("Oracle agent has been deactivated")]
    OracleDeactivated,
    #[msg("Arithmetic overflow detected")]
    ArithmeticOverflow,
    #[msg("Validity period must be between 1 and 30 days")]
    InvalidValidityPeriod,
    #[msg("Credit score has expired")]
    ScoreExpired,
    #[msg("Credit score not found for borrower")]
    ScoreNotFound,
    #[msg("Batch size exceeds maximum of 20")]
    BatchTooLarge,
    #[msg("DID already registered to another wallet")]
    DidAlreadyRegistered,
    #[msg("Borrower address cannot be zero")]
    InvalidBorrower,
}
