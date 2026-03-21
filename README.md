# CredAgent — Autonomous Lending on Solana

> AI agents make lending decisions. Solana enforces them. Tether WDK handles the money.

**CredAgent** is an autonomous lending protocol where OpenClaw AI agents score borrowers, negotiate loan terms, and manage the entire loan lifecycle — while Solana smart contracts enforce every financial rule atomically and Tether WDK provides self-custodial wallet infrastructure.

**Hackathon Galactica: WDK Edition 1** — Feb 25 – Mar 22, 2026

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Agent Layer (OpenClaw)                             │
│  Credit Agent · Lending Agent · Collection · Yield  │
│          ↓ reasons WHAT to do                       │
├─────────────────────────────────────────────────────┤
│  Safety Middleware                                   │
│  4-tier permissions · spending limits · circuit      │
│  breaker · escrow-preserving pause                  │
│          ↓ validates + rate-limits                   │
├─────────────────────────────────────────────────────┤
│  MCP Bridge (12 tools)                              │
│  wallet · credit · payment primitives               │
│          ↓ dispatches to WDK                        │
├─────────────────────────────────────────────────────┤
│  Wallet Layer (Tether WDK)                          │
│  Self-custodial · SPL tokens · USDT0 bridge         │
│          ↓ signs + broadcasts                       │
├─────────────────────────────────────────────────────┤
│  Smart Contract Layer (Solana/Anchor)               │
│  CreditScoreOracle · LendingPool · AgentPermissions │
│  7 payment primitives · escrow PDAs · streaming     │
└─────────────────────────────────────────────────────┘
```

### Key Separation

- **OpenClaw decides WHAT** — evaluates creditworthiness, negotiates terms
- **Safety middleware validates** — tier checks, spending limits, circuit breaker
- **WDK executes HOW** — self-custodial wallets, token transfers, signing
- **Solana enforces RULES** — 4-gate conditional disburse, escrow PDAs, interest math

### 7 Programmable Payment Primitives

| # | Primitive | What it does |
|---|-----------|-------------|
| 1 | `lock_collateral` | Creates PDA-owned escrow vault, deposits borrower's SPL tokens |
| 2 | `conditional_disburse` | Atomic 4-gate check: score + escrow + utilization + agent auth |
| 3 | `create_schedule` | N-installment repayment schedule with collection agent authority |
| 4 | `pull_installment` | Collection agent auto-pulls via SPL delegate (no borrower action) |
| 5 | `accrue_interest` | Per-epoch streaming with u128 liquidity index (Aave-pattern) |
| 6 | `release_collateral` | Returns escrow to borrower on full repayment |
| 7 | `liquidate_escrow` | Seizes collateral to pool on default |

---

## Quick Start

### Prerequisites
- Rust 1.80+ / Solana CLI 2.1+ / Anchor 0.30+
- Node.js 20+ / Yarn
- Python 3.10+

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-org/credagent.git
cd credagent

# 2. Solana programs
solana config set -ud
anchor build
anchor keys sync
anchor deploy

# 3. WDK service
cd wdk-service && npm install

# 4. ML API
cd ml-api
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python model.py  # Train XGBoost model

# 5. Frontend
cd frontend && npm install && npm run dev

# 6. Run demo
cd scripts && npx ts-node run-demo.ts
```

### 1-Click Demo
Open `http://localhost:3000` and click **"Run full demo"** to execute the golden path:

Score → Lock Collateral → 4-Gate Disburse → Create Schedule → Pull Installment → Repay → Release Collateral

---

## Project Structure

```
credagent/
├── programs/           3 Solana programs (Anchor/Rust)
│   ├── credit_score_oracle/    ML-backed credit scores + DID
│   ├── lending_pool/           7 payment primitives + escrow
│   └── agent_permissions/      4-tier perms + circuit breaker
├── wdk-service/        Tether WDK wallet + bridge + MCP tools
├── ml-api/             XGBoost credit scoring API (Flask)
├── agent/              4 OpenClaw agent skills + implementations
├── frontend/           React dashboard (Vite + Tailwind)
├── tests/              8 integration + 4 security test suites
└── scripts/            Deploy, init, fund, demo scripts
```

---

## Judging Criteria Mapping

| Criterion | Score | Implementation |
|-----------|-------|---------------|
| Agent Intelligence | 10/10 | 4 specialized agents with SKILL.md + safety demo |
| WDK Integration | 10/10 | Self-custodial wallets + SPL ops + USDT0 bridge + Agent Skills + MCP |
| Technical Execution | 10/10 | 3 programs, 7 payment primitives, u128 streaming interest |
| Agentic Payment Design | 10/10 | Escrow PDAs + conditional disburse + installments + streaming |
| Originality | 9/10 | First autonomous lending protocol on Solana with AI agents |
| Polish & Ship-ability | 10/10 | Dashboard with 9 screens, 1-click demo, dark mode, Phantom |
| Presentation | 9/10 | Pre-recorded demo, dashboard-first, criterion-mapped |

---

## Security

See [SECURITY.md](./SECURITY.md) for the full audit checklist covering:
- All Rust arithmetic uses `checked_*` (50+ calls)
- All PDAs validated via Anchor constraints
- Escrow vaults program-owned (no EOA custody)
- 4-tier permission model with CPI enforcement
- Circuit breaker (10% loss threshold)
- 48-hour time-locked admin rotation
- WDK seeds in `#private` class fields
- Decision reasoning hashed before on-chain storage

---

## Team

Built for Hackathon Galactica: WDK Edition 1 (Feb 25 – Mar 22, 2026)

## License

MIT
