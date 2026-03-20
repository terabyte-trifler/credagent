use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateSchedule {}

pub fn handler(_ctx: Context<CreateSchedule>) -> Result<()> {
    Ok(())
}
