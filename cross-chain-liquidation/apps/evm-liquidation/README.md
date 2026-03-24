# EVM Liquidation

This app will contain the EVM-side liquidation execution layer.

Current Day 6 contents:

- `contracts/LiquidationConfig.sol`
- `scripts/compile.js`
- `artifacts/LiquidationConfig.json` after build

Implemented in `LiquidationConfig`:

- authorized updater and signer management
- signer validation via `ecrecover`
- active liquidation storage keyed by chain/pool/loan/nonce
- replay-safe nonce scope tracking
- expiry-aware active checks
- getter methods for hook execution config

Build:

- `npm install`
- `npm run build`

MVP target pair:

- `WXAUT/USDT`
