use anchor_lang::prelude::*;

#[event]
pub struct LoanDisbursed {
    pub borrower: Pubkey,
    pub amount: u64,
}
