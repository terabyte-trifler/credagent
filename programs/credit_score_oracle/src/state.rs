use anchor_lang::prelude::*;

#[account]
pub struct CreditScore {
    pub borrower: Pubkey,
    pub score: u16,
    pub confidence: u8,
    pub risk_tier: u8,
    pub expires_at: i64,
    pub model_hash: [u8; 32],
    pub zk_proof_hash: [u8; 32],
}

#[account]
pub struct CreditHistory {
    pub borrower: Pubkey,
    pub total_loans: u64,
    pub repaid_loans: u64,
    pub defaulted_loans: u64,
}

#[account]
pub struct DidMapping {
    pub authority: Pubkey,
    pub wallet: Pubkey,
    pub did: String,
}
