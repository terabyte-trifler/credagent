use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct MarkDefault {}

pub fn handler(_ctx: Context<MarkDefault>) -> Result<()> {
    Ok(())
}
