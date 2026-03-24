# EVM Liquidation

This app will contain the EVM-side liquidation execution layer.

Current Day 7 contents:

- `contracts/LiquidationConfig.sol`
- `contracts/LiquidationHookCore.sol`
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
- treasury fee split lookup for hook consumers

Build:

- `npm install`
- `npm run build`

MVP target pair:

- `WXAUT/USDT`
