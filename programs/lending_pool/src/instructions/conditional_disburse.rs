use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ConditionalDisburse {}

pub fn handler(_ctx: Context<ConditionalDisburse>, _amount: u64) -> Result<()> {
    Ok(())
}
