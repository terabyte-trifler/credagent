# Hackathon Galactica: WDK Edition 1 — Submission Plan

## Submission Checklist

- [ ] GitHub repo (public) with complete codebase
- [ ] README with setup instructions
- [ ] 3 Solana programs deployed to devnet
- [ ] Demo video (3-5 minutes) showing golden path
- [ ] Architecture document
- [ ] Security audit summary

## Demo Video Script (3 minutes)

### 0:00-0:15 — Hook
"What if AI agents could make lending decisions autonomously — but a blockchain enforced every rule?"

### 0:15-0:45 — Architecture (30s)
Show architecture diagram:
- "4 AI agents built on OpenClaw reason about lending decisions"
- "Tether WDK provides self-custodial wallet infrastructure"
- "Solana smart contracts enforce 7 programmable payment primitives"
- "The key insight: LLMs decide, Solana enforces"

### 0:45-1:30 — Dashboard Demo (45s)
Show the dashboard with live data:
1. Agent Status: "4 agents running, each with tier permissions and spending limits"
2. Credit Explorer: Enter address → "720 score, AA tier, 89% confidence from our XGBoost model"
3. ZK Badge: "Score verified privately — proof hash stored on-chain"
4. Click "Run Demo" button

### 1:30-2:30 — Golden Path (60s)
Watch the 1-click demo run:
1. "Score pushed to CreditScoreOracle PDA"
2. "1.5 XAUT locked in program-owned escrow"
3. "Conditional disbursement — 4 gates checked atomically:"
   - Score valid ✓ Escrow locked ✓ Utilization OK ✓ Agent authorized ✓
4. "3,000 USDT disbursed to borrower"
5. "6-installment schedule created"
6. "Collection agent auto-pulls via SPL delegate"
7. "Loan repaid → collateral released back to borrower"

### 2:30-2:50 — Safety Demo (20s)
"What if the AI suggests bad terms?"
- Show: LLM proposes 1% rate for a BB-tier borrower
- Show: On-chain gate REJECTS → entire transaction reverts
- "The LLM can reason freely. The Solana program has the final say."

### 2:50-3:00 — Close
"CredAgent: autonomous lending where AI decides and Solana enforces."
"Built with Tether WDK, OpenClaw, and Anchor on Solana."

## Criterion-Mapped Talking Points

| When judge asks about... | Say this |
|--------------------------|---------|
| Agent intelligence | "4 specialized agents with SKILL.md behavioral contracts, 3-round bounded negotiation, and decision reasoning stored on-chain as SHA-256 hashes" |
| WDK integration | "Self-custodial 24-word wallets, SPL delegate authority for auto-collection, USDT0 cross-chain bridge, MCP toolkit for agent skills" |
| Technical execution | "3 Anchor programs, 7 payment primitives, u128 streaming interest, PDA-owned escrow vaults, 50+ checked arithmetic calls" |
| Payment design | "lock_collateral creates PDA-owned escrow, conditional_disburse validates 4 gates atomically, pull_installment uses SPL delegation, accrue_interest streams per-epoch" |
| Security | "4-tier permission model, circuit breaker auto-pauses at 10% loss, 48h time-locked admin rotation, all WDK seeds in JS private class fields" |
| Why this matters | "DeFi lending today is either fully manual (Aave/Compound) or fully algorithmic. CredAgent is the first to have AI agents make nuanced lending decisions while smart contracts enforce financial safety. The agents can negotiate like a human loan officer, but the program ensures no money moves unless all conditions are met." |
