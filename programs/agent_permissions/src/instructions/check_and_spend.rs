use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CheckAndSpend {}

pub fn handler(_ctx: Context<CheckAndSpend>, _amount: u64) -> Result<()> {
    Ok(())
}
