use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Withdraw {}

pub fn handler(_ctx: Context<Withdraw>, _amount: u64) -> Result<()> {
    Ok(())
}
