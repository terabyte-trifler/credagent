use anchor_lang::prelude::*;
use crate::state::{LiquidationMode, LiquidationUrgency};

#[event]
pub struct PoolInitialized { pub pool: Pubkey, pub token_mint: Pubkey, pub authority: Pubkey }
#[event]
pub struct Deposited { pub depositor: Pubkey, pub amount: u64, pub total_deposited: u64 }
#[event]
pub struct Withdrawn { pub to: Pubkey, pub amount: u64, pub total_deposited: u64 }
#[event]
pub struct CollateralLocked { pub loan_id: u64, pub borrower: Pubkey, pub mint: Pubkey, pub amount: u64 }
#[event]
pub struct LoanDisbursed {
    pub loan_id: u64, pub borrower: Pubkey, pub agent: Pubkey,
    pub principal: u64, pub rate_bps: u16, pub due_date: i64,
    pub decision_hash: [u8; 32],
}
#[event]
pub struct ScheduleCreated { pub loan_id: u64, pub installments: u8, pub amount_each: u64, pub interval_secs: i64 }
#[event]
pub struct InstallmentPulled { pub loan_id: u64, pub amount: u64, pub paid: u8, pub remaining: u8 }
#[event]
pub struct InterestAccrued { pub pool: Pubkey, pub old_index: u128, pub new_index: u128, pub elapsed: i64 }
#[event]
pub struct LoanRepaid { pub loan_id: u64, pub borrower: Pubkey, pub amount: u64, pub remaining: u64 }
#[event]
pub struct LoanFullyRepaid { pub loan_id: u64, pub borrower: Pubkey, pub total_paid: u64 }
#[event]
pub struct CollateralReleased { pub loan_id: u64, pub borrower: Pubkey, pub amount: u64 }
#[event]
pub struct CollateralLiquidated { pub loan_id: u64, pub amount: u64 }
#[event]
pub struct LoanDefaulted { pub loan_id: u64, pub borrower: Pubkey, pub outstanding: u64 }
#[event]
pub struct LiquidationIntentReady {
    pub loan_id: u64,
    pub pool: Pubkey,
    pub borrower: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub debt_outstanding: u64,
    pub minimum_recovery_target: u64,
    pub liquidation_mode: LiquidationMode,
    pub liquidation_urgency: LiquidationUrgency,
    pub intent_expiry: i64,
    pub nonce: u64,
    pub target_chain_id: u64,
}
