use anchor_lang::prelude::*;

#[account]
pub struct Loan {
    pub borrower: Pubkey,
    pub principal: u64,
    pub repaid_amount: u64,
    pub status: u8,
}

#[account]
pub struct EscrowVault {
    pub loan: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub status: u8,
}

#[account]
pub struct InstallmentSchedule {
    pub loan: Pubkey,
    pub total_installments: u8,
    pub paid_installments: u8,
    pub next_due_date: i64,
}

#[account]
pub struct Pool {
    pub mint: Pubkey,
    pub total_deposited: u64,
    pub total_borrowed: u64,
    pub accrued_interest_per_token: u128,
}
