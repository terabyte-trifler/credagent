/**
 * run-demo.ts — CredAgent Golden Path Demo
 *
 * Runs a narrated golden-path demo for recording.
 * Each step prints a formatted banner so the screen recording looks clean.
 *
 * Important:
 * - Wallet funding + mock mint setup are real devnet operations.
 * - Most protocol lifecycle steps below remain narrated/demo checkpoints
 *   until replaced with real Anchor RPC calls.
 *
 * Usage: npx ts-node scripts/run-demo.ts
 *
 * Prerequisites:
 * - 3 programs deployed to devnet (anchor deploy)
 * - ML API running on localhost:5001
 * - Sufficient SOL in deployer wallet
 */

import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createMintCompat,
  mintToCompat,
  getOrCreateAssociatedTokenAccountCompat,
} from "./splCompat";

// ═══════════════════════════════════════════
// Console Formatting
// ═══════════════════════════════════════════

const G = '\x1b[32m', B = '\x1b[34m', Y = '\x1b[33m', R = '\x1b[31m';
const C = '\x1b[36m', M = '\x1b[35m', W = '\x1b[37m', N = '\x1b[0m';
const BOLD = '\x1b[1m', DIM = '\x1b[2m';

function banner(step: number, total: number, title: string, color = C) {
  const bar = '═'.repeat(52);
  console.log(`\n${color}${bar}${N}`);
  console.log(`${color}${BOLD}  STEP ${step}/${total}: ${title}${N}`);
  console.log(`${color}${bar}${N}\n`);
}

function result(label: string, value: string, icon = '✓') {
  console.log(`  ${G}${icon}${N} ${DIM}${label}:${N} ${W}${value}${N}`);
}

function fail(label: string, value: string) {
  console.log(`  ${R}✗${N} ${DIM}${label}:${N} ${R}${value}${N}`);
}

function info(text: string) {
  console.log(`  ${DIM}${text}${N}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fundDemoWallet(
  provider: anchor.AnchorProvider,
  recipient: Keypair,
  desiredSol: number,
) {
  const lamports = Math.floor(desiredSol * LAMPORTS_PER_SOL);

  try {
    const sig = await provider.connection.requestAirdrop(recipient.publicKey, lamports);
    await provider.connection.confirmTransaction(sig);
    return { method: "airdrop", sol: desiredSol };
  } catch {
    const adminBalance = await provider.connection.getBalance(provider.wallet.publicKey);
    const reserveLamports = Math.floor(0.75 * LAMPORTS_PER_SOL);
    const fallbackLamports = Math.min(
      lamports,
      Math.max(0, adminBalance - reserveLamports),
      Math.floor(0.25 * LAMPORTS_PER_SOL),
    );

    if (fallbackLamports <= 0) {
      throw new Error("Unable to fund demo wallet: faucet rate-limited and admin wallet too low");
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: recipient.publicKey,
        lamports: fallbackLamports,
      }),
    );
    await provider.sendAndConfirm(tx, []);
    return { method: "transfer", sol: fallbackLamports / LAMPORTS_PER_SOL };
  }
}

// ═══════════════════════════════════════════
// Demo Runner
// ═══════════════════════════════════════════

async function main() {
  const TOTAL_STEPS = 12;

  console.log(`\n${M}${BOLD}╔══════════════════════════════════════════════════════╗${N}`);
  console.log(`${M}${BOLD}║   CredAgent — Autonomous Lending on Solana           ║${N}`);
  console.log(`${M}${BOLD}║   Golden Path Demo                                   ║${N}`);
  console.log(`${M}${BOLD}║   Hackathon Galactica: WDK Edition 1                 ║${N}`);
  console.log(`${M}${BOLD}╚══════════════════════════════════════════════════════╝${N}\n`);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = provider.wallet as anchor.Wallet;
  const borrower = Keypair.generate();
  const oracleAgent = Keypair.generate();
  const lendingAgent = Keypair.generate();
  const collectionAgent = Keypair.generate();

  // ── Setup ──
  info("Airdropping SOL to test wallets...");
  for (const kp of [borrower, oracleAgent, lendingAgent, collectionAgent]) {
    await fundDemoWallet(provider, kp, 5);
  }
  result("Setup", "4 wallets funded for demo execution");

  info("Creating test token mints (mock USDT + XAUT)...");
  const usdtMint = await createMintCompat(provider.connection, admin.payer, admin.publicKey, null, 6);
  const xautMint = await createMintCompat(provider.connection, admin.payer, admin.publicKey, null, 6);
  result("USDT Mint", usdtMint.toBase58().slice(0, 16) + "...");
  result("XAUT Mint", xautMint.toBase58().slice(0, 16) + "...");

  // Mint tokens
  const borrowerUsdt = await getOrCreateAssociatedTokenAccountCompat(provider.connection, admin.payer, usdtMint, borrower.publicKey);
  const borrowerXaut = await getOrCreateAssociatedTokenAccountCompat(provider.connection, admin.payer, xautMint, borrower.publicKey);
  await mintToCompat(provider.connection, admin.payer, usdtMint, borrowerUsdt.address, admin.publicKey, 10_000_000_000);
  await mintToCompat(provider.connection, admin.payer, xautMint, borrowerXaut.address, admin.publicKey, 5_000_000);
  result("Borrower", "10,000 USDT + 5 XAUT minted");

  await sleep(1000);

  // ═══ STEP 1: Initialize Oracle ═══
  banner(1, TOTAL_STEPS, "Initialize CreditScoreOracle (demo narration)");
  info("Creating oracle state PDA...");
  info("Simulated step — replace with a real RPC before using as execution proof.");
  result("Oracle (demo)", "Would initialize with 7-day validity period");
  result("Admin", admin.publicKey.toBase58().slice(0, 16) + "...");
  await sleep(800);

  // ═══ STEP 2: Score Borrower ═══
  banner(2, TOTAL_STEPS, "Score Borrower via ML API (demo narration)");
  info("Extracting 14 on-chain features...");
  await sleep(600);
  info("Running XGBoost prediction...");
  await sleep(400);
  result("Score", "720 (AA tier)");
  result("Confidence", "89%");
  result("Default Probability", "8.2%");
  result("Model Hash", "aa".repeat(16) + "...");
  result("ZK Proof Hash", "bb".repeat(16) + "...");
  info("Narrated only here — this script is not submitting the oracle update.");
  await sleep(800);

  // ═══ STEP 3: Initialize Pool ═══
  banner(3, TOTAL_STEPS, "Initialize Lending Pool + Deposit (demo narration)");
  info("Creating pool for USDT mint...");
  result("Base Rate", "6.5% APR (650 bps)");
  result("Max Utilization", "80%");
  result("Interest Index", "1.000000000000000000 (1e18)");
  info("Depositing 50,000 USDT into pool vault...");
  result("Total Deposited", "$50,000 USDT");
  await sleep(800);

  // ═══ STEP 4: Register Agents ═══
  banner(4, TOTAL_STEPS, "Register Agents with 4-Tier Permissions (demo narration)");
  result("Lending Agent", `Tier 2 (Manage), 10,000 USDT/day limit`);
  result("Collection Agent", `Tier 1 (Operate), 1,000 USDT/day limit`);
  result("Oracle Agent", `Tier 1 (Operate), score push authorized`);
  info("Narrative checkpoint only. Use scripts/init-agents.ts for real registration.");
  await sleep(800);

  // ═══ STEP 5: Lock Collateral ═══
  banner(5, TOTAL_STEPS, "PRIMITIVE 1: Lock Collateral in Escrow PDA (demo narration)", Y);
  info("Borrower deposits 1.5 XAUT into program-owned escrow vault...");
  await sleep(600);
  result("Escrow PDA", "Created — program-owned vault");
  result("Collateral", "1.5 XAUT ($3,000 value at $2,000/XAUT)");
  result("Status", "LOCKED");
  info("Escrow vault authority = PDA (not borrower, not agent)");
  await sleep(800);

  // ═══ STEP 6: Conditional Disburse ═══
  banner(6, TOTAL_STEPS, "PRIMITIVE 2: Conditional Disbursement (4 Gates, demo narration)", Y);
  console.log(`  ${C}Checking 4 gates atomically...${N}\n`);
  await sleep(400);
  result("Gate 1 — Credit Score", "720 AA, not expired, confidence 89%");
  await sleep(300);
  result("Gate 2 — Escrow Locked", "1.5 XAUT in PDA vault, status=Locked");
  await sleep(300);
  result("Gate 3 — Utilization", "3K/50K = 6% < 80% max → OK");
  await sleep(300);
  result("Gate 4 — Agent CPI", "Tier=Manage ✓, Limit 3K/10K ✓, Not paused ✓");
  await sleep(400);
  console.log(`\n  ${G}${BOLD}ALL 4 GATES PASSED${N}\n`);
  result("Disbursed (demo)", "3,000 USDT → borrower wallet");
  result("Loan ID", "#1");
  result("Decision Hash", "cc".repeat(16) + "...");
  await sleep(1000);

  // ═══ STEP 7: Create Schedule ═══
  banner(7, TOTAL_STEPS, "PRIMITIVE 3: Create Installment Schedule (demo narration)", Y);
  result("Installments", "6 × 500 USDT every 10 days");
  result("Collection Agent", collectionAgent.publicKey.toBase58().slice(0, 16) + "...");
  result("First Due", "10 days from now");
  await sleep(800);

  // ═══ STEP 8: Interest Accrual ═══
  banner(8, TOTAL_STEPS, "PRIMITIVE 5: Interest Streaming (demo narration)");
  info("Accruing interest over elapsed time...");
  result("Effective Rate", "39 bps (base 650 × util 6%)");
  result("Interest Index", "1.000320... × 1e18");
  result("Interest Owed", "~0.96 USDT (30 days at 6% util)");
  info("u128 precision — no rounding to zero even on small amounts");
  await sleep(800);

  // ═══ STEP 9: Pull Installment ═══
  banner(9, TOTAL_STEPS, "PRIMITIVE 4: Auto-Pull Installment via Delegate (demo narration)", Y);
  info("Borrower pre-approved collection agent as SPL delegate...");
  info("Collection agent pulls first installment...");
  result("Pulled", "500 USDT (installment 1/6)");
  result("Repaid so far", "$500 / $3,000");
  result("Next Due", "in 10 days");
  await sleep(800);

  // ═══ STEP 10: Full Repay ═══
  banner(10, TOTAL_STEPS, "Borrower Repays Remaining Balance (demo narration)");
  info("Borrower manually repays remaining principal + interest...");
  result("Repaid", "~2,501 USDT (principal remainder + accrued interest)");
  result("Loan Status", "REPAID");
  result("Pool Interest Earned", "+$1.00 USDT");
  await sleep(800);

  // ═══ STEP 11: Release Collateral ═══
  banner(11, TOTAL_STEPS, "PRIMITIVE 6: Release Collateral from Escrow (demo narration)", Y);
  info("Loan fully repaid → releasing escrowed collateral...");
  result("Released", "1.5 XAUT → borrower wallet");
  result("Escrow Status", "RELEASED");
  result("Escrow Vault", "0 balance (empty)");
  await sleep(800);

  // ═══ STEP 12: Final Verification ═══
  banner(12, TOTAL_STEPS, "Final Demo State Summary", G);
  console.log(`  ${G}┌──────────────────────────┬─────────────┐${N}`);
  console.log(`  ${G}│ Account                  │ State       │${N}`);
  console.log(`  ${G}├──────────────────────────┼─────────────┤${N}`);
  console.log(`  ${G}│ Loan.status              │ Repaid      │${N}`);
  console.log(`  ${G}│ Escrow.status            │ Released    │${N}`);
  console.log(`  ${G}│ Schedule.is_active       │ false       │${N}`);
  console.log(`  ${G}│ Pool.active_loans        │ 0           │${N}`);
  console.log(`  ${G}│ Pool.total_borrowed      │ 0           │${N}`);
  console.log(`  ${G}│ Pool.interest_earned     │ > 0         │${N}`);
  console.log(`  ${G}│ CreditHistory.repaid     │ 1           │${N}`);
  console.log(`  ${G}│ CreditHistory.defaulted  │ 0           │${N}`);
  console.log(`  ${G}│ Borrower XAUT            │ 5.0 (full)  │${N}`);
  console.log(`  ${G}│ Escrow vault balance     │ 0           │${N}`);
  console.log(`  ${G}└──────────────────────────┴─────────────┘${N}`);

  console.log(`\n${M}${BOLD}╔══════════════════════════════════════════════════════╗${N}`);
  console.log(`${M}${BOLD}║  ✓ NARRATED GOLDEN PATH COMPLETE                     ║${N}`);
  console.log(`${M}${BOLD}║  Demo checkpoints shown; confirm chain state separately║${N}`);
  console.log(`${M}${BOLD}║  Use integration tests / RPC queries for proof        ║${N}`);
  console.log(`${M}${BOLD}╚══════════════════════════════════════════════════════╝${N}\n`);
}

main().catch(err => {
  console.error(`\n${R}Demo failed:${N}`, err.message);
  process.exit(1);
});
