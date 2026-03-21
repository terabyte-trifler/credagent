/**
 * fund-agents.ts — Fund agent wallets with SOL + test SPL tokens
 *
 * Usage: npx ts-node scripts/fund-agents.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { mintToCompat, getOrCreateAssociatedTokenAccountCompat } from "./splCompat";

const G = '\x1b[32m', C = '\x1b[36m', R = '\x1b[31m', N = '\x1b[0m';
const MIN_TOP_UP_SOL = 0.25;

async function topUpAgent(provider: anchor.AnchorProvider, pubkey: PublicKey, desiredSol: number) {
  const lamports = Math.floor(desiredSol * LAMPORTS_PER_SOL);

  try {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(sig);
    return { method: "airdrop", sol: desiredSol };
  } catch {
    const adminBalance = await provider.connection.getBalance(provider.wallet.publicKey);
    const reserveLamports = Math.floor(0.75 * LAMPORTS_PER_SOL);
    const transferable = Math.max(0, adminBalance - reserveLamports);
    const fallbackLamports = Math.min(lamports, transferable, Math.floor(MIN_TOP_UP_SOL * LAMPORTS_PER_SOL));

    if (fallbackLamports <= 0) {
      throw new Error("Unable to top up agent: faucet rate-limited and admin wallet too low");
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: pubkey,
        lamports: fallbackLamports,
      }),
    );
    await provider.sendAndConfirm(tx, []);
    return { method: "transfer", sol: fallbackLamports / LAMPORTS_PER_SOL };
  }
}

async function main() {
  console.log(`\n${C}━━━ Fund Agent Wallets ━━━${N}\n`);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = provider.wallet as anchor.Wallet;

  const usdtMint = new PublicKey(process.env.MOCK_USDT_MINT || '');
  const xautMint = new PublicKey(process.env.MOCK_XAUT_MINT || '');

  if (!process.env.MOCK_USDT_MINT) {
    console.log(`${R}[✗]${N} MOCK_USDT_MINT not set. Run: npm run create-tokens first`);
    process.exit(1);
  }

  const agents = [
    { name: 'credit-agent', key: process.env.CREDIT_AGENT_PUBKEY, sol: 2, usdt: 0, xaut: 0 },
    { name: 'lending-agent', key: process.env.LENDING_AGENT_PUBKEY, sol: 3, usdt: 10000, xaut: 0 },
    { name: 'collection-agent', key: process.env.COLLECTION_AGENT_PUBKEY, sol: 2, usdt: 0, xaut: 0 },
    { name: 'yield-agent', key: process.env.YIELD_AGENT_PUBKEY, sol: 2, usdt: 5000, xaut: 2 },
  ];

  for (const agent of agents) {
    if (!agent.key) {
      console.log(`${R}[✗]${N} ${agent.name}: pubkey not set in .env`);
      continue;
    }

    const pubkey = new PublicKey(agent.key);

    const topUp = await topUpAgent(provider, pubkey, agent.sol);
    console.log(`${G}[✓]${N} ${agent.name}: ${topUp.sol.toFixed(2)} SOL via ${topUp.method}`);

    // Mint USDT
    if (agent.usdt > 0) {
      const ata = await getOrCreateAssociatedTokenAccountCompat(provider.connection, admin.payer, usdtMint, pubkey);
      await mintToCompat(provider.connection, admin.payer, usdtMint, ata.address, admin.publicKey, agent.usdt * 1_000_000);
      console.log(`${G}[✓]${N} ${agent.name}: ${agent.usdt.toLocaleString()} USDT minted`);
    }

    // Mint XAUT
    if (agent.xaut > 0) {
      const ata = await getOrCreateAssociatedTokenAccountCompat(provider.connection, admin.payer, xautMint, pubkey);
      await mintToCompat(provider.connection, admin.payer, xautMint, ata.address, admin.publicKey, agent.xaut * 1_000_000);
      console.log(`${G}[✓]${N} ${agent.name}: ${agent.xaut} XAUT minted`);
    }
  }

  console.log(`\n${G}━━━ All agents funded ━━━${N}\n`);
}

main().catch(err => { console.error(`${R}Error:${N}`, err.message); process.exit(1); });
