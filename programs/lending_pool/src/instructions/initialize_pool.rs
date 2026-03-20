use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializePool {}

pub fn handler(_ctx: Context<InitializePool>) -> Result<()> {
    Ok(())
}
