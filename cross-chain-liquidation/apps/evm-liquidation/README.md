# EVM Liquidation

This app will contain the EVM-side liquidation execution layer.

Planned components:

- `LiquidationConfig` contract
- Uniswap v4 liquidation hook
- local tests for:
  - activation
  - approved liquidator gating
  - max sell size
  - treasury fee split
  - expiry handling

MVP target pair:

- `WXAUT/USDT`
