use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetDailyLimit {}

pub fn handler(_ctx: Context<SetDailyLimit>, _limit: u64) -> Result<()> {
    Ok(())
}
