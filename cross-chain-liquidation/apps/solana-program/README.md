# Solana Program

This app owns the Solana-side liquidation source of truth for the MVP.

Current implementation status:

- the live Anchor code still exists in `programs/lending_pool`
- `Loan`, escrow PDA linkage, `LoanStatus`, and `mark_default` are already implemented there
- `mark_default` now emits `LiquidationIntentReady`

Planned responsibility for this app:

- loan state
- escrow state
- default detection
- liquidation-intent emission

Next extraction step:

- mirror or move the liquidation-specific Solana code from `programs/lending_pool` into this app boundary when you are ready to split the codebase more aggressively
