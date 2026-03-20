use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RegisterAgent {}

pub fn handler(_ctx: Context<RegisterAgent>) -> Result<()> {
    Ok(())
}
