use anchor_lang::prelude::*;
use crate::state::*;
use crate::events::DidRegistered;

#[derive(Accounts)]
pub struct RegisterDid<'info> {
    #[account(seeds = [ORACLE_STATE_SEED], bump = oracle_state.bump, has_one = admin)]
    pub oracle_state: Account<'info, OracleState>,
    #[account(
        init,
        payer = admin,
        space = 8 + DidMapping::INIT_SPACE,
        seeds = [DID_MAPPING_SEED, wallet.key().as_ref()],
        bump,
    )]
    pub did_mapping: Account<'info, DidMapping>,
    /// CHECK: Wallet being mapped to DID.
    pub wallet: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterDid>, did: [u8; 32]) -> Result<()> {
    let m = &mut ctx.accounts.did_mapping;
    m.did = did;
    m.wallet = ctx.accounts.wallet.key();
    m.registered_at = Clock::get()?.unix_timestamp;
    m.bump = ctx.bumps.did_mapping;
    emit!(DidRegistered { did, wallet: m.wallet });
    Ok(())
}
