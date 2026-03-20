use anchor_lang::prelude::*;

#[event]
pub struct ScoreUpdated {
    pub borrower: Pubkey,
    pub score: u16,
}
