use anchor_lang::prelude::*;

#[account]
pub struct PermissionState {
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct AgentIdentity {
    pub authority: Pubkey,
    pub role: u8,
    pub daily_limit: u64,
    pub daily_spent: u64,
}
