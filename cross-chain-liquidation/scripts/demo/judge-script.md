# Judge Script

## One-line pitch

CredAgent keeps lending and default detection on Solana, then activates a Uniswap v4 liquidation hook on EVM only when a real default occurs.

## Demo flow

1. Show the Solana side:
   - loans live in the Solana lending pool
   - XAUT collateral is locked in escrow
   - a missed payment emits `LiquidationIntentReady`
2. Show the relayer:
   - it reads the liquidation intent
   - it canonicalizes and signs the payload
   - it submits the signed intent to `LiquidationConfig`
3. Show the EVM side:
   - `LiquidationConfig` verifies signer, nonce, expiry, and chain id
   - `LiquidationUniV4Hook` activates liquidation mode for `WXAUT/USDT`
4. Show execution:
   - an approved liquidator swaps through the hook-controlled pool
   - the hook derives proceeds from swap callback deltas
   - the hook routes treasury and recovery amounts on-chain
5. Show hardening:
   - unauthorized liquidator fails
   - expired liquidation fails
   - sell-cap overflow fails

## What is live in the local MVP

- Solana default and liquidation-intent model
- standalone relayer with canonical hashing and ECDSA signing
- EVM config contract with signer validation, nonce protection, and expiry checks
- callback-based liquidation hook with treasury and recovery routing
- Day 9 happy-path demo output
- Day 10 failure-case hardening output

## What is mocked for local demo

- Solana log ingestion uses a static local event fixture
- Uniswap v4 settlement uses a mock pool manager instead of the full production package
- bridge-back to Solana is ledger-accounted, not executed

## Why the hook matters

Without the hook, liquidation is just a normal swap. With the hook, the protocol can enforce:

- who is allowed to liquidate
- how much collateral can be sold
- what fee override applies
- how treasury and lender recovery are split

## Files to point at during the demo

- `cross-chain-liquidation/apps/relayer/src/day9-local-demo.ts`
- `cross-chain-liquidation/apps/relayer/src/day10-hardening-demo.ts`
- `cross-chain-liquidation/apps/evm-liquidation/contracts/LiquidationConfig.sol`
- `cross-chain-liquidation/apps/evm-liquidation/contracts/LiquidationUniV4Hook.sol`
- `cross-chain-liquidation/scripts/demo/day9-local-demo-output.json`
- `cross-chain-liquidation/scripts/demo/day10-hardening-output.json`
