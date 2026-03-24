# Day 1 MVP Freeze

## Goal

Day 1 freezes the smallest cross-chain liquidation MVP that CredAgent can build in 10 days without rewriting the Solana lending core.

This day does not add the full relayer or EVM contracts yet. It locks the architecture contract between the three pieces that will need to interoperate:

- Solana lending state
- relayer message format
- EVM liquidation configuration

## Exact happy path

1. Borrower takes a USDT loan on Solana and posts XAUT collateral.
2. CredAgent stores the loan in `LendingPool`.
3. XAUT remains locked in an escrow PDA.
4. Borrower misses repayment and exceeds the grace period.
5. Collection Agent marks the loan as defaulted on Solana.
6. Solana emits a liquidation-ready event with collateral, debt, expiry, and nonce.
7. Relayer reads the event and builds a signed EVM liquidation payload.
8. EVM `LiquidationConfig` stores the active liquidation.
9. Uniswap v4 hook activates liquidation mode for the `WXAUT/USDT` pool.
10. Approved liquidator buys collateral and sends proceeds to the protocol recovery sink.

## Frozen demo pair

- Solana collateral: `XAUT`
- Solana debt asset: `USDT`
- EVM liquidation collateral: `WXAUT`
- EVM recovery asset: `USDT`
- Demo EVM pool: `WXAUT/USDT`
- Target chain: Ethereum mainnet semantics for payload shape

For the MVP, `WXAUT` can be a wrapped or mocked EVM representation used only for demo execution.

## Frozen Solana account model

Existing accounts already cover most of the Day 1 need:

- `PoolState`
- `Loan`
- `EscrowVaultState`
- `InstallmentSchedule`

The Day 1 liquidation view of those accounts is:

### `Loan`

- `loan_id`
- `pool`
- `borrower`
- `principal`
- `repaid_amount`
- `status`
- `due_date`
- `escrow`

### `EscrowVaultState`

- `loan_id`
- `borrower`
- `collateral_mint`
- `collateral_amount`
- `status`

## Frozen Solana event schema

The existing `LoanDefaulted` event is not sufficient for relaying cross-chain liquidation because it does not include collateral metadata, expiry, replay protection, or recovery targets.

Day 1 therefore freezes a new event shape:

```text
LiquidationIntentReady
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

## Frozen relayer payload

The relayer will canonicalize the Solana event into this EVM-facing payload:

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

## Frozen EVM config state

The first EVM contract only needs enough storage for one active liquidation at a time:

- `active`
- `loanId`
- `approvedLiquidator`
- `collateralToken`
- `amountToLiquidate`
- `minimumRecoveryTarget`
- `feeOverrideBps`
- `treasuryFeeSplitBps`
- `maxLiquidationSize`
- `expiry`
- `nonce`

## Day 1 scope decisions

- single collateral asset: yes
- single recovery asset: yes
- single relayer: yes
- single active liquidation at a time: yes
- bridge proceeds back to Solana: no
- auction engine: no
- multi-asset liquidation: no
- volatility logic: no

## Audit findings from current code

### 1. Critical: defaulted collateral can be redirected to an arbitrary recipient

In [`programs/lending_pool/src/instructions/liquidate_escrow.rs`](/Users/terabyte_trifler/Documents/credagent/programs/lending_pool/src/instructions/liquidate_escrow.rs), `liquidation_recipient` is unconstrained and the instruction is permissionless once a loan is defaulted.

Impact:

Any caller can send seized collateral to any compatible token account instead of a protocol-controlled recovery sink.

Day 1 implication:

The cross-chain MVP must introduce a protocol-owned recovery sink invariant before using this instruction in production.

### 2. High: default event is too thin for a relayer

In [`programs/lending_pool/src/events.rs`](/Users/terabyte_trifler/Documents/credagent/programs/lending_pool/src/events.rs), `LoanDefaulted` only emits `loan_id`, `borrower`, and `outstanding`.

Impact:

The relayer cannot reconstruct liquidation intent deterministically without extra account fetches and protocol assumptions.

Day 1 implication:

A dedicated `LiquidationIntentReady` event is required.

### 3. High: outstanding debt at default ignores streamed interest

In [`programs/lending_pool/src/instructions/mark_default.rs`](/Users/terabyte_trifler/Documents/credagent/programs/lending_pool/src/instructions/mark_default.rs), `outstanding` is computed as `principal - repaid_amount`.

Impact:

Cross-chain recovery logic would underestimate debt whenever interest accrued before default.

Day 1 implication:

`debt_outstanding` for liquidation must be defined as the full settlement amount, not just unpaid principal.

## Code artifacts added on Day 1

- on-chain liquidation enums and event shape in the lending program
- typed schema and validators in [`scripts/cross-chain/day1-mvp-schema.ts`](/Users/terabyte_trifler/Documents/credagent/scripts/cross-chain/day1-mvp-schema.ts)

These artifacts intentionally freeze the interface first so Days 2-10 can implement against a stable contract.
