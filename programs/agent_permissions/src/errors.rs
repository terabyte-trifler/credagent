use anchor_lang::prelude::*;

#[error_code]
pub enum AgentPermissionsError {
    #[msg("Agent exceeds daily limit.")]
    DailyLimitExceeded,
}
