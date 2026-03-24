# Architecture Diagram

```mermaid
flowchart TD
    A["Solana Lending Core"] --> A1["Loan + Escrow PDA"]
    A --> A2["mark_default"]
    A2 --> A3["LiquidationIntentReady"]
    A3 --> B["Relayer"]
    B --> B1["Canonical payload hashing"]
    B --> B2["ECDSA signing"]
    B --> C["LiquidationConfig (EVM)"]
    C --> C1["Signer validation"]
    C --> C2["Active liquidation storage"]
    C --> C3["Expiry + nonce checks"]
    C --> D["LiquidationUniV4Hook"]
    D --> D1["beforeSwap gate"]
    D --> D2["afterSwap delta accounting"]
    D --> D3["Treasury + recovery settlement"]
    D --> E["Mock / Uniswap v4 Pool Manager"]
    E --> F["Approved Liquidator"]
    D --> G["Treasury Sink"]
    D --> H["Recovery Sink"]
    H --> I["Relayer recovery ledger"]
```

## Reading order

1. Solana originates and defaults the loan.
2. Relayer signs a canonical liquidation intent.
3. `LiquidationConfig` accepts only fresh, authorized intents.
4. `LiquidationUniV4Hook` enforces who can liquidate, how much can be sold, and how proceeds are split.
5. Treasury and recovery outputs are recorded for demo and judging.
