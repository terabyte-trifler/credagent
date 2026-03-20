use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RegisterDid {}

pub fn handler(_ctx: Context<RegisterDid>, _did: String) -> Result<()> {
    Ok(())
}
