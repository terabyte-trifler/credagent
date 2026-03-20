use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE");

#[program]
pub mod credit_score_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn update_score(
        ctx: Context<UpdateScore>,
        score: u16,
        confidence: u8,
        zk_hash: [u8; 32],
    ) -> Result<()> {
        instructions::update_score::handler(ctx, score, confidence, zk_hash)
    }

    pub fn batch_update(_ctx: Context<BatchUpdate>) -> Result<()> {
        Ok(())
    }

    pub fn record_loan_event(_ctx: Context<RecordLoanEvent>) -> Result<()> {
        Ok(())
    }

    pub fn register_did(
        ctx: Context<RegisterDid>,
        did: String,
    ) -> Result<()> {
        instructions::register_did::handler(ctx, did)
    }
}
