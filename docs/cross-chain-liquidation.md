# Cross-Chain Liquidation

## Overview

CredAgent keeps its lending core on Solana and uses EVM only for liquidation execution.

When a borrower defaults, the Collection Agent produces a liquidation decision from Solana loan state. A relayer turns that decision into a signed liquidation intent on EVM, where a Uniswap v4 hook controls how collateral is sold into liquidity and how recovery proceeds are routed.

This gives CredAgent a clean cross-chain story:

- Solana remains the source of truth for loans, collateral, installments, and defaults
- EVM provides programmable liquidation execution and deeper stablecoin liquidity
- agents coordinate recovery without moving the entire lending protocol off Solana

## Why this exists

The goal is not to rebuild CredAgent on EVM.

The goal is to preserve the current Solana architecture while extending default recovery with a controlled liquidation venue. Uniswap v4 hooks are useful here because they let the protocol enforce liquidation-specific execution rules at swap time.

## System components

### Solana

- `LendingPool`
- `CreditScoreOracle`
- escrow PDA holding XAUT collateral
- installment and default state
- Collection Agent and Lending Agent inside the MCP runtime

Responsibilities:

- originate loans
- lock XAUT collateral in escrow
- monitor repayments and grace periods
- mark defaults
- compute liquidation parameters

### Liquidation intent relayer

An off-chain service listens for defaulted loans and converts them into compact EVM instructions.

It can live:

- inside the MCP runtime, or
- as a standalone service

Responsibilities:

- read defaulted loan state
- compute liquidation payloads
- attach an authorized protocol signature
- submit the payload to EVM
- record audit history

### EVM liquidation config contract

A lightweight EVM contract stores the currently active liquidation instruction for the hook.

Responsibilities:

- verify the authorized updater or signer
- store active liquidation parameters
- expose trusted configuration to the hook
- enforce expiry and nonce handling

Suggested parameters:

- `loanId`
- `approvedLiquidator`
- `collateralToken`
- `stableToken`
- `maxLiquidationSize`
- `minRecoveryTarget`
- `feeOverrideBps`
- `treasuryFeeSplitBps`
- `expiry`
- `active`

### Uniswap v4 liquidation hook

The hook is attached to a collateral/stablecoin pool such as `XAUT/USDT`.

Responsibilities:

- enable liquidation-mode behavior only when an active config exists
- restrict execution to approved liquidators or agent-owned addresses
- apply a liquidation-specific fee policy
- cap amount sold per swap or interval
- route a fee share to treasury
- emit liquidation events

This turns the pool into a controlled liquidation venue instead of a fully unrestricted market.

### Market participants

- protocol-designated liquidators
- arbitrageurs
- market makers

They absorb distressed collateral and provide recovery liquidity under protocol-defined rules.

### Recovery sink

After liquidation:

- recovered stablecoins go to an EVM treasury or recovery sink
- the relayer records the recovered amount
- CredAgent reflects recovery in Solana or off-chain accounting
- funds can later be bridged back or treated as treasury recovery / bad-debt offset

## Liquidation intent format

Suggested payload:

```text
loan_id
borrower_id
collateral_asset
amount_to_liquidate
debt_outstanding
minimum_recovery_target
liquidation_mode
expiry
nonce
chain_id
auth_signature
```

Minimum meaning of the fields:

- `amount_to_liquidate`: how much collateral should be sold
- `minimum_recovery_target`: minimum acceptable stablecoin recovery
- `liquidation_mode`: execution policy such as immediate, partial, or urgent
- `expiry`: deadline after which the intent is invalid
- `nonce`: replay protection

## End-to-end flow

1. Borrower takes a loan on Solana.
2. XAUT collateral is locked in an escrow PDA.
3. Borrower misses repayment and exits the grace period.
4. Collection Agent marks the loan as defaulted.
5. Relayer reads loan state and creates a signed liquidation intent.
6. EVM config contract validates and stores the liquidation parameters.
7. Uniswap v4 hook activates liquidation mode for the configured pool.
8. Approved liquidators purchase collateral through the hook-controlled pool.
9. Stablecoin proceeds are sent to the protocol recovery sink.
10. Recovery is written back into CredAgent accounting.

## Agent ownership

How the current agent model maps into this flow:

- Credit Agent: contributes pre-default risk context
- Lending Agent: owns origination and collateral terms
- Collection Agent: detects default and triggers liquidation intent
- Yield Agent: optimizes recovered capital after settlement

Primary owner of this extension:

- Collection Agent

Reason:

Cross-chain liquidation is a recovery and default-handling workflow, not a loan origination workflow.

## Trust boundaries

### Solana side

Trusted as the source of truth for:

- loan terms
- collateral state
- repayment schedules
- default status

### Relayer

Trusted to:

- serialize the correct loan state
- submit only fresh, authorized intents
- prevent replay and stale execution

### EVM contract and hook

Trusted to:

- reject unauthorized updates
- enforce hook-controlled liquidation rules
- expose observable execution history

## Best MVP cut

The smallest real MVP should include:

- one Solana default event source
- one off-chain relayer
- one EVM liquidation config contract
- one Uniswap v4 hook with:
  - approved caller check
  - liquidation fee override
  - max sell size
  - treasury fee split

Skip for MVP:

- bridging proceeds back to Solana
- auction logic
- multi-asset liquidation support
- volatility-aware pricing logic
- advanced treasury routing

## Why this architecture works

- preserves the Solana-native lending core
- uses EVM only where programmable liquidity matters most
- gives the hackathon project a clear and credible cross-chain story
- makes the Uniswap v4 hook essential to the design instead of decorative

## Judge-friendly explanation

CredAgent originates and monitors loans on Solana. When a borrower defaults, the Collection Agent triggers a liquidation intent that activates a Uniswap v4 hook on EVM. That hook controls how collateral is sold into liquidity by restricting who can liquidate, how much can be sold, and how recovery fees are distributed.
