import fs from 'node:fs';
import path from 'node:path';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import splToken from '@solana/spl-token';
import { WalletService } from '../wdk-service/src/walletService.js';

const { Token, TOKEN_PROGRAM_ID } = splToken;
const DECIMALS = 1_000_000n;
const ZERO_HASH = new Array(32).fill(0);
const ORACLE_PROGRAM_ID = new PublicKey('4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE');
const PERMISSIONS_PROGRAM_ID = new PublicKey('57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG');
const LENDING_PROGRAM_ID = new PublicKey('8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid');
const MAIN_POOL_MINT = new PublicKey('6kacrDqGEv9Jh5eNv86pZEASx4C3jcmnjc1CNWQHS8Ca');
const PRINCIPAL_RAW = 5_000_000_000;

function log(label, value) {
  console.log(`${label}: ${value}`);
}

async function findUsableLoanId(connection, poolStateAccount) {
  let loanId = Number(poolStateAccount.nextLoanId ?? poolStateAccount.next_loan_id);
  while (true) {
    const loanSeed = Buffer.alloc(8);
    loanSeed.writeBigUInt64LE(BigInt(loanId));
    const [escrowState] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), loanSeed], LENDING_PROGRAM_ID);
    const existing = await connection.getAccountInfo(escrowState, 'confirmed');
    if (!existing) {
      return loanId;
    }
    loanId += 1;
  }
}

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

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const admin = loadSolanaKeypair();

  const walletService = new WalletService({
    rpcUrl: clusterApiUrl('devnet'),
    wsUrl: 'wss://api.devnet.solana.com/',
    stateDir: path.join(process.cwd(), 'wdk-service', '.mcp-state'),
  });
  await walletService.restorePersistedWallets();

  const lendingAgent = keypairFromManagedAccount(walletService.getAccount('lending-agent'));
  const creditAgent = keypairFromManagedAccount(walletService.getAccount('credit-agent'));
  const borrower = Keypair.generate();

  const adminProvider = new anchor.AnchorProvider(connection, walletFromKeypair(admin), { commitment: 'confirmed' });
  const lendingProvider = new anchor.AnchorProvider(connection, walletFromKeypair(lendingAgent), { commitment: 'confirmed' });
  const creditProvider = new anchor.AnchorProvider(connection, walletFromKeypair(creditAgent), { commitment: 'confirmed' });
  const borrowerProvider = new anchor.AnchorProvider(connection, walletFromKeypair(borrower), { commitment: 'confirmed' });

  const lendingAdminProgram = programFromIdl('lending_pool', adminProvider);
  const lendingAgentProgram = programFromIdl('lending_pool', lendingProvider);
  const lendingBorrowerProgram = programFromIdl('lending_pool', borrowerProvider);
  const oracleProgram = programFromIdl('credit_score_oracle', creditProvider);

  const collateralMint = await createMintCompat(connection, admin, admin.publicKey, null, 6);
  const usdtMint = MAIN_POOL_MINT;
  log('Live pool USDT mint', usdtMint.toBase58());
  log('Verification collateral mint', collateralMint.toBase58());

  const adminUsdtAta = await getOrCreateAtaCompat(connection, admin, usdtMint, admin.publicKey);
  const borrowerUsdtAta = await getOrCreateAtaCompat(connection, admin, usdtMint, borrower.publicKey);
  const borrowerCollateralAta = await getOrCreateAtaCompat(connection, admin, collateralMint, borrower.publicKey);

  await mintToCompat(connection, admin, usdtMint, borrowerUsdtAta.address, admin.publicKey, 500_000_000);
  await mintToCompat(connection, admin, collateralMint, borrowerCollateralAta.address, admin.publicKey, 2_000_000);

  try {
    const airdropSig = await connection.requestAirdrop(borrower.publicKey, 2_000_000_000);
    await connection.confirmTransaction(airdropSig, 'confirmed');
  } catch {
    const fundTx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: borrower.publicKey,
      lamports: 200_000_000,
    }));
    await adminProvider.sendAndConfirm(fundTx, [admin]);
  }

  const [poolState] = PublicKey.findProgramAddressSync([Buffer.from('pool'), usdtMint.toBuffer()], LENDING_PROGRAM_ID);
  const [poolVault] = PublicKey.findProgramAddressSync([Buffer.from('pool_vault'), usdtMint.toBuffer()], LENDING_PROGRAM_ID);

  const [oracleState] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], ORACLE_PROGRAM_ID);
  const [oracleAuthority] = PublicKey.findProgramAddressSync([Buffer.from('oracle_auth'), creditAgent.publicKey.toBuffer()], ORACLE_PROGRAM_ID);
  const [creditScore] = PublicKey.findProgramAddressSync([Buffer.from('credit_score'), borrower.publicKey.toBuffer()], ORACLE_PROGRAM_ID);

  await oracleProgram.methods.updateScore(720, 92, ZERO_HASH, ZERO_HASH).accountsStrict({
    oracleState,
    oracleAuthority,
    creditScore,
    borrower: borrower.publicKey,
    oracleAgent: creditAgent.publicKey,
    systemProgram: SystemProgram.programId,
  }).signers([creditAgent]).rpc();
  log('High score pushed', borrower.publicKey.toBase58());

  const poolBefore = await lendingAdminProgram.account.poolState.fetch(poolState);
  const loanId = await findUsableLoanId(connection, poolBefore);
  const loanSeed = Buffer.alloc(8);
  loanSeed.writeBigUInt64LE(BigInt(loanId));
  const [escrowState] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), loanSeed], LENDING_PROGRAM_ID);
  const [escrowVault] = PublicKey.findProgramAddressSync([Buffer.from('escrow_vault'), loanSeed], LENDING_PROGRAM_ID);
  const [loan] = PublicKey.findProgramAddressSync([Buffer.from('loan'), poolState.toBuffer(), loanSeed], LENDING_PROGRAM_ID);
  const [permState] = PublicKey.findProgramAddressSync([Buffer.from('perm_state')], PERMISSIONS_PROGRAM_ID);
  const [agentIdentity] = PublicKey.findProgramAddressSync([Buffer.from('agent_id'), lendingAgent.publicKey.toBuffer()], PERMISSIONS_PROGRAM_ID);

  const poolBeforeInterest = BigInt(String(poolBefore.totalInterestEarned ?? poolBefore.total_interest_earned));

  await lendingBorrowerProgram.methods.lockCollateral(new BN(loanId), new BN(1_500_000)).accountsStrict({
    poolState,
    escrowState,
    escrowVault,
    collateralMint,
    borrowerAta: borrowerCollateralAta.address,
    borrower: borrower.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).signers([borrower]).rpc();
  log('Collateral locked', `loan #${loanId}`);

  await lendingAgentProgram.methods.conditionalDisburse(
    new BN(PRINCIPAL_RAW),
    1_800,
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
  log('Loan disbursed', `loan #${loanId} principal 5000`);

  await new Promise((resolve) => setTimeout(resolve, 4000));

  const poolMid = await lendingAdminProgram.account.poolState.fetch(poolState);
  log('Interest index before repay', String(poolMid.interestIndex ?? poolMid.interest_index));

  await lendingBorrowerProgram.methods.repay(new BN(PRINCIPAL_RAW + 1_000_000_000)).accountsStrict({
    poolState,
    poolVault,
    loan,
    borrowerAta: borrowerUsdtAta.address,
    borrower: borrower.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([borrower]).rpc();
  log('Loan repaid', `loan #${loanId}`);

  const poolAfter = await lendingAdminProgram.account.poolState.fetch(poolState);
  const totalInterestRaw = BigInt(String(poolAfter.totalInterestEarned ?? poolAfter.total_interest_earned));
  const interestDeltaRaw = totalInterestRaw - poolBeforeInterest;
  const totalBorrowedRaw = BigInt(String(poolAfter.totalBorrowed ?? poolAfter.total_borrowed));
  const activeLoans = Number(poolAfter.activeLoans ?? poolAfter.active_loans);
  log('Pool interest earned raw', totalInterestRaw.toString());
  log('Pool interest earned UI', (Number(totalInterestRaw) / Number(DECIMALS)).toFixed(6));
  log('Interest delta raw', interestDeltaRaw.toString());
  log('Interest delta UI', (Number(interestDeltaRaw) / Number(DECIMALS)).toFixed(6));
  log('Pool borrowed raw', totalBorrowedRaw.toString());
  log('Pool active loans', String(activeLoans));

  if (interestDeltaRaw <= 0n) {
    throw new Error('Yield verification did not accrue visible interest. Increase wait time and retry.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
