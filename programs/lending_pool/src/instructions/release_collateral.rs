use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ReleaseCollateral {}

pub fn handler(_ctx: Context<ReleaseCollateral>) -> Result<()> {
    Ok(())
}
