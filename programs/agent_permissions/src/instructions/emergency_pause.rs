use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct EmergencyPause {}

pub fn handler(_ctx: Context<EmergencyPause>) -> Result<()> {
    Ok(())
}
