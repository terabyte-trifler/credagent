# Relayer

This app owns the off-chain bridge between Solana defaults and EVM liquidation activation.

Responsibilities:

- read `LiquidationIntentReady` from Solana
- validate event freshness and replay fields
- serialize the canonical EVM liquidation payload
- sign and submit payloads to the EVM config contract
- record submission and settlement lifecycle
