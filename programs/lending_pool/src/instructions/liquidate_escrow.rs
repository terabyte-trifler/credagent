use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct LiquidateEscrow {}

pub fn handler(_ctx: Context<LiquidateEscrow>) -> Result<()> {
    Ok(())
}
