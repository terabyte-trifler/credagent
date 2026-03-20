use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AccrueInterest {}

pub fn handler(_ctx: Context<AccrueInterest>) -> Result<()> {
    Ok(())
}
