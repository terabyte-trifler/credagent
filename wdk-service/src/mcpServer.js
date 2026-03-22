/**
 * @module mcpServer
 * @description Standalone MCP SSE server for CredAgent.
 *
 * Endpoints:
 * - GET  /mcp         authenticated SSE stream
 * - POST /mcp/call    authenticated tool invocation
 * - GET  /mcp/tools   authenticated tool discovery
 * - POST /auth/token  exchange API key for short-lived session token
 * - POST /auth/revoke authenticated session revocation
 * - GET  /health      public healthcheck
 * - GET  /audit       authenticated audit log access
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { WalletService } from './walletService.js';
import { TokenOps } from './tokenOps.js';
import { BridgeService } from './bridgeService.js';
import { MCPBridge } from './mcpBridge.js';
import { SafetyMiddleware } from './safetyMiddleware.js';
import { AuditLog } from './auditLog.js';
import { createAuthFromEnv } from './auth.js';
import { CreditAssessmentAgent } from '../../agent/src/creditAgent.js';
import { LendingDecisionAgent } from '../../agent/src/lendingAgent.js';
import { CollectionTrackerAgent } from '../../agent/src/collectionAgent.js';
import { YieldOptimizerAgent } from '../../agent/src/yieldAgent.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

const DEFAULT_HOST = process.env.MCP_HOST || '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.MCP_PORT || '3100', 10);
const DEFAULT_ML_API_URL = process.env.ML_API_URL || 'http://localhost:5001';
const DEFAULT_LOCAL_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3100',
  'http://localhost:3100',
];

const DEFAULT_AGENT_TIERS = {
  'credit-agent': 1,
  'lending-agent': 2,
  'collection-agent': 1,
  'yield-agent': 2,
};

const DEFAULT_AGENT_LIMITS = {
  'lending-agent': '10000000000',
  'collection-agent': '1000000000',
  'yield-agent': '5000000000',
};

const DEFAULT_AGENT_META = {
  'credit-agent': { name: 'Credit Agent', role: 'Oracle', icon: 'brain', color: '#a78bfa' },
  'lending-agent': { name: 'Lending Agent', role: 'Lending', icon: 'banknote', color: '#14c972' },
  'collection-agent': { name: 'Collection Agent', role: 'Collection', icon: 'clock', color: '#f59e0b' },
  'yield-agent': { name: 'Yield Agent', role: 'Yield', icon: 'trending-up', color: '#3b82f6' },
};

const DEFAULT_AGENT_RUNTIME = {
  'credit-agent': { role: { oracle: {} }, tier: { operate: {} }, dailyLimit: '1000000' },
  'lending-agent': { role: { lending: {} }, tier: { manage: {} }, dailyLimit: '10000000000' },
  'collection-agent': { role: { collection: {} }, tier: { operate: {} }, dailyLimit: '1000000000' },
  'yield-agent': { role: { yield: {} }, tier: { manage: {} }, dailyLimit: '5000000000' },
};

const TOKEN_DECIMALS = 1_000_000;
const DEFAULT_POOL_HISTORY_LIMIT = 288;
const DEFAULT_POOL_SNAPSHOT_MS = 5_000;

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

function parseOriginList(value) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveAllowedOrigins(config = {}, host = DEFAULT_HOST) {
  if (config.allowedOrigins) return [...config.allowedOrigins];
  const envOrigins = parseOriginList(
    process.env.MCP_CORS_ORIGINS || process.env.MCP_ALLOWED_ORIGINS || '',
  );
  if (envOrigins.length > 0) return envOrigins;
  return isLocalHost(host) ? [...DEFAULT_LOCAL_ORIGINS] : [];
}

class SSEManager {
  #clients = new Set();
  #nextId = 1;

  add(res, toolCount, clientId = 'anonymous') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.#send(res, 'connected', {
      id: this.#nextId++,
      tools: toolCount,
      clientId,
    });
    this.#clients.add(res);
    res.on('close', () => {
      this.#clients.delete(res);
    });
  }

  broadcast(event, data) {
    for (const client of this.#clients) {
      this.#send(client, event, data);
    }
  }

  drainAll() {
    for (const client of this.#clients) {
      this.#send(client, 'shutdown', { reason: 'server stopping' });
      try {
        client.end();
      } catch {}
    }
    this.#clients.clear();
  }

  get size() {
    return this.#clients.size;
  }

  #send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function applyCorsHeaders(req, res, allowedOrigins, authEnabled) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    authEnabled ? 'Content-Type, Authorization' : 'Content-Type',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function cors(req, res, allowedOrigins, authEnabled) {
  if (!applyCorsHeaders(req, res, allowedOrigins, authEnabled)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'CORS_FORBIDDEN' }));
    return;
  }
  res.writeHead(204);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Body too large (>1MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString() || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function combineAuditEntries(services, count) {
  const limit = Math.max(1, Math.min(count, 200));
  const entries = [
    ...(services.audit?.getRecent ? services.audit.getRecent(limit) : []),
    ...(services.mcpBridge?.getAuditLog ? services.mcpBridge.getAuditLog(limit) : []),
    ...(services.safety?.getAuditLog ? services.safety.getAuditLog(limit) : []),
  ];
  return entries
    .sort((a, b) => {
      const left = String(b.ts || b.isoTime || b.timestamp || '');
      const right = String(a.ts || a.isoTime || a.timestamp || '');
      return left.localeCompare(right);
    })
    .slice(0, limit);
}

function isBootstrapAdminTool(toolName) {
  return toolName === 'create_wallet';
}

function isBuildOnlyResult(result) {
  return (
    result?.success &&
    result?.result?.status === 'instruction_built' &&
    result?.result?.submitted === false
  );
}

function getCollectionAgentAddress(walletService) {
  try {
    return walletService.getAddress('collection-agent');
  } catch {
    return '';
  }
}

function summarizeDecisionEntry(entry) {
  return {
    action: entry.action || entry.event || entry.tool || entry.operation || 'Activity',
    agent: entry.agent || entry.agentId || entry.agent_id || entry.clientId || 'system',
    status: entry.status === 'EXECUTION_FAILED' || entry.success === false || entry.blocked
      ? 'error'
      : entry.status === 'PUSH_FAILED'
        ? 'error'
        : 'success',
    timestamp: entry.ts || entry.isoTime || entry.timestamp || new Date().toISOString(),
    summary:
      entry.detail ||
      entry.summary ||
      entry.resultSummary ||
      entry.errorMsg ||
      entry.error ||
      entry.reason ||
      entry.status ||
      'No summary available',
    txHash: entry.txHash || entry.tx_hash || null,
    decisionHash: entry.decisionHash || entry.decision_hash || entry.reasoningHash || null,
  };
}

function buildDecisionFeed(services, count) {
  const limit = Math.max(1, Math.min(count, 200));
  const entries = [
    ...(services.creditAgent?.getAuditLog?.(limit) || []),
    ...(services.lendingAgent?.getDecisionLog?.(limit) || []),
    ...(services.collectionAgent?.getAuditLog?.(limit) || []),
    ...(services.yieldAgent?.getAuditLog?.(limit) || []),
    ...combineAuditEntries(services, limit),
  ];

  return entries
    .map(summarizeDecisionEntry)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
}

function readU64(buf, offset) {
  return Number(buf.readBigUInt64LE(offset));
}

function readU32(buf, offset) {
  return buf.readUInt32LE(offset);
}

function readU16(buf, offset) {
  return buf.readUInt16LE(offset);
}

function resolveLendingPoolProgramId() {
  const idlPath = path.join(resolveWorkspaceRoot(), 'target/idl/lending_pool.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`MISSING_IDL: ${idlPath}`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  return new PublicKey(idl.address);
}

function deriveLendingPoolAddresses(tokenMint) {
  const programId = resolveLendingPoolProgramId();
  const [poolState] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), tokenMint.toBuffer()],
    programId,
  );
  return { programId, poolState };
}

async function fetchLivePoolSnapshot(walletService) {
  const connection = new anchor.web3.Connection(walletService.getRpcUrl(), 'confirmed');
  const tokenMint = new PublicKey(process.env.MOCK_USDT_MINT);
  const { poolState } = deriveLendingPoolAddresses(tokenMint);
  const account = await connection.getAccountInfo(poolState, 'confirmed');
  if (!account) {
    return {
      timestamp: new Date().toISOString(),
      deposited: 0,
      borrowed: 0,
      utilization: 0,
      interestEarned: 0,
      activeLoans: 0,
      defaultRate: 0,
      baseRateBps: 0,
    };
  }

  const body = Buffer.from(account.data).subarray(8);
  const aggregated = {
    totalDeposited: readU64(body, 64) / TOKEN_DECIMALS,
    totalBorrowed: readU64(body, 72) / TOKEN_DECIMALS,
    interestEarned: readU64(body, 80) / TOKEN_DECIMALS,
    totalDefaults: readU64(body, 88),
    activeLoans: readU32(body, 96),
    totalLoans: readU32(body, 100),
    baseRateBps: readU16(body, 112),
  };

  return {
    timestamp: new Date().toISOString(),
    deposited: aggregated.totalDeposited,
    borrowed: aggregated.totalBorrowed,
    utilization: aggregated.totalDeposited > 0
      ? Number(((aggregated.totalBorrowed / aggregated.totalDeposited) * 100).toFixed(2))
      : 0,
    interestEarned: aggregated.interestEarned,
    activeLoans: aggregated.activeLoans,
    defaultRate: aggregated.totalLoans > 0
      ? Number(((aggregated.totalDefaults / aggregated.totalLoans) * 100).toFixed(2))
      : 0,
    baseRateBps: aggregated.baseRateBps,
  };
}

async function fetchLiveLoanRows(walletService) {
  const connection = new anchor.web3.Connection(walletService.getRpcUrl(), 'confirmed');
  const tokenMint = new PublicKey(process.env.MOCK_USDT_MINT);
  const { programId, poolState } = deriveLendingPoolAddresses(tokenMint);
  const poolAccount = await connection.getAccountInfo(poolState, 'confirmed');
  if (!poolAccount) return [];
  const poolBody = Buffer.from(poolAccount.data).subarray(8);
  const nextLoanId = readU64(poolBody, 104);
  const interestIndex = readU64(poolBody, 116) + (readU64(poolBody, 124) * 2 ** 64);
  const loans = [];

  for (let loanId = 1; loanId < nextLoanId; loanId += 1) {
    const loanSeed = Buffer.alloc(8);
    loanSeed.writeBigUInt64LE(BigInt(loanId));
    const [loanPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('loan'), poolState.toBuffer(), loanSeed],
      programId,
    );
    const [schedulePda] = PublicKey.findProgramAddressSync([Buffer.from('schedule'), loanSeed], programId);
    const [escrowPda] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), loanSeed], programId);
    const [loanInfo, scheduleInfo, escrowInfo] = await Promise.all([
      connection.getAccountInfo(loanPda, 'confirmed'),
      connection.getAccountInfo(schedulePda, 'confirmed'),
      connection.getAccountInfo(escrowPda, 'confirmed'),
    ]);
    if (!loanInfo) continue;

    const body = Buffer.from(loanInfo.data).subarray(8);
    const principalRaw = readU64(body, 104);
    const principal = principalRaw / TOKEN_DECIMALS;
    const rateBps = readU16(body, 112);
    const startTimeSecs = Number(body.readBigInt64LE(114));
    const dueDateSecs = Number(body.readBigInt64LE(122));
    const repaidRaw = readU64(body, 130);
    const repaid = repaidRaw / TOKEN_DECIMALS;
    const statusCode = body[138];
    const borrower = new PublicKey(body.subarray(40, 72)).toBase58();
    const escrowPubkey = new PublicKey(body.subarray(139, 171)).toBase58();
    const indexLow = readU64(body, 235);
    const indexHigh = readU64(body, 243);
    const indexSnapshot = indexLow + (indexHigh * 2 ** 64);
    const interestOwedRaw = interestIndex > indexSnapshot
      ? Math.floor((principalRaw * (interestIndex - indexSnapshot)) / 1_000_000_000_000_000_000)
      : 0;

    let paidInstallments = 0;
    let totalInstallments = 0;
    let installmentAmount = 0;
    if (scheduleInfo) {
      const sched = Buffer.from(scheduleInfo.data).subarray(8);
      totalInstallments = sched[72];
      paidInstallments = sched[73];
      installmentAmount = readU64(sched, 74) / TOKEN_DECIMALS;
    }

    if (statusCode === 1 && totalInstallments > 0 && paidInstallments < totalInstallments) {
      paidInstallments = totalInstallments;
    }

    let collateralMint = null;
    if (escrowInfo) {
      const escrow = Buffer.from(escrowInfo.data).subarray(8);
      collateralMint = new PublicKey(escrow.subarray(40, 72)).toBase58();
    }

    loans.push({
      id: loanId,
      borrower,
      principal,
      rateBps,
      issueTime: new Date(startTimeSecs * 1000).toISOString(),
      dueDate: new Date(dueDateSecs * 1000).toISOString().slice(0, 10),
      repaid,
      status: statusCode === 1 ? 'Repaid' : (statusCode === 2 || statusCode === 3 ? 'Defaulted' : 'Active'),
      escrowStatus: statusCode === 1 ? 'Released' : (statusCode === 2 || statusCode === 3 ? 'Liquidated' : 'Locked'),
      paidInstallments,
      totalInstallments,
      installmentAmount,
      accountPubkey: loanPda.toBase58(),
      poolPubkey: poolState.toBase58(),
      escrowPubkey,
      collateralMint,
      outstandingEstimate: Math.max(0, (principalRaw + interestOwedRaw - repaidRaw) / TOKEN_DECIMALS),
    });
  }

  return loans.sort((a, b) => b.id - a.id);
}

class PoolHistoryStore {
  #walletService;
  #filePath;
  #entries = [];
  #limit;
  #intervalMs;
  #timer = null;

  constructor(walletService, options = {}) {
    this.#walletService = walletService;
    this.#filePath = options.filePath || path.resolve(process.cwd(), '.mcp-state/pool-history.json');
    this.#limit = options.limit || DEFAULT_POOL_HISTORY_LIMIT;
    this.#intervalMs = options.intervalMs || DEFAULT_POOL_SNAPSHOT_MS;
  }

  async init() {
    await fs.promises.mkdir(path.dirname(this.#filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.#filePath, 'utf8'));
      this.#entries = Array.isArray(parsed?.entries) ? parsed.entries.slice(-this.#limit) : [];
    } catch {}
    await this.capture({ eventType: 'snapshot', eventLabel: 'Initial snapshot' });
    this.#timer = setInterval(() => {
      this.capture().catch(() => {});
    }, this.#intervalMs);
  }

  async capture(eventMeta = {}) {
    const snapshot = {
      ...(await fetchLivePoolSnapshot(this.#walletService)),
      ...eventMeta,
    };
    this.#entries.push(snapshot);
    this.#entries = this.#entries.slice(-this.#limit);
    await fs.promises.writeFile(this.#filePath, JSON.stringify({ entries: this.#entries }, null, 2));
    return snapshot;
  }

  getRecent(count = 30) {
    return this.#entries.slice(-Math.max(1, Math.min(count, this.#limit)));
  }

  close() {
    if (this.#timer) clearInterval(this.#timer);
  }
}

async function buildAgentRuntimeSnapshot(services) {
  const combinedAudit = combineAuditEntries(services, 500);
  const now = Date.now();
  const oneDayAgo = now - 86_400_000;

  return Promise.all(Object.entries(DEFAULT_AGENT_META).map(async ([agentId, meta]) => {
    try {
      const balance = await services.walletService.getSolBalance(agentId);
      const auditEntries = combinedAudit.filter((entry) => {
        const entryAgent = entry.agent || entry.agentId || entry.agent_id;
        if (entryAgent !== agentId) return false;
        const ts = Date.parse(entry.ts || entry.isoTime || entry.timestamp || '');
        return Number.isFinite(ts) ? ts >= oneDayAgo : true;
      });
      const latestEntry = auditEntries[0] || null;
      const limit = services.safety?.getAgentLimitSnapshot?.(agentId);

      return {
        id: agentId,
        ...meta,
        tier: services.safety?.getAgentTier?.(agentId) ?? DEFAULT_AGENT_TIERS[agentId] ?? 0,
        status: 'active',
        balance: (Number(balance.lamports || 0) / 1_000_000_000).toFixed(2),
        opsToday: auditEntries.length,
        limitUsedPct: limit?.usedPct ?? 0,
        lastAction:
          latestEntry?.summary ||
          latestEntry?.error ||
          latestEntry?.reason ||
          latestEntry?.status ||
          'Connected to MCP runtime',
        walletAddress: services.walletService.getAddress(agentId),
      };
    } catch (error) {
      const message = error?.message || 'Wallet not initialized in MCP yet';
      return {
        id: agentId,
        ...meta,
        tier: services.safety?.getAgentTier?.(agentId) ?? DEFAULT_AGENT_TIERS[agentId] ?? 0,
        status: /not found|wallet/i.test(message) ? 'uninitialized' : 'error',
        balance: '--',
        opsToday: 0,
        limitUsedPct: 0,
        lastAction: message,
        walletAddress: null,
      };
    }
  }));
}

function parseLoanRequest(body = {}) {
  const amountUsd = Number(body.amountUsd ?? body.amount ?? 0);
  const durationDays = Number(body.durationDays ?? body.duration ?? 0);
  if (!body.borrower || typeof body.borrower !== 'string') {
    throw new Error('Missing "borrower" field');
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error('Missing or invalid "amountUsd" field');
  }
  const safeDuration = Number.isFinite(durationDays) && durationDays > 0 ? durationDays : 30;
  return {
    borrower: body.borrower,
    amountUsd,
    durationDays: safeDuration,
  };
}

async function buildExecutionPrep(services, borrower) {
  const session = services.lendingAgent?.getActiveSession?.(borrower);
  if (!session?.currentOffer) {
    throw new Error('No active negotiated offer for this borrower');
  }

  const loanIdResult = await services.mcpBridge.executeTool('get_next_loan_id', {
    agent_id: 'lending-agent',
  });
  if (!loanIdResult.success || !Number.isInteger(loanIdResult.result?.loan_id)) {
    throw new Error(`LOAN_ID_FAILED: ${loanIdResult.error || 'No loan_id returned'}`);
  }

  const loanId = Number(loanIdResult.result.loan_id);
  const borrowerPubkey = new PublicKey(borrower);
  const usdtMint = new PublicKey(process.env.MOCK_USDT_MINT);
  const collateralMint = new PublicKey(process.env.MOCK_XAUT_MINT || '11111111111111111111111111111111');
  const collectionAgentAddress = getCollectionAgentAddress(services.walletService);
  const { programId, poolState } = deriveLendingPoolAddresses(usdtMint);

  const loanSeed = Buffer.alloc(8);
  loanSeed.writeBigUInt64LE(BigInt(loanId));
  const [escrowState] = PublicKey.findProgramAddressSync([Buffer.from('escrow'), loanSeed], programId);
  const [escrowVault] = PublicKey.findProgramAddressSync([Buffer.from('escrow_vault'), loanSeed], programId);
  const [borrowerCollateralAta] = PublicKey.findProgramAddressSync(
    [borrowerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), collateralMint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const xautPrice = Number(process.env.MOCK_XAUT_PRICE_USD || '2300');
  const collateralAmountRaw = collateralMint.toBase58() === process.env.MOCK_XAUT_MINT
    ? Math.max(1, Math.ceil((session.currentOffer.collateralUsd / xautPrice) * TOKEN_DECIMALS))
    : Math.max(1, Math.ceil(session.currentOffer.collateralUsd * TOKEN_DECIMALS));
  const autopayAmountRaw = Math.max(
    1,
    Math.ceil(session.currentOffer.installmentAmount * session.currentOffer.numInstallments * TOKEN_DECIMALS),
  );

  return {
    borrower,
    loanId,
    offer: session.currentOffer,
    lendingPath: session.lendingPath,
    poolState: poolState.toBase58(),
    programId: programId.toBase58(),
    usdtMint: usdtMint.toBase58(),
    collateralMint: collateralMint.toBase58(),
    borrowerCollateralAta: borrowerCollateralAta.toBase58(),
    escrowState: escrowState.toBase58(),
    escrowVault: escrowVault.toBase58(),
    collateralAmountRaw: String(collateralAmountRaw),
    collectionAgentAddress,
    autopayAmountRaw: String(autopayAmountRaw),
  };
}

function formatDemoSteps(scoreResult, evaluation, execution) {
  const steps = [];
  if (scoreResult) {
    steps.push(`Score status: ${scoreResult.status} · ${scoreResult.score} (${scoreResult.tier})`);
  }
  if (evaluation) {
    if (String(evaluation.status || '').startsWith('DENIED')) {
      steps.push(`Evaluation denied: ${evaluation.error || evaluation.status}`);
    } else {
      steps.push(
        `Evaluation ready: $${evaluation.offer?.principal ?? 0} @ ${((evaluation.offer?.rateBps ?? 0) / 100).toFixed(1)}% for ${evaluation.offer?.durationDays ?? 0}d`,
      );
    }
  }
  if (execution) {
    steps.push(`Execution status: ${execution.status}`);
    if (execution.steps?.lockCollateral?.result?.txHash) {
      steps.push(`Collateral locked on-chain: ${execution.steps.lockCollateral.result.txHash}`);
    } else if (execution.steps?.lockCollateral?.result?.status === 'instruction_built') {
      steps.push('Collateral step built only: borrower signer not available to MCP runtime');
    }
    if (execution.steps?.disburse?.result?.txHash) {
      steps.push(`Disbursement submitted: ${execution.steps.disburse.result.txHash}`);
    }
    if (execution.steps?.createSchedule?.result?.txHash) {
      steps.push(`Installment schedule submitted: ${execution.steps.createSchedule.result.txHash}`);
    }
  }
  return steps;
}

function resolveWorkspaceRoot() {
  return path.resolve(__dirname, '../..');
}

function resolveAnchorWalletPath() {
  return process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json');
}

function loadKeypairFromFile(walletPath) {
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8')));
  return Keypair.fromSecretKey(secretKey);
}

async function ensureAgentPermissionsRuntime(walletService) {
  const workspaceRoot = resolveWorkspaceRoot();
  const idlPath = path.join(workspaceRoot, 'target/idl/agent_permissions.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`MISSING_IDL: ${idlPath}`);
  }

  const walletPath = resolveAnchorWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`MISSING_ANCHOR_WALLET: ${walletPath}`);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const adminSigner = loadKeypairFromFile(walletPath);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(walletService.getRpcUrl(), 'confirmed'),
    {
      publicKey: adminSigner.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(adminSigner);
        return tx;
      },
      signAllTransactions: async (txs) => txs.map((tx) => {
        tx.partialSign(adminSigner);
        return tx;
      }),
    },
    { commitment: 'confirmed' },
  );

  const program = new anchor.Program(idl, provider);
  const [permState] = PublicKey.findProgramAddressSync([Buffer.from('perm_state')], program.programId);
  const existingPermState = await program.account.permState.fetchNullable(permState);
  if (!existingPermState) {
    await program.methods.initialize().accounts({
      permState,
      admin: adminSigner.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  for (const [agentId, config] of Object.entries(DEFAULT_AGENT_RUNTIME)) {
    if (!walletService.hasWallet(agentId)) continue;
    const agentWallet = new PublicKey(walletService.getAddress(agentId));
    const [agentIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from('agent_id'), agentWallet.toBuffer()],
      program.programId,
    );
    const existingIdentity = await program.account.agentIdentity.fetchNullable(agentIdentity);
    if (existingIdentity) continue;

    await program.methods.registerAgent(
      config.role,
      config.tier,
      new BN(config.dailyLimit),
    ).accounts({
      permState,
      agentIdentity,
      agentWallet,
      admin: adminSigner.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();
  }
}

async function submitCreditHistoryEvent(walletService, eventType, borrowerAddress, amountRaw = 0) {
  const workspaceRoot = resolveWorkspaceRoot();
  const idlPath = path.join(workspaceRoot, 'target/idl/credit_score_oracle.json');
  if (!fs.existsSync(idlPath)) {
    throw new Error(`MISSING_IDL: ${idlPath}`);
  }

  const walletPath = resolveAnchorWalletPath();
  if (!fs.existsSync(walletPath)) {
    throw new Error(`MISSING_ANCHOR_WALLET: ${walletPath}`);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const adminSigner = loadKeypairFromFile(walletPath);
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(walletService.getRpcUrl(), 'confirmed'),
    {
      publicKey: adminSigner.publicKey,
      signTransaction: async (tx) => {
        tx.partialSign(adminSigner);
        return tx;
      },
      signAllTransactions: async (txs) => txs.map((tx) => {
        tx.partialSign(adminSigner);
        return tx;
      }),
    },
    { commitment: 'confirmed' },
  );

  const program = new anchor.Program(idl, provider);
  const borrower = new PublicKey(borrowerAddress);
  const [oracleState] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], program.programId);
  const [creditHistory] = PublicKey.findProgramAddressSync([Buffer.from('credit_history'), borrower.toBuffer()], program.programId);

  const accounts = {
    oracleState,
    creditHistory,
    borrower,
    authority: adminSigner.publicKey,
    systemProgram: SystemProgram.programId,
  };

  if (eventType === 'issued') {
    return program.methods.recordLoanIssued(new BN(amountRaw)).accounts(accounts).rpc();
  }
  if (eventType === 'repaid') {
    return program.methods.recordLoanRepaid(new BN(amountRaw)).accounts(accounts).rpc();
  }
  if (eventType === 'defaulted') {
    return program.methods.recordLoanDefaulted().accounts(accounts).rpc();
  }
  throw new Error(`UNKNOWN_CREDIT_HISTORY_EVENT: ${eventType}`);
}

export async function createServices(config = {}) {
  const audit = config.audit || new AuditLog();
  const rpcUrl = config.rpcUrl || process.env.WDK_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const walletService = new WalletService({
    rpcUrl,
    stateDir: config.stateDir || path.resolve(process.cwd(), '.mcp-state'),
  });
  await walletService.restorePersistedWallets();
  const tokenOps = new TokenOps(walletService, rpcUrl, audit);
  const bridgeService = new BridgeService({ audit });

  const mcpBridge = new MCPBridge(
    { walletService, tokenOps, bridgeService },
    { mlApiUrl: config.mlApiUrl || DEFAULT_ML_API_URL },
  );

  const safety = new SafetyMiddleware(mcpBridge, {
    agentTiers: config.agentTiers || DEFAULT_AGENT_TIERS,
  });

  const limits = config.agentLimits || DEFAULT_AGENT_LIMITS;
  for (const [agentId, limit] of Object.entries(limits)) {
    safety.registerAgentLimit(agentId, limit);
  }

  const auth = config.auth !== undefined ? config.auth : createAuthFromEnv(audit);
  const creditAgent = config.creditAgent || new CreditAssessmentAgent(mcpBridge);
  const collectionAgent = config.collectionAgent || new CollectionTrackerAgent(mcpBridge);
  const lendingAgent = config.lendingAgent || new LendingDecisionAgent(
    mcpBridge,
    creditAgent,
    getCollectionAgentAddress(walletService),
  );
  const yieldAgent = config.yieldAgent || new YieldOptimizerAgent(mcpBridge);
  const poolHistory = config.poolHistory || new PoolHistoryStore(walletService, {
    filePath: path.resolve(process.cwd(), '.mcp-state/pool-history.json'),
  });

  for (const agentId of Object.keys(DEFAULT_AGENT_META)) {
    if (!walletService.hasWallet(agentId)) {
      await walletService.createAgentWallet(agentId);
    }
    const meta = DEFAULT_AGENT_META[agentId];
    audit.log(
      'agent_runtime_ready',
      agentId,
      { role: meta.role, tier: DEFAULT_AGENT_TIERS[agentId] },
      'Connected to MCP runtime',
      0,
      'success',
    );
  }

  await ensureAgentPermissionsRuntime(walletService);
  audit.log(
    'permissions_runtime_ready',
    'system',
    {},
    'Agent permissions runtime initialized',
    0,
    'success',
  );
  await poolHistory.init();
  audit.log(
    'pool_history_ready',
    'system',
    { snapshotIntervalMs: DEFAULT_POOL_SNAPSHOT_MS },
    'Pool snapshot history initialized',
    0,
    'success',
  );

  return {
    walletService,
    tokenOps,
    bridgeService,
    mcpBridge,
    safety,
    audit,
    auth,
    creditAgent,
    collectionAgent,
    lendingAgent,
    yieldAgent,
    poolHistory,
  };
}

export function createHttpServer(services, config = {}) {
  const {
    safety,
    mcpBridge,
    auth,
    creditAgent,
    lendingAgent,
  } = services;
  const sse = new SSEManager();
  const startedAt = Date.now();
  const host = config.host || DEFAULT_HOST;
  const allowedOrigins = new Set(resolveAllowedOrigins(config, host));
  const authEnabled = auth !== null && auth !== undefined;

  const requireAuth = (req, res) => {
    if (!authEnabled) {
      return {
        authenticated: true,
        clientId: 'local',
        public: false,
        allowedAgents: null,
        tier: 3,
      };
    }

    const authResult = auth.authenticate(req);
    if (!authResult?.authenticated) {
      json(res, authResult?.statusCode || 401, {
        success: false,
        error: authResult?.error || 'Unauthorized',
      });
      return null;
    }
    return authResult;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    if (!applyCorsHeaders(req, res, allowedOrigins, authEnabled)) {
      return json(res, 403, { success: false, error: 'CORS_FORBIDDEN' });
    }

    if (req.method === 'OPTIONS') return cors(req, res, allowedOrigins, authEnabled);

    if (pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        status: 'ok',
        service: 'credagent-mcp',
        host,
        port: config.port || DEFAULT_PORT,
        authEnabled,
        sseClients: sse.size,
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        ...(authEnabled && auth?.getStats ? { authStats: auth.getStats() } : {}),
      });
    }

    if (pathname === '/auth/token' && req.method === 'POST') {
      if (!authEnabled) {
        return json(res, 200, {
          token: 'ses_localhost-mode',
          note: 'Auth disabled in localhost mode. This token is a no-op.',
          expiresInSecs: 999999,
        });
      }

      const authResult = auth.authenticate(req);
      if (!authResult?.authenticated) {
        return json(res, authResult?.statusCode || 401, {
          success: false,
          error: authResult?.error || 'Unauthorized',
        });
      }

      const session = auth.createSession(authResult);
      if (session?.error) {
        return json(res, 400, { success: false, error: session.error });
      }
      return json(res, 200, { success: true, ...session });
    }

    if (pathname === '/auth/revoke' && req.method === 'POST') {
      if (!authEnabled) {
        return json(res, 200, { success: true, revoked: false, note: 'Auth disabled' });
      }
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        return json(res, 200, { success: true, revoked: auth.revokeSession(body.token || '') });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/mcp' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      sse.add(res, mcpBridge.getToolList().length, authResult.clientId);
      return;
    }

    if (pathname === '/mcp/call' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;

      try {
        const body = await readBody(req);
        if (!body?.tool || typeof body.tool !== 'string') {
          return json(res, 400, { success: false, error: 'Missing "tool" field' });
        }

        const agentId = body.params?.agent_id;
        if (authEnabled && agentId && !auth.isAgentAllowed(authResult, agentId)) {
          return json(res, 403, {
            success: false,
            error: `AGENT_SCOPE: Key "${authResult.clientId}" is not authorized for agent "${agentId}"`,
            blocked: true,
          });
        }

        const toolTierMap = safety.getToolTierMap();
        const requiredTier = toolTierMap[body.tool];
        if (
          authEnabled &&
          requiredTier !== undefined &&
          Number.isFinite(authResult.tier) &&
          authResult.tier < requiredTier
        ) {
          return json(res, 403, {
            success: false,
            error: `CLIENT_TIER: Key "${authResult.clientId}" has tier ${authResult.tier}, tool "${body.tool}" requires tier ${requiredTier}`,
            blocked: true,
            clientTier: authResult.tier,
            requiredTier,
          });
        }

        const result = isBootstrapAdminTool(body.tool)
          ? await mcpBridge.executeTool(body.tool, body.params || {})
          : await safety.executeTool(body.tool, body.params || {});
        if (isBuildOnlyResult(result)) {
          return json(res, 409, {
            success: false,
            error: `BUILD_ONLY_UNAVAILABLE: ${body.tool} requires signer/config not available to the running MCP server`,
            blocked: true,
            result: result.result,
          });
        }

        sse.broadcast('tool_result', {
          tool: body.tool,
          result,
          clientId: authResult.clientId,
          ts: Date.now(),
        });
        return json(res, result.success ? 200 : 422, result);
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/mcp/tools' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      return json(res, 200, {
        tools: mcpBridge.getToolList(),
        tierMap: safety.getToolTierMap(),
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
        clientId: authResult.clientId,
      });
    }

    if (pathname === '/runtime/agents' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const agents = await buildAgentRuntimeSnapshot(services);
      return json(res, 200, { agents });
    }

    if (pathname === '/runtime/pool' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const latest = await services.poolHistory.capture().catch(() => null);
      return json(res, 200, { pool: latest });
    }

    if (pathname === '/runtime/loans' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const loans = await fetchLiveLoanRows(services.walletService).catch(() => []);
      return json(res, 200, { loans });
    }

    if (pathname === '/runtime/decisions' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const count = Number.parseInt(url.searchParams.get('count') || '50', 10);
      return json(res, 200, { decisions: buildDecisionFeed(services, count) });
    }

    if (pathname === '/runtime/pool-history' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const count = Number.parseInt(url.searchParams.get('count') || '30', 10);
      const latest = await services.poolHistory.capture().catch(() => null);
      return json(res, 200, {
        latest,
        points: services.poolHistory.getRecent(count),
      });
    }

    if (pathname === '/agent/lending/evaluate' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        const request = parseLoanRequest(body);
        const result = await lendingAgent.evaluateLoan(
          request.borrower,
          request.amountUsd,
          request.durationDays,
        );
        return json(res, 200, { success: true, result });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/agent/lending/negotiate' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        if (!body?.borrower) throw new Error('Missing "borrower" field');
        const counterOffer = {};
        if (body.amountUsd !== undefined) counterOffer.principal = Number(body.amountUsd);
        if (body.durationDays !== undefined) counterOffer.durationDays = Number(body.durationDays);
        if (body.rateBps !== undefined) counterOffer.rateBps = Number(body.rateBps);
        const result = await lendingAgent.negotiate(body.borrower, counterOffer);
        return json(res, 200, { success: true, result });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/agent/lending/execute' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        if (!body?.borrower) throw new Error('Missing "borrower" field');
        const scoreResult = await creditAgent.scoreBorrower(body.borrower, {
          forceFresh: Boolean(body.forceFresh),
        });
        const result = await lendingAgent.executeLoan(body.borrower, {
          loanId: body.loanId,
          skipCollateral: Boolean(body.skipCollateral),
        });
        let historyTxHash = null;
        let historyError = null;
        if (result?.onChainConfirmed && result?.offer?.principal) {
          try {
            historyTxHash = await submitCreditHistoryEvent(
              services.walletService,
              'issued',
              body.borrower,
              Math.ceil(Number(result.offer.principal) * TOKEN_DECIMALS),
            );
          } catch (error) {
            historyError = error.message;
          }
          await services.poolHistory?.capture({
            eventType: 'loan_issued',
            eventLabel: 'Loan issued',
            eventAmount: Number(result.offer.principal),
            loanId: result.loanId || body.loanId || null,
            txHash:
              result?.steps?.disburse?.result?.txHash ||
              result?.steps?.disburse?.result?.tx_hash ||
              historyTxHash ||
              null,
          });
        }
        return json(res, 200, { success: true, scoreResult, result, historyTxHash, historyError });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/agent/credit/record-repaid' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        if (!body?.borrower) throw new Error('Missing "borrower" field');
        const amountRaw = Number(body.amountRaw ?? body.amount ?? 0);
        if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
          throw new Error('Missing or invalid "amountRaw" field');
        }
        const txHash = await submitCreditHistoryEvent(
          services.walletService,
          'repaid',
          body.borrower,
          amountRaw,
        );
        await services.poolHistory?.capture({
          eventType: 'loan_repaid',
          eventLabel: 'Loan repaid',
          eventAmount: Number(amountRaw) / TOKEN_DECIMALS,
          txHash,
          borrower: body.borrower,
        });
        return json(res, 200, { success: true, txHash });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/agent/lending/prepare-execution' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        if (!body?.borrower) throw new Error('Missing "borrower" field');
        const result = await buildExecutionPrep(services, body.borrower);
        return json(res, 200, { success: true, result });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/demo/run' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        const request = parseLoanRequest(body);
        const scoreResult = await creditAgent.scoreBorrower(request.borrower, {
          forceFresh: Boolean(body.forceFresh),
        });
        const evaluation = await lendingAgent.evaluateLoan(
          request.borrower,
          request.amountUsd,
          request.durationDays,
        );
        const execution = String(evaluation.status || '').startsWith('DENIED')
          ? null
          : await lendingAgent.executeLoan(request.borrower);
        let historyTxHash = null;
        let historyError = null;
        if (execution?.onChainConfirmed && execution?.offer?.principal) {
          try {
            historyTxHash = await submitCreditHistoryEvent(
              services.walletService,
              'issued',
              request.borrower,
              Math.ceil(Number(execution.offer.principal) * TOKEN_DECIMALS),
            );
          } catch (error) {
            historyError = error.message;
          }
          await services.poolHistory?.capture({
            eventType: 'loan_issued',
            eventLabel: 'Loan issued',
            eventAmount: Number(execution.offer.principal),
            loanId: execution.loanId || null,
            txHash:
              execution?.steps?.disburse?.result?.txHash ||
              execution?.steps?.disburse?.result?.tx_hash ||
              historyTxHash ||
              null,
          });
        }
        return json(res, 200, {
          success: true,
          scoreResult,
          evaluation,
          execution,
          historyTxHash,
          historyError,
          steps: formatDemoSteps(scoreResult, evaluation, execution),
        });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/audit' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const count = Number.parseInt(url.searchParams.get('count') || '50', 10);
      return json(res, 200, { entries: combineAuditEntries(services, count) });
    }

    return json(res, 404, { error: 'Endpoint not found', status: 404 });
  });

  return { server, sse };
}

export async function startServer(config = {}) {
  const services = config.services || await createServices(config);
  const host = config.host || DEFAULT_HOST;
  const port = config.port || DEFAULT_PORT;
  const allowedOrigins = resolveAllowedOrigins(config, host);
  if ((host === '0.0.0.0' || host === '::') && allowedOrigins.length === 0) {
    throw new Error('MCP_CORS_ORIGINS or MCP_ALLOWED_ORIGINS is required when exposing the MCP server beyond localhost');
  }

  const { server, sse } = createHttpServer(services, { host, port, allowedOrigins });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  let closing = false;
  const shutdown = (signal = 'SIGTERM') => {
    if (closing) return;
    closing = true;
    sse.broadcast('shutdown', { signal, reason: 'server stopping' });
    sse.drainAll();
    const forceTimer = setTimeout(() => process.exit(1), 5000);
    server.close(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  };

  if (!config.disableSignalHandlers) {
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  return {
    server,
    services,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => {
      sse.drainAll();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  startServer()
    .then(({ url, services }) => {
      const authEnabled = services.auth !== null && services.auth !== undefined;
      console.log(`[mcp] listening on ${url}`);
      console.log(`[mcp] auth: ${authEnabled ? 'enabled' : 'disabled (localhost mode)'}`);
      console.log(`[mcp] sse: ${url}/mcp`);
      console.log(`[mcp] auth token: ${url}/auth/token`);
      console.log(`[mcp] health: ${url}/health`);
    })
    .catch((error) => {
      console.error('[mcp] failed to start:', error);
      process.exit(1);
    });
}
