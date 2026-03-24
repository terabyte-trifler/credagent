# EVM Liquidation

This app will contain the EVM-side liquidation execution layer.

Current Day 7 contents:

- `contracts/LiquidationConfig.sol`
- `contracts/LiquidationHookCore.sol`
- `contracts/LiquidationUniV4Hook.sol`
- `scripts/compile.js`
- `artifacts/*.json` after build

Implemented in `LiquidationConfig`:

- authorized updater and signer management
- signer validation via `ecrecover`
- active liquidation storage keyed by chain/pool/loan/nonce
- replay-safe nonce scope tracking
- expiry-aware active checks
- getter methods for hook execution config

Implemented in `LiquidationHookCore`:

- active liquidation check
- approved-liquidator gate
- max-sell cap
- fee override lookup for hook consumers
- enforced proceeds routing to treasury and recovery sinks
- liquidation execution events with treasury sink metadata
- stateful sell-amount consumption tracking for recovery accounting

Implemented in `LiquidationUniV4Hook`:

- Uniswap v4-style `beforeSwap` and `afterSwap` callback surface
- derives `grossProceeds` from swap deltas instead of caller input
- validates pool direction against signed collateral token and configured proceeds token
- calls the core settlement path only after swap output is known

Build:

- `npm install`
- `npm run build`

MVP target pair:

- `WXAUT/USDT`
