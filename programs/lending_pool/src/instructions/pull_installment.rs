use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct PullInstallment {}

pub fn handler(_ctx: Context<PullInstallment>) -> Result<()> {
    Ok(())
}
