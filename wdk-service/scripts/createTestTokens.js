/**
 * @script createTestTokens
 * @description Creates mock USDT and XAUT SPL tokens on Solana devnet
 * for testing the CredAgent lending protocol.
 *
 * Run: node scripts/createTestTokens.js
 *
 * What it does:
 * 1. Creates two SPL token mints (6 decimals each, matching real USDT/XAUT)
 * 2. Mints test supply to the deployer wallet
 * 3. Outputs mint addresses for use in .env
 *
 * SECURITY: Devnet only. Checks cluster before proceeding.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import splToken from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

const { Token, TOKEN_PROGRAM_ID } = splToken;

async function createMintCompat(connection, payer, mintAuthority, freezeAuthority, decimals) {
  if (typeof splToken.createMint === 'function') {
    return splToken.createMint(connection, payer, mintAuthority, freezeAuthority, decimals);
  }

  const token = await Token.createMint(
    connection,
    payer,
    mintAuthority,
    freezeAuthority,
    decimals,
    TOKEN_PROGRAM_ID,
  );
  return token.publicKey;
}

async function getOrCreateAssociatedTokenAccountCompat(connection, payer, mint, owner) {
  if (typeof splToken.getOrCreateAssociatedTokenAccount === 'function') {
    return splToken.getOrCreateAssociatedTokenAccount(connection, payer, mint, owner);
  }

  const token = new Token(connection, mint, TOKEN_PROGRAM_ID, payer);
  const accountInfo = await token.getOrCreateAssociatedAccountInfo(owner);
  return { address: accountInfo.address ?? accountInfo.pubkey };
}

async function mintToCompat(connection, payer, mint, destination, authority, amount) {
  if (typeof splToken.mintTo === 'function') {
    return splToken.mintTo(connection, payer, mint, destination, authority, amount);
  }

  const token = new Token(connection, mint, TOKEN_PROGRAM_ID, payer);
  return token.mintTo(destination, authority, [], amount);
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m';

async function main() {
  console.log(`\n${CYAN}━━━ CredAgent Test Token Creator ━━━${NC}\n`);

  // Load deployer keypair
  const keypairPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.config', 'solana', 'id.json'
  );

  if (!fs.existsSync(keypairPath)) {
    console.error(`${RED}[✗]${NC} No keypair found at ${keypairPath}`);
    console.error('    Run: solana-keygen new');
    process.exit(1);
  }

  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  const deployer = Keypair.fromSecretKey(secretKey);

  // SECURITY: Only devnet
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
  if (!rpcUrl.includes('devnet')) {
    console.error(`${RED}[✗]${NC} SAFETY: This script only runs on devnet. Current RPC: ${rpcUrl}`);
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`${GREEN}[✓]${NC} Connected to devnet`);
  console.log(`${GREEN}[✓]${NC} Deployer: ${deployer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`${GREEN}[✓]${NC} Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(2)} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.log(`${CYAN}[~]${NC} Low balance, requesting airdrop...`);
    const sig = await connection.requestAirdrop(deployer.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log(`${GREEN}[✓]${NC} Airdrop received`);
  }

  // ═══════════════════════════════════════
  // Create Mock USDT (6 decimals)
  // ═══════════════════════════════════════
  console.log(`\n${CYAN}Creating mock USDT...${NC}`);

  const usdtMint = await createMintCompat(
    connection,
    deployer,        // payer
    deployer.publicKey, // mint authority
    deployer.publicKey, // freeze authority (can be null)
    6,               // 6 decimals (matches real USDT)
  );

  console.log(`${GREEN}[✓]${NC} USDT Mint: ${usdtMint.toBase58()}`);

  // Create ATA and mint 1,000,000 USDT to deployer
  const usdtAta = await getOrCreateAssociatedTokenAccountCompat(
    connection, deployer, usdtMint, deployer.publicKey,
  );

  await mintToCompat(
    connection, deployer, usdtMint,
    usdtAta.address, deployer.publicKey,
    1_000_000_000_000, // 1,000,000 USDT (6 decimals)
  );

  console.log(`${GREEN}[✓]${NC} Minted 1,000,000 USDT to deployer ATA`);

  // ═══════════════════════════════════════
  // Create Mock XAUT (6 decimals)
  // ═══════════════════════════════════════
  console.log(`\n${CYAN}Creating mock XAUT (Tether Gold)...${NC}`);

  const xautMint = await createMintCompat(
    connection,
    deployer,
    deployer.publicKey,
    deployer.publicKey,
    6, // 6 decimals
  );

  console.log(`${GREEN}[✓]${NC} XAUT Mint: ${xautMint.toBase58()}`);

  const xautAta = await getOrCreateAssociatedTokenAccountCompat(
    connection, deployer, xautMint, deployer.publicKey,
  );

  await mintToCompat(
    connection, deployer, xautMint,
    xautAta.address, deployer.publicKey,
    100_000_000, // 100 XAUT (6 decimals, ~$230,000 worth)
  );

  console.log(`${GREEN}[✓]${NC} Minted 100 XAUT to deployer ATA`);

  // ═══════════════════════════════════════
  // Output
  // ═══════════════════════════════════════
  console.log(`\n${CYAN}━━━ Token Addresses (add to .env) ━━━${NC}`);
  console.log(`MOCK_USDT_MINT=${usdtMint.toBase58()}`);
  console.log(`MOCK_XAUT_MINT=${xautMint.toBase58()}`);
  console.log(`DEPLOYER_USDT_ATA=${usdtAta.address.toBase58()}`);
  console.log(`DEPLOYER_XAUT_ATA=${xautAta.address.toBase58()}`);

  // Write to file for other scripts
  const envContent = [
    `# Auto-generated by createTestTokens.js`,
    `# ${new Date().toISOString()}`,
    `MOCK_USDT_MINT=${usdtMint.toBase58()}`,
    `MOCK_XAUT_MINT=${xautMint.toBase58()}`,
    `DEPLOYER_USDT_ATA=${usdtAta.address.toBase58()}`,
    `DEPLOYER_XAUT_ATA=${xautAta.address.toBase58()}`,
  ].join('\n');

  fs.writeFileSync(path.join(process.cwd(), '.test-tokens.env'), envContent);
  console.log(`\n${GREEN}[✓]${NC} Saved to .test-tokens.env`);
  console.log(`${GREEN}━━━ Done ━━━${NC}\n`);
}

main().catch(err => {
  console.error(`${RED}[✗]${NC} Error:`, err.message);
  process.exit(1);
});
