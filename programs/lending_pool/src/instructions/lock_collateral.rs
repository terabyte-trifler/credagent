use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct LockCollateral {}

pub fn handler(_ctx: Context<LockCollateral>, _amount: u64) -> Result<()> {
    Ok(())
}
