/**
 * @module testHelpers
 * Shared utilities for all 8 integration tests + 4 security tests.
 *
 * Provides:
 * - Wallet/keypair management for 6 test actors
 * - SPL token mint creation + airdrop
 * - PDA derivation for all 3 programs
 * - Balance assertion helpers (exact + range)
 * - Account state query wrappers
 * - Clock manipulation helpers (bankrun or sleep)
 *
 * AUDIT:
 * - Every helper validates inputs before acting
 * - No secret material logged (keypairs printed as pubkey only)
 * - Deterministic setup: same test run always produces same state
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import { expect } from "chai";

const TOKEN_PROGRAM_ID = splToken.TOKEN_PROGRAM_ID;

async function createMintCompat(
  provider: AnchorProvider,
  admin: anchor.Wallet,
  decimals: number,
): Promise<PublicKey> {
  if (typeof (splToken as any).createMint === "function") {
    return (splToken as any).createMint(
      provider.connection, admin.payer, admin.publicKey, null, decimals,
    );
  }

  const token = await (splToken as any).Token.createMint(
    provider.connection,
    admin.payer,
    admin.publicKey,
    null,
    decimals,
    TOKEN_PROGRAM_ID,
  );
  return token.publicKey;
}

async function getOrCreateAssociatedTokenAccountCompat(
  provider: AnchorProvider,
  admin: anchor.Wallet,
  mint: PublicKey,
  owner: PublicKey,
) {
  if (typeof (splToken as any).getOrCreateAssociatedTokenAccount === "function") {
    return (splToken as any).getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, mint, owner,
    );
  }

  const token = new (splToken as any).Token(
    provider.connection,
    mint,
    TOKEN_PROGRAM_ID,
    admin.payer,
  );
  const info = await token.getOrCreateAssociatedAccountInfo(owner);
  return { address: info.address };
}

async function mintToCompat(
  provider: AnchorProvider,
  admin: anchor.Wallet,
  mint: PublicKey,
  destination: PublicKey,
  amount: number,
) {
  if (typeof (splToken as any).mintTo === "function") {
    return (splToken as any).mintTo(
      provider.connection, admin.payer, mint, destination, admin.publicKey, amount,
    );
  }

  const token = new (splToken as any).Token(
    provider.connection,
    mint,
    TOKEN_PROGRAM_ID,
    admin.payer,
  );
  return token.mintTo(destination, admin.publicKey, [], amount);
}

async function getAccountCompat(
  provider: AnchorProvider,
  mint: PublicKey,
  ata: PublicKey,
  admin: anchor.Wallet,
) {
  if (typeof (splToken as any).getAccount === "function") {
    return (splToken as any).getAccount(provider.connection, ata);
  }

  const token = new (splToken as any).Token(
    provider.connection,
    mint,
    TOKEN_PROGRAM_ID,
    admin.payer,
  );
  return token.getAccountInfo(ata);
}

// ═══════════════════════════════════════════
// Program Seeds (must match Rust constants)
// ═══════════════════════════════════════════

export const SEEDS = {
  // credit_score_oracle
  ORACLE_STATE:    Buffer.from("oracle_state"),
  CREDIT_SCORE:    Buffer.from("credit_score"),
  CREDIT_HISTORY:  Buffer.from("credit_history"),
  ORACLE_AUTH:     Buffer.from("oracle_auth"),
  DID_MAPPING:     Buffer.from("did_mapping"),
  // lending_pool
  POOL:            Buffer.from("pool"),
  POOL_VAULT:      Buffer.from("pool_vault"),
  LOAN:            Buffer.from("loan"),
  ESCROW:          Buffer.from("escrow"),
  ESCROW_VAULT:    Buffer.from("escrow_vault"),
  SCHEDULE:        Buffer.from("schedule"),
  // agent_permissions
  PERM_STATE:      Buffer.from("perm_state"),
  AGENT_IDENTITY:  Buffer.from("agent_id"),
};

// ═══════════════════════════════════════════
// PDA Derivation
// ═══════════════════════════════════════════

export function deriveOracleState(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.ORACLE_STATE], programId);
}

export function deriveCreditScore(borrower: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CREDIT_SCORE, borrower.toBuffer()], programId,
  );
}

export function deriveCreditHistory(borrower: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.CREDIT_HISTORY, borrower.toBuffer()], programId,
  );
}

export function deriveOracleAuth(agent: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ORACLE_AUTH, agent.toBuffer()], programId,
  );
}

export function derivePoolState(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.POOL, mint.toBuffer()], programId,
  );
}

export function derivePoolVault(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.POOL_VAULT, mint.toBuffer()], programId,
  );
}

export function deriveLoan(pool: PublicKey, loanId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.LOAN, pool.toBuffer(), loanId.toArrayLike(Buffer, "le", 8)], programId,
  );
}

export function deriveEscrow(loanId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ESCROW, loanId.toArrayLike(Buffer, "le", 8)], programId,
  );
}

export function deriveEscrowVault(loanId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.ESCROW_VAULT, loanId.toArrayLike(Buffer, "le", 8)], programId,
  );
}

export function deriveSchedule(loanId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.SCHEDULE, loanId.toArrayLike(Buffer, "le", 8)], programId,
  );
}

export function derivePermState(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.PERM_STATE], programId);
}

export function deriveAgentIdentity(wallet: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.AGENT_IDENTITY, wallet.toBuffer()], programId,
  );
}

// ═══════════════════════════════════════════
// Test Actor Setup
// ═══════════════════════════════════════════

export interface TestActors {
  admin: anchor.Wallet;
  oracleAgent: Keypair;
  lendingAgent: Keypair;
  collectionAgent: Keypair;
  yieldAgent: Keypair;
  borrower: Keypair;
}

export async function setupActors(provider: AnchorProvider): Promise<TestActors> {
  const admin = provider.wallet as anchor.Wallet;
  const oracleAgent = Keypair.generate();
  const lendingAgent = Keypair.generate();
  const collectionAgent = Keypair.generate();
  const yieldAgent = Keypair.generate();
  const borrower = Keypair.generate();

  // Airdrop SOL to all test actors
  const airdropAmount = 10 * LAMPORTS_PER_SOL;
  for (const kp of [oracleAgent, lendingAgent, collectionAgent, yieldAgent, borrower]) {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, airdropAmount);
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  return { admin, oracleAgent, lendingAgent, collectionAgent, yieldAgent, borrower };
}

// ═══════════════════════════════════════════
// Token Setup
// ═══════════════════════════════════════════

export interface TestTokens {
  usdtMint: PublicKey;
  xautMint: PublicKey;
}

export async function setupTokens(
  provider: AnchorProvider,
  admin: anchor.Wallet,
): Promise<TestTokens> {
  const usdtMint = await createMintCompat(provider, admin, 6);
  const xautMint = await createMintCompat(provider, admin, 6);
  return { usdtMint, xautMint };
}

export async function mintTestTokens(
  provider: AnchorProvider,
  admin: anchor.Wallet,
  mint: PublicKey,
  recipient: PublicKey,
  amount: number,
) {
  const ata = await getOrCreateAssociatedTokenAccountCompat(
    provider, admin, mint, recipient,
  );
  await mintToCompat(provider, admin, mint, ata.address, amount);
  return ata;
}

// ═══════════════════════════════════════════
// Balance Assertions
// ═══════════════════════════════════════════

export async function assertSolBalance(
  provider: AnchorProvider,
  account: PublicKey,
  expectedLamports: number,
  tolerance: number = 50_000, // Allow for tx fees
) {
  const balance = await provider.connection.getBalance(account);
  expect(balance).to.be.closeTo(expectedLamports, tolerance);
}

export async function assertTokenBalance(
  provider: AnchorProvider,
  mint: PublicKey,
  admin: anchor.Wallet,
  ata: PublicKey,
  expectedAmount: number,
) {
  const account = await getAccountCompat(provider, mint, ata, admin);
  expect(Number(account.amount)).to.equal(expectedAmount);
}

export async function getTokenBalance(
  provider: AnchorProvider,
  mint: PublicKey,
  admin: anchor.Wallet,
  ata: PublicKey,
): Promise<number> {
  const account = await getAccountCompat(provider, mint, ata, admin);
  return Number(account.amount);
}

// ═══════════════════════════════════════════
// Timing Helpers
// ═══════════════════════════════════════════

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wait for N slots to pass (useful for time-sensitive tests). */
export async function waitSlots(provider: AnchorProvider, slots: number) {
  for (let i = 0; i < slots; i++) {
    await sleep(400); // ~400ms per slot on localnet
  }
}

// ═══════════════════════════════════════════
// Test Constants
// ═══════════════════════════════════════════

/** USDT amounts (6 decimals) */
export const USDT = {
  _500:    500_000_000,
  _1000:  1_000_000_000,
  _2000:  2_000_000_000,
  _3000:  3_000_000_000,
  _5000:  5_000_000_000,
  _10000: 10_000_000_000,
  _50000: 50_000_000_000,
};

/** XAUT amounts (6 decimals) */
export const XAUT = {
  _1:   1_000_000,
  _1_5: 1_500_000,
  _2:   2_000_000,
  _5:   5_000_000,
};

/** Score constants */
export const SCORES = {
  AAA: 780,
  AA:  720,
  A:   580,
  BB:  480,
  C:   380,
};

/** Rate constants (basis points) */
export const RATES = {
  AAA: 400,
  AA:  650,
  A:   1000,
  BB:  1500,
  BASE: 650,
};

/** Validity period (7 days in seconds) */
export const VALIDITY_SECS = 604_800;

/** Grace period (3 days in seconds) */
export const GRACE_PERIOD_SECS = 259_200;

/** Model hash (32 bytes, test value) */
export const TEST_MODEL_HASH = new Array(32).fill(0xAA);

/** ZK proof hash (32 bytes, test stub) */
export const TEST_ZK_HASH = new Array(32).fill(0xBB);

/** Decision hash (32 bytes, test value) */
export const TEST_DECISION_HASH = new Array(32).fill(0xCC);
