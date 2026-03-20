use anchor_lang::prelude::*;

#[error_code]
pub enum LendError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Pool is paused")]
    Paused,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Token mint mismatch")]
    MintMismatch,
    #[msg("Pool utilization would exceed maximum")]
    UtilizationExceeded,
    #[msg("Credit score expired or invalid")]
    InvalidScore,
    #[msg("Credit score too low for lending")]
    ScoreTooLow,
    #[msg("Insufficient collateral for risk tier")]
    InsufficientCollateral,
    #[msg("Loan not in active status")]
    NotActive,
    #[msg("Grace period not yet expired")]
    GracePeriodActive,
    #[msg("Installment not yet due")]
    NotDue,
    #[msg("All installments already paid")]
    ScheduleComplete,
    #[msg("Escrow not in locked status")]
    EscrowNotLocked,
    #[msg("Escrow already released or liquidated")]
    EscrowFinalized,
    #[msg("Loan duration exceeds maximum")]
    DurationExceeded,
    #[msg("Interest rate exceeds maximum")]
    RateExceeded,
    #[msg("Installment count exceeds maximum")]
    TooManyInstallments,
    #[msg("Insufficient pool liquidity")]
    InsufficientLiquidity,
    #[msg("Repayment exceeds total owed")]
    OverRepayment,
    #[msg("Only collection agent can pull installments")]
    NotCollectionAgent,
    #[msg("Loan still has outstanding repayments")]
    LoanNotFullyRepaid,
    #[msg("Schedule must be inactive or complete to release")]
    ScheduleStillActive,
}
