# CredAgent — Technical Architecture

## System Overview

CredAgent is a 4-layer autonomous lending protocol:

```
Agent Layer → Safety Layer → MCP/WDK Layer → Smart Contract Layer
(reason)      (validate)     (execute)        (enforce)
```

### Design Principle: Defense in Depth
Every financial decision passes through multiple independent validation layers.
The LLM can reason freely, but CANNOT move money without:
1. Safety middleware tier + limit check (JS)
2. MCP tool schema validation (JS)
3. On-chain CPI permission check (Rust)
4. On-chain program constraint validation (Rust)

## Layer 1: Agent Layer (OpenClaw)

Four specialized agents, each with a SKILL.md defining their behavior:

### Credit Assessment Agent (Tier 1 — Operate)
- **Input:** Solana wallet address
- **Process:** Extract 14 on-chain features → XGBoost prediction → FICO scoring
- **Output:** Score [300-850], risk tier, ZK proof hash → pushed to CreditScoreOracle PDA
- **Safety:** Score range validated, staleness cache, push cooldown (1h)

### Lending Decision Agent (Tier 2 — Manage)
- **Input:** Loan request (amount, duration)
- **Process:** Score check → term generation → 3-round bounded negotiation → execution
- **Output:** lock_collateral → conditional_disburse → create_schedule
- **Safety:** Tier constraints hard-enforced, reasoning hashed before on-chain, all 4 gates atomic

### Collection Tracker Agent (Tier 1 — Operate)
- **Input:** Active installment schedules
- **Process:** Poll due dates → preflight balance check → pull via delegate → grace period → default
- **Output:** pull_installment or mark_default → liquidate_escrow
- **Safety:** Grace period enforced (3 days), notifications sent before default

### Yield Optimizer Agent (Tier 2 — Manage)
- **Input:** Pool utilization metrics
- **Process:** Kink rate model → optimal rate → bridge evaluation
- **Output:** Rate adjustment or USDT0 cross-chain bridge
- **Safety:** Bridge disabled without configured vaults, zero-address guard, 30% bridge cap

## Layer 2: Safety Layer

### 4-Tier Permission Model
```
Tier 0 — READ:    Balance queries, score lookups
Tier 1 — OPERATE: Send tokens, pull installments, push scores
Tier 2 — MANAGE:  Disburse loans, lock collateral, bridge capital
Tier 3 — ADMIN:   Pause, register agents, rotate admin (HUMAN-ONLY)
```

### Circuit Breaker
- Tracks cumulative 24h losses vs deposits snapshot
- Auto-pauses at 10% loss ratio
- Requires manual admin reset + separate unpause (two-step recovery)

### Escrow-Preserving Pause
- Paused: blocks new loans, pulls, bridges
- Allowed: reads, repayments, default processing, notifications
- Escrow PDAs: remain locked, funds inaccessible but safe

### Time-Locked Admin Rotation
- 48-hour delay between request and finalization
- Both old and new admin can finalize
- Current admin can cancel during delay window

## Layer 3: Wallet Layer (Tether WDK)

### WalletService
- 24-word BIP-39 seed via WDK CSPRNG
- Seeds in `#private` class fields (JS language-level protection)
- SPL token operations: balance, send, approve delegate

### MCP Bridge (12 Tools)
```
WALLET:  create_wallet, get_balance, send_sol, send_token
CREDIT:  compute_credit_score, check_eligibility, get_default_probability
PAYMENT: lock_collateral, conditional_disburse, create_installment_schedule,
         pull_installment, bridge_usdt0
```

### USDT0 Bridge
- Cross-chain via @tetherto/wdk-protocol-bridge-usdt0-evm
- Targets: Ethereum, Arbitrum, Polygon, Optimism
- Hard-disabled without configured vault addresses

## Layer 4: Smart Contract Layer (Solana/Anchor)

### CreditScoreOracle (12 instructions)
- `update_score`: Stores ML-computed score [300-850] with model_hash + zk_proof_hash
- `batch_update`: Up to 20 scores per tx
- `record_loan_issued/repaid/defaulted`: Credit history tracking
- `register_did`: DID-to-wallet mapping

### LendingPool (12 instructions, 7 payment primitives)
- Interest streaming: u128 precision (1e18), per-epoch accrual
- Escrow vaults: PDA-owned, program-controlled release/liquidation
- Conditional disburse: 4-gate atomic (score + escrow + utilization + agent CPI)

### AgentPermissions (10 instructions)
- 4-tier permission model with `has_permission()` comparison
- `check_permission_and_spend()`: CPI-callable, atomic tier + limit check
- Circuit breaker: `record_loss()` with 24h rolling window
- Admin rotation: request → 48h delay → finalize/cancel

## Data Flow: Golden Path

```
1. Credit Agent → ML API → score 720 (AA) → update_score PDA
2. Borrower → lock_collateral → escrow PDA (1.5 XAUT)
3. Lending Agent → conditional_disburse:
   ├─ Gate 1: score PDA → 720 AA, not expired ✓
   ├─ Gate 2: escrow PDA → status=Locked ✓
   ├─ Gate 3: pool state → 6% util < 80% ✓
   └─ Gate 4: CPI check_permission_and_spend → tier=Manage, limit OK ✓
   → 3,000 USDT transferred from pool vault to borrower ATA
4. Lending Agent → create_schedule → 6 × 500 USDT every 10 days
5. Collection Agent → pull_installment × 6 (via SPL delegate)
6. Loan fully repaid → release_collateral → 1.5 XAUT back to borrower
```

## Interest Math

```
new_index = old_index + (old_index × rate × dt) / (YEAR × BPS)
interest_owed = principal × (current_index - snapshot_index) / PRECISION

Where:
  PRECISION = 1e18 (u128)
  YEAR = 31,536,000 seconds
  BPS = 10,000
  rate = dynamic (kink model based on utilization)
```

## ML Credit Scoring

- **Model:** XGBoost classifier (200 trees, depth 6)
- **Features:** 14 on-chain categories (tx history, DeFi usage, repayment behavior)
- **Output:** P(default) → FICO mapping → score [300-850]
- **Weights:** Payment History 35%, Utilization 30%, History Length 15%, Diversity 10%, New Credit 10%
- **Audit:** Model SHA-256 hash stored on-chain with every score
