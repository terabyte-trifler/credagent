use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;

use instructions::*;

declare_id!("Cred1111111111111111111111111111111111111111");

#[program]
pub mod credit_score_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, validity_secs: i64) -> Result<()> {
        instructions::initialize::handler(ctx, validity_secs)
    }

    pub fn grant_oracle_role(ctx: Context<GrantOracleRole>) -> Result<()> {
        instructions::grant_oracle_role::handler(ctx)
    }

    pub fn revoke_oracle_role(ctx: Context<RevokeOracleRole>) -> Result<()> {
        instructions::admin::handler_revoke(ctx)
    }

    pub fn update_score(
        ctx: Context<UpdateScore>,
        score: u16,
        confidence: u8,
        model_hash: [u8; 32],
        zk_proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::update_score::handler(ctx, score, confidence, model_hash, zk_proof_hash)
    }

    pub fn batch_update_scores(
        ctx: Context<BatchUpdateScores>,
        entries: Vec<batch_update::ScoreEntry>,
        model_hash: [u8; 32],
    ) -> Result<()> {
        instructions::batch_update::handler(ctx, entries, model_hash)
    }

    pub fn record_loan_issued(ctx: Context<RecordLoanEvent>, amount: u64) -> Result<()> {
        instructions::record_loan_event::handler_issued(ctx, amount)
    }

    pub fn record_loan_repaid(ctx: Context<RecordLoanEvent>, amount: u64) -> Result<()> {
        instructions::record_loan_event::handler_repaid(ctx, amount)
    }

    pub fn record_loan_defaulted(ctx: Context<RecordLoanEvent>) -> Result<()> {
        instructions::record_loan_event::handler_defaulted(ctx)
    }

    pub fn register_did(ctx: Context<RegisterDid>, did: [u8; 32]) -> Result<()> {
        instructions::register_did::handler(ctx, did)
    }

    pub fn pause(ctx: Context<AdminAction>) -> Result<()> {
        instructions::admin::handler_pause(ctx)
    }

    pub fn unpause(ctx: Context<AdminAction>) -> Result<()> {
        instructions::admin::handler_unpause(ctx)
    }

    pub fn set_validity_period(ctx: Context<AdminAction>, new_period: i64) -> Result<()> {
        instructions::admin::handler_set_validity(ctx, new_period)
    }
}
