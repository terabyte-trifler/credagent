use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid");

#[program]
pub mod lending_pool {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        instructions::initialize_pool::handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    pub fn lock_collateral(ctx: Context<LockCollateral>, amount: u64) -> Result<()> {
        instructions::lock_collateral::handler(ctx, amount)
    }

    pub fn conditional_disburse(
        ctx: Context<ConditionalDisburse>,
        amount: u64,
    ) -> Result<()> {
        instructions::conditional_disburse::handler(ctx, amount)
    }

    pub fn create_schedule(ctx: Context<CreateSchedule>) -> Result<()> {
        instructions::create_schedule::handler(ctx)
    }

    pub fn pull_installment(ctx: Context<PullInstallment>) -> Result<()> {
        instructions::pull_installment::handler(ctx)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::handler(ctx, amount)
    }

    pub fn accrue_interest(ctx: Context<AccrueInterest>) -> Result<()> {
        instructions::accrue_interest::handler(ctx)
    }

    pub fn release_collateral(ctx: Context<ReleaseCollateral>) -> Result<()> {
        instructions::release_collateral::handler(ctx)
    }

    pub fn liquidate_escrow(ctx: Context<LiquidateEscrow>) -> Result<()> {
        instructions::liquidate_escrow::handler(ctx)
    }

    pub fn mark_default(ctx: Context<MarkDefault>) -> Result<()> {
        instructions::mark_default::handler(ctx)
    }
}
