use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateScore {}

pub fn handler(
    _ctx: Context<UpdateScore>,
    _score: u16,
    _confidence: u8,
    _zk_hash: [u8; 32],
) -> Result<()> {
    Ok(())
}
