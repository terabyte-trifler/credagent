use anchor_lang::prelude::*;

#[error_code]
pub enum LendingPoolError {
    #[msg("Conditional disbursement gate failed.")]
    GateFailed,
}
