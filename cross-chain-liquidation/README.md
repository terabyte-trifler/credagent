# Cross-Chain Liquidation

This workspace isolates the Solana-to-EVM liquidation MVP from the rest of CredAgent.

It is organized as:

```text
cross-chain-liquidation/
  apps/
    solana-program/
    relayer/
    evm-liquidation/
  docs/
    MVP_ARCHITECTURE.md
    SEQUENCE.md
  scripts/
    demo/
```

The existing CredAgent repo still contains the production Solana code in `programs/lending_pool`, but this workspace is now the canonical place for the cross-chain liquidation MVP plan and app-specific scaffolding.
