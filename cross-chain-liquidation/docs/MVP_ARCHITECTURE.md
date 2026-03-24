# MVP Architecture

## Goal

This workspace isolates the smallest cross-chain liquidation MVP that CredAgent can ship without moving the lending core off Solana.

The system is split into three apps:

- `apps/solana-program`
- `apps/relayer`
- `apps/evm-liquidation`

## Happy path

1. Borrower takes a USDT loan on Solana and posts XAUT collateral.
2. CredAgent stores the loan in `LendingPool`.
3. XAUT remains locked in an escrow PDA.
4. Borrower misses repayment and exceeds the grace period.
5. Collection Agent marks the loan as defaulted on Solana.
6. Solana emits `LiquidationIntentReady`.
7. Relayer reads the event and builds a signed EVM liquidation payload.
8. EVM `LiquidationConfig` stores the active liquidation.
9. Uniswap v4 hook activates liquidation mode for the `WXAUT/USDT` pool.
10. Approved liquidator buys collateral and sends proceeds to the recovery sink.

## Demo pair

- Solana collateral: `XAUT`
- Solana debt asset: `USDT`
- EVM liquidation collateral: `WXAUT`
- EVM recovery asset: `USDT`
- Demo pool: `WXAUT/USDT`

## App boundaries

### `apps/solana-program`

Owns:

- loan state
- escrow PDA state
- default marking
- liquidation-intent emission

### `apps/relayer`

Owns:

- Solana event consumption
- payload validation
- signer flow
- EVM config submission

### `apps/evm-liquidation`

Owns:

- config contract
- v4 hook
- liquidation execution controls

## Canonical event shape

```text
loan_id
pool
borrower
collateral_mint
collateral_amount
debt_outstanding
minimum_recovery_target
liquidation_mode
liquidation_urgency
intent_expiry
nonce
target_chain_id
```

## Canonical EVM payload

```text
loan_id
borrower
collateral_token
amount_to_liquidate
debt_outstanding
minimum_recovery_target
liquidation_mode
liquidation_urgency
approved_liquidator
treasury_sink
fee_override_bps
treasury_fee_split_bps
max_liquidation_size
expiry
nonce
target_chain_id
source_program
```

## MVP scope

- one collateral asset
- one relayer
- one active liquidation at a time
- no bridge-back
- no auctions
- no multi-asset support
