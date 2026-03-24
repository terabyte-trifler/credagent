# Relayer

This app owns the off-chain bridge between Solana defaults and EVM liquidation activation.

Responsibilities:

- read `LiquidationIntentReady` from Solana
- validate event freshness and replay fields
- serialize the canonical EVM liquidation payload
- sign and submit payloads to the EVM config contract
- record submission and settlement lifecycle
- persist recovery execution records for lender accounting

Day 4 MVP skeleton now includes:

- `src/config.ts`: environment-driven runtime config
- `src/solanaReader.ts`: Solana liquidation intent reader interfaces and polling adapter
- `src/evmClient.ts`: EVM config-contract submission client interfaces and dry-run/http adapters
- `src/service.ts`: relayer orchestration, validation, dedupe, and lifecycle state transitions
- `src/logger.ts`: structured JSON logging
- `src/store.ts`: lifecycle ledger for discovered/submitted/executed intents plus recovery records

Suggested env vars:

- `SOLANA_RPC_URL`
- `SOLANA_PROGRAM_ID`
- `EVM_RPC_URL`
- `EVM_CHAIN_ID`
- `EVM_CONFIG_CONTRACT`
- `APPROVED_LIQUIDATOR`
- `TREASURY_SINK`
- `RECOVERY_SINK`
- `COLLATERAL_TOKEN`
- `FEE_OVERRIDE_BPS`
- `TREASURY_FEE_SPLIT_BPS`
- `POLL_INTERVAL_MS`
- `MAX_BATCH_SIZE`
- `RELAYER_DRY_RUN`
