import fs from 'node:fs';
import path from 'node:path';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey, SystemProgram, clusterApiUrl } from '@solana/web3.js';
import splToken from '@solana/spl-token';
import { WalletService } from '../wdk-service/src/walletService.js';

const { Token, TOKEN_PROGRAM_ID } = splToken;
const DECIMALS = 1_000_000n;
const ZERO_HASH = new Array(32).fill(0);
const LENDING_PROGRAM_ID = new PublicKey('8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid');
const ORACLE_PROGRAM_ID = new PublicKey('4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE');
const PERMISSIONS_PROGRAM_ID = new PublicKey('57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG');
const USDT_MINT = new PublicKey('6kacrDqGEv9Jh5eNv86pZEASx4C3jcmnjc1CNWQHS8Ca');
const COLLATERAL_MINT = new PublicKey('9EqCnSg6mYfGmAmEPBjT4oaRGxiLXiuG5TgvyohrWQeT');
const PRINCIPAL_RAW = 5_000_000_000;
const COLLATERAL_RAW = 10_000_000;
const WAIT_MS = 20_000;

function walletFromKeypair(keypair) {
  return {
    publicKey: keypair.publicKey,
    payer: keypair,
    signTransaction: async (tx) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs) => txs.map((tx) => {
      tx.partialSign(keypair);
      return tx;
    }),
  };
}

function loadSolanaKeypair() {
  const keypairPath = path.join(process.env.HOME, '.config', 'solana', 'id.json');
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  return Keypair.fromSecretKey(secret);
}

function keypairFromManagedAccount(account) {
  const secretKey = Uint8Array.from([
    ...Array.from(account.keyPair.privateKey),
    ...Array.from(account.keyPair.publicKey),
  ]);
  return Keypair.fromSecretKey(secretKey);
}

function programFromIdl(idlName, provider) {
  const idlPath = path.join(process.cwd(), 'target', 'idl', `${idlName}.json`);
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  return new anchor.Program(idl, provider);
}

async function getOrCreateAtaCompat(connection, payer, mint, owner) {
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

function uiAmount(raw) {
  return (Number(raw) / Number(DECIMALS)).toFixed(6);
}

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const admin = loadSolanaKeypair();

  const walletService = new WalletService({
    rpcUrl: clusterApiUrl('devnet'),
    wsUrl: 'wss://api.devnet.solana.com/',
    stateDir: path.join(process.cwd(), 'wdk-service', '.mcp-state'),
  });
  await walletService.restorePersistedWallets();

  const borrower = keypairFromManagedAccount(walletService.getAccount('borrower-agent'));
  const lendingAgent = keypairFromManagedAccount(walletService.getAccount('lending-agent'));
  const creditAgent = keypairFromManagedAccount(walletService.getAccount('credit-agent'));

  const adminProvider = new anchor.AnchorProvider(connection, walletFromKeypair(admin), { commitment: 'confirmed' });
  const borrowerProvider = new anchor.AnchorProvider(connection, walletFromKeypair(borrower), { commitment: 'confirmed' });
  const lendingProvider = new anchor.AnchorProvider(connection, walletFromKeypair(lendingAgent), { commitment: 'confirmed' });
  const creditProvider = new anchor.AnchorProvider(connection, walletFromKeypair(creditAgent), { commitment: 'confirmed' });

  const lendingAdminProgram = programFromIdl('lending_pool', adminProvider);
  const lendingBorrowerProgram = programFromIdl('lending_pool', borrowerProvider);
  const lendingAgentProgram = programFromIdl('lending_pool', lendingProvider);
  const oracleProgram = programFromIdl('credit_score_oracle', creditProvider);

  const borrowerUsdtAta = await getOrCreateAtaCompat(connection, admin, USDT_MINT, borrower.publicKey);
  const borrowerCollateralAta = await getOrCreateAtaCompat(connection, admin, COLLATERAL_MINT, borrower.publicKey);

  await mintToCompat(connection, admin, USDT_MINT, borrowerUsdtAta.address, admin.publicKey, 20_000_000_000);
  await mintToCompat(connection, admin, COLLATERAL_MINT, borrowerCollateralAta.address, admin.publicKey, 20_000_000);

  const [poolState] = PublicKey.findProgramAddressSync([Buffer.from('pool'), USDT_MINT.toBuffer()], LENDING_PROGRAM_ID);
  const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('pool_vault'), USDT_MINT.toBuffer()], LENDING_PROGRAM_ID);
  const poolBefore = await lendingAdminProgram.account.poolState.fetch(poolState);

  const beforeInterest = BigInt(String(poolBefore.totalInterestEarned ?? poolBefore.total_interest_earned));
  const loanId = Number(poolBefore.nextLoanId ?? poolBefore.next_loan_id);

  console.log('=== Main Pool Yield Demo ===');
  console.log(`Pool: ${poolState.toBase58()}`);
  console.log(`Borrower: ${borrower.publicKey.toBase58()}`);
  console.log(`Before interest raw: ${beforeInterest}`);
  console.log(`Before interest UI: ${uiAmount(beforeInterest)} USDT`);
  console.log(`Using loan id: ${loanId}`);

  const [oracleState] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], ORACLE_PROGRAM_ID);
  const [oracleAuthority] = PublicKey.findProgramAddressSync([Buffer.from('oracle_auth'), creditAgent.publicKey.toBuffer()], ORACLE_PROGRAM_ID);
  const [creditScore] = PublicKey.findProgramAddressSync([Buffer.from('credit_score'), borrower.publicKey.toBuffer()], ORACLE_PROGRAM_ID);

  await oracleProgram.methods.updateScore(780, 95, ZERO_HASH, ZERO_HASH).accountsStrict({
    oracleState,
    oracleAuthority,
    creditScore,
    borrower: borrower.publicKey,
    oracleAgent: creditAgent.publicKey,
    systemProgram: SystemProgram.programId,
  }).signers([creditAgent]).rpc();
  console.log('Credit score updated: 780 / 95');

  const loanSeed = Buffer.alloc(8);
  loanSeed.writeBigUInt64LE(BigInt(loanId));
  const [escrowState] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), loanSeed], LENDING_PROGRAM_ID);
  const [escrowVault] = PublicKey.findProgramAddressSync([Buffer.from('escrow_vault'), loanSeed], LENDING_PROGRAM_ID);
  const [loan] = PublicKey.findProgramAddressSync([Buffer.from('loan'), poolState.toBuffer(), loanSeed], LENDING_PROGRAM_ID);
  const [permState] = PublicKey.findProgramAddressSync([Buffer.from('perm_state')], PERMISSIONS_PROGRAM_ID);
  const [agentIdentity] = PublicKey.findProgramAddressSync([Buffer.from('agent_id'), lendingAgent.publicKey.toBuffer()], PERMISSIONS_PROGRAM_ID);

  await lendingBorrowerProgram.methods.lockCollateral(new BN(loanId), new BN(COLLATERAL_RAW)).accountsStrict({
    poolState,
    escrowState,
    escrowVault,
    collateralMint: COLLATERAL_MINT,
    borrowerAta: borrowerCollateralAta.address,
    borrower: borrower.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).signers([borrower]).rpc();
  console.log(`Collateral locked: ${uiAmount(BigInt(COLLATERAL_RAW))} XAUT`);

  await lendingAgentProgram.methods.conditionalDisburse(
    new BN(PRINCIPAL_RAW),
    1800,
    14,
    ZERO_HASH,
  ).accountsStrict({
    poolState,
    poolVault,
    creditScoreAccount: creditScore,
    escrowState,
    loan,
    borrowerAta: borrowerUsdtAta.address,
    borrower: borrower.publicKey,
    lendingAgent: lendingAgent.publicKey,
    permState,
    agentIdentity,
    creditOracleProgram: ORACLE_PROGRAM_ID,
    agentPermissionsProgram: PERMISSIONS_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([lendingAgent]).rpc();
  console.log(`Loan disbursed: ${uiAmount(BigInt(PRINCIPAL_RAW))} USDT`);
  console.log(`Waiting ${WAIT_MS / 1000}s to accrue interest...`);

  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  await lendingBorrowerProgram.methods.repay(new BN(PRINCIPAL_RAW * 2)).accountsStrict({
    poolState,
    poolVault,
    loan,
    borrowerAta: borrowerUsdtAta.address,
    borrower: borrower.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([borrower]).rpc();
  console.log('Loan repaid');

  const poolAfter = await lendingAdminProgram.account.poolState.fetch(poolState);
  const afterInterest = BigInt(String(poolAfter.totalInterestEarned ?? poolAfter.total_interest_earned));
  const delta = afterInterest - beforeInterest;

  console.log(`After interest raw: ${afterInterest}`);
  console.log(`After interest UI: ${uiAmount(afterInterest)} USDT`);
  console.log(`Interest delta raw: ${delta}`);
  console.log(`Interest delta UI: ${uiAmount(delta)} USDT`);
  console.log(`Next loan id: ${Number(poolAfter.nextLoanId ?? poolAfter.next_loan_id)}`);

  if (delta <= 0n) {
    throw new Error('Yield did not increase on the main pool. Retry with a longer wait.');
  }

  console.log('SUCCESS: main pool interest increased, proving depositors are earning yield.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
