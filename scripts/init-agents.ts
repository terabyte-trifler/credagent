/**
 * init-agents.ts — Register 4 CredAgent agents on-chain
 *
 * Generates agent keypairs locally and registers each agent in the
 * AgentPermissions program with appropriate tier + daily limit.
 *
 * Usage: npx ts-node scripts/init-agents.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const G = '\x1b[32m', C = '\x1b[36m', N = '\x1b[0m';

interface AgentConfig {
  name: string;
  role: number;  // 0=Oracle, 1=Lending, 2=Collection, 3=Yield
  tier: number;  // 0=Read, 1=Operate, 2=Manage
  dailyLimitUsdt: number;
}

const AGENTS: AgentConfig[] = [
  { name: 'credit-agent',     role: 0, tier: 1, dailyLimitUsdt: 1 },        // Oracle, Operate
  { name: 'lending-agent',    role: 1, tier: 2, dailyLimitUsdt: 10000 },     // Lending, Manage
  { name: 'collection-agent', role: 2, tier: 1, dailyLimitUsdt: 1000 },      // Collection, Operate
  { name: 'yield-agent',      role: 3, tier: 2, dailyLimitUsdt: 5000 },      // Yield, Manage
];

const TIER_NAMES = ['Read', 'Operate', 'Manage', 'Admin'];
const ROLE_NAMES = ['Oracle', 'Lending', 'Collection', 'Yield'];
const MIN_AGENT_SOL = 0.25;

async function fundAgent(provider: anchor.AnchorProvider, recipient: Keypair, desiredSol: number) {
  const lamports = Math.floor(desiredSol * LAMPORTS_PER_SOL);

  try {
    const sig = await provider.connection.requestAirdrop(recipient.publicKey, lamports);
    await provider.connection.confirmTransaction(sig);
    return { method: "airdrop", sol: desiredSol };
  } catch {
    const adminBalance = await provider.connection.getBalance(provider.wallet.publicKey);
    const reserveLamports = Math.floor(0.75 * LAMPORTS_PER_SOL);
    const transferable = Math.max(0, adminBalance - reserveLamports);
    const fallbackLamports = Math.min(lamports, transferable, Math.floor(MIN_AGENT_SOL * LAMPORTS_PER_SOL));

    if (fallbackLamports <= 0) {
      throw new Error("Unable to fund agent: faucet rate-limited and admin wallet too low");
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

async function main() {
  console.log(`\n${C}━━━ CredAgent Agent Initialization ━━━${N}\n`);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const workspaceRoot = process.cwd();
  const idl = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, "target/idl/agent_permissions.json"), "utf8"),
  );
  const programId = new PublicKey(idl.address);
  const permProgram = new anchor.Program(idl as anchor.Idl, provider) as any;
  const [permStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("perm_state")],
    programId,
  );

  const existingPermState = await permProgram.account.permState.fetchNullable(permStatePda);
  if (!existingPermState) {
    console.log(`${C}Initializing AgentPermissions state on-chain...${N}`);
    await permProgram.methods.initialize().accounts({
      permState: permStatePda,
      admin: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();
    console.log(`${G}[✓]${N} perm_state initialized: ${permStatePda.toBase58().slice(0, 20)}...\n`);
  }

  const keypairs: Record<string, Keypair> = {};
  let registered = 0;
  let skipped = 0;

  for (const agent of AGENTS) {
    const kp = Keypair.generate();
    keypairs[agent.name] = kp;

    const funding = await fundAgent(provider, kp, 2);

    const limit = agent.dailyLimitUsdt > 0
      ? `${agent.dailyLimitUsdt.toLocaleString()} USDT/day`
      : 'N/A (read-only ops)';

    console.log(`${G}[✓]${N} ${agent.name}`);
    console.log(`    Address: ${kp.publicKey.toBase58().slice(0, 20)}...`);
    console.log(`    Role: ${ROLE_NAMES[agent.role]}, Tier: ${TIER_NAMES[agent.tier]}, Limit: ${limit}`);
    console.log(`    Funding: ${funding.sol.toFixed(2)} SOL via ${funding.method}`);
    console.log();

    const [agentPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_id"), kp.publicKey.toBuffer()],
      programId,
    );

    const existingIdentity = await permProgram.account.agentIdentity.fetchNullable(agentPda);
    if (existingIdentity) {
      skipped++;
      console.log(`    On-chain: already registered at ${agentPda.toBase58().slice(0, 20)}...`);
      console.log();
      continue;
    }

    const roleArg =
      agent.role === 0 ? { oracle: {} } :
      agent.role === 1 ? { lending: {} } :
      agent.role === 2 ? { collection: {} } :
      { yield: {} };

    const tierArg =
      agent.tier === 0 ? { read: {} } :
      agent.tier === 1 ? { operate: {} } :
      agent.tier === 2 ? { manage: {} } :
      { admin: {} };

    await permProgram.methods.registerAgent(
      roleArg,
      tierArg,
      new BN(agent.dailyLimitUsdt * 1_000_000),
    ).accounts({
      permState: permStatePda,
      agentIdentity: agentPda,
      agentWallet: kp.publicKey,
      admin: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    registered++;
    console.log(`    On-chain: registered at ${agentPda.toBase58().slice(0, 20)}...`);
    console.log();
  }

  console.log(`${C}━━━ Summary ━━━${N}`);
  console.log(`  Agents processed: ${AGENTS.length}`);
  console.log(`  Newly registered on-chain: ${registered}`);
  console.log(`  Already registered: ${skipped}`);
  console.log(`  Tier 2 (Manage): ${AGENTS.filter(a => a.tier === 2).length}`);
  console.log(`  Tier 1 (Operate): ${AGENTS.filter(a => a.tier === 1).length}`);
  console.log(`  Tier 3 (Admin): 0 (human-only, via rotation flow)\n`);

  // Write keypairs to .env for other scripts
  const envLines = Object.entries(keypairs).map(([name, kp]) =>
    `${name.toUpperCase().replace(/-/g, '_')}_PUBKEY=${kp.publicKey.toBase58()}`
  );
  const envPath = path.join(process.cwd(), ".env");
  fs.writeFileSync(envPath, `${envLines.join("\n")}\n`, "utf8");
  console.log(`  Saved pubkeys to ${envPath}`);
  console.log('  Add to .env:');
  envLines.forEach(l => console.log(`    ${l}`));
  console.log();
}

main().catch(console.error);
