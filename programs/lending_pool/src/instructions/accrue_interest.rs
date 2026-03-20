use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::LendError;
use crate::events::InterestAccrued;

/// PAYMENT PRIMITIVE 5: Interest Streaming
///
/// Updates the pool's cumulative interest index based on elapsed time.
/// Called implicitly on every pool interaction (deposit, repay, query).
/// Interest accrues per-second using the formula:
///   new_index = old_index + (old_index * rate * dt) / (YEAR * BPS)
///
/// Individual loan interest is calculated as:
///   owed = principal * (current_index - snapshot_index) / PRECISION
///
/// AUDIT:
/// - All math in u128 to prevent intermediate overflow
/// - compute_new_index returns None on overflow (caught by ok_or)
/// - No external input — uses on-chain clock and pool state only
/// - Idempotent if called multiple times in same slot (elapsed = 0)
#[derive(Accounts)]
pub struct AccrueInterest<'info> {
    #[account(
        mut, seeds = [POOL_SEED, pool_state.token_mint.as_ref()],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,
}

pub fn handler(ctx: Context<AccrueInterest>) -> Result<()> {
    let p = &mut ctx.accounts.pool_state;
    let now = Clock::get()?.unix_timestamp;

    let elapsed = now.saturating_sub(p.last_update_ts);
    if elapsed <= 0 {
        return Ok(()); // No time passed, nothing to accrue
    }

    // Only accrue if there are active borrows
    if p.total_borrowed == 0 {
        p.last_update_ts = now;
        return Ok(());
    }

    let old_index = p.interest_index;

    // Dynamic rate: base_rate * utilization / 100 (higher utilization = higher rate)
    let util = utilization_bps(p.total_deposited, p.total_borrowed);
    let effective_rate = (p.base_rate_bps as u128)
        .checked_mul(util as u128)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .unwrap_or(p.base_rate_bps as u128) as u16;

    let new_index = compute_new_index(old_index, effective_rate, elapsed)
        .ok_or(LendError::Overflow)?;

    p.interest_index = new_index;
    p.last_update_ts = now;

    emit!(InterestAccrued {
        pool: ctx.accounts.pool_state.key(),
        old_index,
        new_index,
        elapsed,
    });

    Ok(())
}

/// Helper: calculate total owed on a loan given current pool index.
/// Call this from any instruction that needs to know current debt.
pub fn total_owed(loan: &Loan, current_index: u128) -> Result<u64> {
    let interest = compute_interest_owed(loan.principal, current_index, loan.index_snapshot)
        .ok_or(LendError::Overflow)?;
    loan.principal.checked_add(interest).ok_or(LendError::Overflow.into())
}
