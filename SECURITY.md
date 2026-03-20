# Security Policy — CredAgent

## Audit Checklist

### Solana Programs (Rust/Anchor)
- [x] All arithmetic uses `checked_add`/`checked_sub`/`checked_mul`/`checked_div` — no raw operators on financial values
- [x] No `as u64` unchecked casts — `u64::try_from()` or intermediate u128
- [x] All PDAs use named constant seeds (`POOL_SEED`, `ESCROW_SEED`, etc.)
- [x] Every account validated via Anchor `has_one`, `constraint`, `seeds/bump`
- [x] Every `UncheckedAccount` has `/// CHECK:` doc comment
- [x] Token transfers ONLY via SPL Token CPI — no raw lamport manipulation
- [x] Escrow vaults program-owned (PDA authority) — no EOA custody
- [x] All state changes emit structured events
- [x] Named error codes for every failure path (`OracleError::*`, `LendError::*`, `PermError::*`)
- [x] `overflow-checks = true` in `Cargo.toml` release profile
- [x] Conditional disbursement validates 4 gates atomically — partial pass impossible
- [x] Installment pull_installment prevents double-pull via counter
- [x] Escrow release/liquidation sets status to prevent re-entry
- [x] Interest streaming uses u128 precision to prevent rounding attacks
- [x] Grace period enforced before default (no premature liquidation)
- [x] Daily spending limits with epoch-based reset and cumulative tracking

## Threat Model
| Threat | Mitigation |
|--------|-----------|
| Fake credit scores | Oracle role requires admin grant; scores validated [300,850] on-chain |
| Spending limit bypass | Cumulative daily tracking in `check_and_spend`; resets on epoch boundary |
| Escrow drain | PDA-owned vault; release requires Loan.status == Repaid; liquidate requires Defaulted |
| Double installment pull | `paid_installments` counter incremented atomically; checked against total |
| Interest manipulation | Pool index uses u128 math with 1e18 precision; updated from on-chain clock only |
| Premature default | `due_date + GRACE_PERIOD_SECS` enforced; cannot default early |
| Conditional gate bypass | All 4 checks in single instruction; any failure reverts entire tx |
