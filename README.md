# CredAgent

Autonomous lending on Solana powered by AI agents, self-custodial wallets, programmable payment flows, and live on-chain settlement.

CredAgent combines:

- Solana programs for escrow, lending, permissions, and credit state
- an ML credit scoring API for borrower assessment
- an MCP/WDK runtime for self-custodial agent wallets and tool execution
- a React dashboard for scoring, negotiation, lending, repayment, pool analytics, and runtime monitoring

## What CredAgent Does

CredAgent turns lending into an agent-driven workflow:

1. A borrower wallet is scored using live credit features and an XGBoost model.
2. The Credit Agent pushes that score on-chain to the credit oracle.
3. The Lending Agent evaluates eligibility, negotiates terms, and initiates the loan flow.
4. Collateral is locked in a program-owned escrow PDA.
5. Loan funds are disbursed from the lending pool only if all conditions pass atomically.
6. A repayment schedule is created and repayments can be processed on-chain.
7. Interest accrues to the pool and pool analytics update from live state.

## Live System Overview

### Agent Layer

- `credit-agent`
  - scores wallets
  - updates the credit oracle
  - drives borrower risk assessment
- `lending-agent`
  - evaluates requests
  - negotiates terms
  - executes loan origination
- `collection-agent`
  - tracks repayment lifecycle
  - coordinates default and liquidation paths
- `yield-agent`
  - monitors pool capital and runtime yield operations

### Solana Programs

- [`/Users/terabyte_trifler/Documents/credagent/programs/credit_score_oracle`](/Users/terabyte_trifler/Documents/credagent/programs/credit_score_oracle)
  - stores credit scores
  - stores credit history
  - manages score freshness and oracle updates
- [`/Users/terabyte_trifler/Documents/credagent/programs/lending_pool`](/Users/terabyte_trifler/Documents/credagent/programs/lending_pool)
  - manages the lending pool
  - locks collateral in escrow
  - disburses loans
  - tracks repayments
  - accrues pool interest
- [`/Users/terabyte_trifler/Documents/credagent/programs/agent_permissions`](/Users/terabyte_trifler/Documents/credagent/programs/agent_permissions)
  - enforces agent roles
  - enforces daily limits
  - supports pause and safety controls

### Off-Chain Services

- [`/Users/terabyte_trifler/Documents/credagent/ml-api`](/Users/terabyte_trifler/Documents/credagent/ml-api)
  - Flask ML API
  - XGBoost scoring
  - proof generation and verification
- [`/Users/terabyte_trifler/Documents/credagent/wdk-service`](/Users/terabyte_trifler/Documents/credagent/wdk-service)
  - MCP runtime
  - Tether WDK wallet execution
  - agent runtime endpoints
  - pool history and audit endpoints
- [`/Users/terabyte_trifler/Documents/credagent/frontend`](/Users/terabyte_trifler/Documents/credagent/frontend)
  - React/Vite dashboard
  - Phantom wallet connection
  - live scoring, negotiation, pool, loan, and agent views

## Core Running Features

### Credit Scoring

- wallet scoring with FICO-style scores from `300-850`
- risk tiers and default probability
- cluster-aware scoring for `devnet` and `mainnet-beta`
- on-chain credit history ingestion
- score push to `CreditScoreOracle`
- proof metadata and proof verification endpoint

### Lending Flow

- loan negotiation from the dashboard
- starter-loan path and normal loan path
- collateral lock into escrow PDA
- conditional disbursement with atomic gate checks
- on-chain loan creation
- repayment flow from the borrower wallet
- collateral release after full repayment

### Pool and Yield

- live pool deposit tracking
- live borrowed, utilization, and interest-earned metrics
- historical pool snapshots and charting
- real on-chain yield accrual on the main pool
- demo script that proves pool interest increases after a loan is issued and repaid

### Agent Runtime

- persistent agent wallets
- funded devnet agent runtime
- live runtime status
- live decisions feed
- live MCP health and runtime endpoints

## Programmable Payment Flows

CredAgent implements these programmable lending primitives:

- `lock_collateral`
  - locks borrower collateral in a PDA-owned escrow vault
- `conditional_disburse`
  - validates score, escrow, utilization, and agent authorization atomically
- `create_schedule`
  - creates the loan repayment schedule
- `pull_installment`
  - supports scheduled repayment collection logic
- `repay`
  - settles borrower repayment on-chain
- `release_collateral`
  - returns escrowed collateral after repayment
- `mark_default`
  - marks overdue loans as defaulted
- `liquidate_escrow`
  - moves collateral to the pool after default
- `accrue_interest`
  - updates pool interest accounting on interactions

## Repository Layout

```text
credagent/
├── agent/               OpenClaw-style agent implementations and skills
├── docs/                runtime and project docs
├── frontend/            React + Vite dashboard
├── ml-api/              Flask ML scoring API
├── programs/            Anchor programs
│   ├── agent_permissions/
│   ├── credit_score_oracle/
│   └── lending_pool/
├── scripts/             deployment, verification, and demo scripts
├── tests/               integration and security tests
└── wdk-service/         MCP + WDK runtime
```

## Local Run

CredAgent runs as three local processes.

### 1. MCP / WDK Runtime

```bash
cd /Users/terabyte_trifler/Documents/credagent/wdk-service
npm install
npm start
```

Endpoints:

- `http://127.0.0.1:3100/health`
- `http://127.0.0.1:3100/mcp`

### 2. ML API

```bash
cd /Users/terabyte_trifler/Documents/credagent/ml-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Endpoint:

- `http://127.0.0.1:5001/health`

### 3. Frontend

```bash
cd /Users/terabyte_trifler/Documents/credagent/frontend
npm install
npm run dev
```

Endpoint:

- `http://127.0.0.1:3000/`

## Environment

Base example:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_WS_URL=wss://api.devnet.solana.com
OPENCLAW_CONFIG=./agent/config/openclaw.json
ML_API_URL=http://127.0.0.1:5000
WDK_ENV=devnet
```

Frontend Vite variables:

```bash
VITE_RPC_URL=https://api.devnet.solana.com
VITE_ML_API_URL=http://127.0.0.1:5001
VITE_MCP_API_URL=http://127.0.0.1:3100
VITE_CREDIT_ORACLE_ID=4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE
VITE_LENDING_POOL_ID=8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid
VITE_AGENT_PERMS_ID=57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG
VITE_MOCK_USDT_MINT=6kacrDqGEv9Jh5eNv86pZEASx4C3jcmnjc1CNWQHS8Ca
```

## Useful Commands

### Typecheck

```bash
cd /Users/terabyte_trifler/Documents/credagent
npm run typecheck
```

### Frontend Build

```bash
cd /Users/terabyte_trifler/Documents/credagent/frontend
npm run build
```

### WDK / MCP Tests

```bash
cd /Users/terabyte_trifler/Documents/credagent/wdk-service
npm test
```

### ML API Tests

```bash
cd /Users/terabyte_trifler/Documents/credagent/ml-api
source venv/bin/activate
pytest -q
```

### Prove Yield on the Main Pool

```bash
cd /Users/terabyte_trifler/Documents/credagent
npm run demo:prove-yield
```

This script:

- uses the live main app pool
- updates the borrower score
- locks collateral
- disburses a real devnet loan
- repays it after a short wait
- prints the before/after `interestEarned` delta

## Deployment Vision

Recommended split deployment:

- **Vercel**
  - frontend only
- **Railway / Render**
  - ML API
- **Fly.io / Render / VPS**
  - MCP / WDK runtime
- **Solana devnet**
  - deployed programs

## Security Model

- self-custodial wallet execution via WDK
- agent role separation
- agent tier and spending controls
- pool pause / safety controls
- atomic gate enforcement in disbursement
- program-owned escrow

## Future Scope

- full LP share accounting and user withdrawals
- richer depositor position tracking
- cross-chain capital routing through USDT0
- richer yield-agent automation
- DID-based borrower identity flows
- soulbound reputation and credential layers
- richer OpenClaw live attachment and messaging channels
- Telegram and Discord borrower interfaces
- enhanced autonomous collection flows
- deeper decision hashing and on-chain audit trails
- broader real-world credit feature inputs
- stronger proof systems and privacy layers
- production-grade hosted deployment and monitoring

## Demo Summary

CredAgent already demonstrates a working autonomous lending stack on Solana devnet:

- live wallet scoring
- on-chain score updates
- loan negotiation
- escrow-backed lending
- on-chain repayment
- live pool analytics
- real yield accrual on the main pool

## License

MIT
