use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG");

#[program]
pub mod agent_permissions {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    pub fn register_agent(ctx: Context<RegisterAgent>) -> Result<()> {
        instructions::register_agent::handler(ctx)
    }

    pub fn check_and_spend(
        ctx: Context<CheckAndSpend>,
        amount: u64,
    ) -> Result<()> {
        instructions::check_and_spend::handler(ctx, amount)
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        instructions::emergency_pause::handler(ctx)
    }

    pub fn set_daily_limit(
        ctx: Context<SetDailyLimit>,
        limit: u64,
    ) -> Result<()> {
        instructions::set_daily_limit::handler(ctx, limit)
    }
}
