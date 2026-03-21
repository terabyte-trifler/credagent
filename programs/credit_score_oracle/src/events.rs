use anchor_lang::prelude::*;

#[event]
pub struct OracleInitialized {
    pub admin: Pubkey,
    pub validity_secs: i64,
}

#[event]
pub struct OracleRoleGranted {
    pub agent: Pubkey,
    pub granted_by: Pubkey,
}

#[event]
pub struct OracleRoleRevoked {
    pub agent: Pubkey,
    pub revoked_by: Pubkey,
}

#[event]
pub struct ScoreUpdated {
    pub borrower: Pubkey,
    pub score: u16,
    pub risk_tier: u8,
    pub confidence: u8,
    pub model_hash: [u8; 32],
    pub oracle_agent: Pubkey,
    pub timestamp: i64,
    pub expires_at: i64,
}

#[event]
pub struct CreditHistoryUpdated {
    pub borrower: Pubkey,
    pub event_type: u8, // 0=issued, 1=repaid, 2=defaulted
    pub amount: u64,
    pub total_loans: u16,
    pub repaid_loans: u16,
    pub defaulted_loans: u16,
}

#[event]
pub struct DidRegistered {
    pub did: [u8; 32],
    pub wallet: Pubkey,
}

#[event]
pub struct OraclePaused {
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleUnpaused {
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct HistoryAuthorityUpdated {
    pub admin: Pubkey,
    pub history_authority: Pubkey,
    pub timestamp: i64,
}
