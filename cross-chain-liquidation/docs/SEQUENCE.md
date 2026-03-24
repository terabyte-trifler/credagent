# Sequence

```mermaid
sequenceDiagram
    participant B as Borrower (Solana)
    participant S as Solana Program
    participant C as Collection Agent
    participant R as Relayer
    participant E as EVM Config
    participant PM as Pool Manager
    participant H as Uniswap v4 Hook
    participant L as Liquidator
    participant T as Treasury Sink
    participant X as Recovery Sink

    B->>S: Borrow with XAUT collateral
    S-->>B: Loan active, escrow locked
    B--xS: Miss repayment
    C->>S: mark_default
    S->>R: Emit LiquidationIntentReady
    R->>E: Submit signed liquidation payload
    E->>H: Activate liquidation mode
    L->>PM: Swap through WXAUT/USDT pool
    PM->>H: beforeSwap callback
    H->>H: Check active intent, liquidator, sell cap
    PM->>H: afterSwap callback with swap deltas
    H->>H: Derive gross proceeds from callback deltas
    H->>T: Route treasury fee
    H->>X: Route lender recovery
    H-->>R: Emit liquidation execution event
```

## Notes

- Solana remains the loan source of truth
- the relayer bridges default state into EVM execution
- `LiquidationConfig` controls freshness, signer validation, and liquidation scope
- local demo mode uses a mock pool manager to exercise the callback settlement path
