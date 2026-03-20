use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Repay {}

pub fn handler(_ctx: Context<Repay>, _amount: u64) -> Result<()> {
    Ok(())
}
