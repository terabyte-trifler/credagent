# @credagent/wdk-service

WDK wallet layer for CredAgent autonomous lending protocol on Solana.

## Modules

| Module | File | Phase | Description |
|--------|------|-------|-------------|
| **WalletService** | `src/walletService.js` | T1B.1 | Create wallets, check balances, send SOL/SPL tokens |
| **TokenOps** | `src/tokenOps.js` | T1B.2-3 | SPL approve/revoke (installment delegation) + Ed25519 signing |
| **BridgeService** | `src/bridgeService.js` | T1B.4 | USDT0 cross-chain bridge via WDK EVM protocol module |
| **AuditLog** | `src/auditLog.js` | — | Tamper-evident operation log with secret sanitization |
| **validate** | `src/validation.js` | — | Centralized input validation (addresses, amounts, agent IDs) |

## Setup

```bash
npm install
node scripts/verifySetup.js   # Verify WDK + devnet connection
node scripts/createTestTokens.js  # Create mock USDT/XAUT on devnet
```

## Test

```bash
npm test                  # All tests
npm run test:coverage     # With coverage report
```

## Security

- Seeds in `#private` class fields — inaccessible outside WalletService
- All inputs validated before any RPC/WDK call
- Audit log sanitizes 10+ sensitive key patterns
- Rate limiting: configurable max ops/hour per agent
- No floating point in financial calculations (BigInt only)
- Transfer safety caps: 100 SOL / 1M SPL tokens per transaction

See `../SECURITY.md` for full audit checklist.
