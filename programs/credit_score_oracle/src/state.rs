use anchor_lang::prelude::*;

// ═══════════════════════════════════════════
// PDA Seeds (documented, deterministic)
// ═══════════════════════════════════════════
pub const ORACLE_STATE_SEED: &[u8] = b"oracle_state";
pub const CREDIT_SCORE_SEED: &[u8] = b"credit_score";
pub const CREDIT_HISTORY_SEED: &[u8] = b"credit_history";
pub const ORACLE_AUTH_SEED: &[u8] = b"oracle_auth";
pub const DID_MAPPING_SEED: &[u8] = b"did_mapping";

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════
pub const MIN_SCORE: u16 = 300;
pub const MAX_SCORE: u16 = 850;
pub const AAA_THRESHOLD: u16 = 750;
pub const AA_THRESHOLD: u16 = 650;
pub const A_THRESHOLD: u16 = 550;
pub const BB_THRESHOLD: u16 = 450;
pub const MIN_VALIDITY_SECS: i64 = 86_400;       // 1 day
pub const MAX_VALIDITY_SECS: i64 = 2_592_000;    // 30 days
pub const DEFAULT_VALIDITY_SECS: i64 = 604_800;  // 7 days
pub const MAX_BATCH_SIZE: usize = 20;

// ═══════════════════════════════════════════
// Account Structs
// ═══════════════════════════════════════════

/// Global oracle configuration. One per deployment.
/// PDA: seeds = [ORACLE_STATE_SEED]
#[account]
#[derive(InitSpace)]
pub struct OracleState {
    pub admin: Pubkey,
    pub score_validity_secs: i64,
    pub is_paused: bool,
    pub total_scores_issued: u64,
    pub bump: u8,
}

/// Authority record for an oracle agent.
/// PDA: seeds = [ORACLE_AUTH_SEED, agent_pubkey]
#[account]
#[derive(InitSpace)]
pub struct OracleAuthority {
    pub agent: Pubkey,
    pub granted_by: Pubkey,
    pub granted_at: i64,
    pub is_active: bool,
    pub scores_pushed: u64,
    pub bump: u8,
}

/// Credit score for a borrower. Expires after validity window.
/// PDA: seeds = [CREDIT_SCORE_SEED, borrower_pubkey]
#[account]
#[derive(InitSpace)]
pub struct CreditScore {
    pub borrower: Pubkey,
    pub score: u16,
    pub confidence: u8,
    pub risk_tier: u8,
    pub timestamp: i64,
    pub expires_at: i64,
    pub model_hash: [u8; 32],
    pub zk_proof_hash: [u8; 32],
    pub oracle_agent: Pubkey,
    pub bump: u8,
}

/// Cumulative credit history. Updated on loan events.
/// PDA: seeds = [CREDIT_HISTORY_SEED, borrower_pubkey]
#[account]
#[derive(InitSpace)]
pub struct CreditHistory {
    pub borrower: Pubkey,
    pub total_loans: u16,
    pub repaid_loans: u16,
    pub defaulted_loans: u16,
    pub total_borrowed: u64,
    pub total_repaid: u64,
    pub first_loan_date: i64,
    pub last_activity: i64,
    pub bump: u8,
}

/// Maps a DID hash to a Solana wallet.
/// PDA: seeds = [DID_MAPPING_SEED, wallet_pubkey]
#[account]
#[derive(InitSpace)]
pub struct DidMapping {
    pub did: [u8; 32],
    pub wallet: Pubkey,
    pub registered_at: i64,
    pub bump: u8,
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

/// Pure function. No side effects.
pub fn calculate_risk_tier(score: u16) -> u8 {
    if score >= AAA_THRESHOLD { 4 }
    else if score >= AA_THRESHOLD { 3 }
    else if score >= A_THRESHOLD { 2 }
    else if score >= BB_THRESHOLD { 1 }
    else { 0 }
}

/// Check LTV limit for a risk tier (basis points).
pub fn max_ltv_for_tier(tier: u8) -> u16 {
    match tier {
        4 => 8000, // 80%
        3 => 6000, // 60%
        2 => 4000, // 40%
        1 => 2500, // 25%
        _ => 0,
    }
}

/// Suggested interest rate for a risk tier (basis points).
pub fn suggested_rate_for_tier(tier: u8) -> u16 {
    match tier {
        4 => 400,  // 4%
        3 => 650,  // 6.5%
        2 => 1000, // 10%
        1 => 1500, // 15%
        _ => 0,
    }
}

/// Max loan amount per tier (in token smallest unit, 6 decimals).
pub fn max_loan_for_tier(tier: u8) -> u64 {
    match tier {
        4 => 10_000_000_000, // 10,000 USDT
        3 => 5_000_000_000,  // 5,000 USDT
        2 => 2_000_000_000,  // 2,000 USDT
        1 => 500_000_000,    // 500 USDT
        _ => 0,
    }
}
