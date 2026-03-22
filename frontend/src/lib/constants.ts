import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  creditOracle: new PublicKey(import.meta.env.VITE_CREDIT_ORACLE_ID || '4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE'),
  lendingPool: new PublicKey(import.meta.env.VITE_LENDING_POOL_ID || '8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid'),
  agentPerms: new PublicKey(import.meta.env.VITE_AGENT_PERMS_ID || '57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG'),
};

export const ML_API_URL = import.meta.env.VITE_ML_API_URL || 'http://localhost:5001';
export const MCP_API_URL = import.meta.env.VITE_MCP_API_URL || 'http://localhost:3100';

// ─── Types ───────────────────────────
export interface AgentInfo {
  id: string; name: string; role: string; tier: number;
  status: 'active' | 'idle' | 'paused' | 'error' | 'uninitialized';
  balance: string; opsToday: number; limitUsedPct: number;
  lastAction: string; color: string; icon: string;
  walletAddress?: string | null;
}

export interface CreditResult {
  address: string; score: number; risk_tier: string; risk_tier_num: number;
  confidence: number; default_probability: number; model_hash: string;
  starter_eligible?: boolean;
  lending_path?: 'standard' | 'starter';
  zk_proof_hash?: string;
  zk_proof_status?: 'stub' | 'verified' | 'missing';
  zk_proof_scheme?: string;
  zk_proof?: {
    scheme: string;
    statement_hash: string;
    features_hash: string;
    commitment: string;
    announcement: string;
    response_w: string;
    response_r: string;
    proof_hash: string;
  };
  extraction_mode?: string;
  recommended_terms: { max_ltv_bps: number; rate_bps: number; max_loan_usd: number; max_duration_days: number };
  components: Record<string, number>;
  features: Record<string, number>;
}

export interface Loan {
  id: number; borrower: string; principal: number; rateBps: number;
  dueDate: string; repaid: number; status: 'Active' | 'Repaid' | 'Defaulted';
  escrowStatus: 'Locked' | 'Released' | 'Liquidated';
  paidInstallments: number; totalInstallments: number; installmentAmount: number;
  accountPubkey?: string;
  poolPubkey?: string;
  escrowPubkey?: string;
  collateralMint?: string;
  outstandingEstimate?: number;
}

export interface PoolState {
  totalDeposited: number; totalBorrowed: number; utilization: number;
  interestEarned: number; activeLoans: number; defaultRate: number;
  baseRateBps: number;
  history?: Array<{
    timestamp: string;
    deposited: number;
    borrowed: number;
    utilization: number;
    interestEarned: number;
  }>;
  source?: 'demo' | 'onchain';
}

export interface ServiceStatus {
  name: string;
  state: 'online' | 'offline';
  detail: string;
}

export interface IntegrationGap {
  key: string;
  title: string;
  status: 'ready' | 'pending' | 'blocked';
  detail: string;
}

export interface Decision {
  action: string; agent: string; status: 'success' | 'error' | 'pending';
  timestamp: string; summary: string; txHash?: string; decisionHash?: string;
}

export interface ChatMessage { role: 'agent' | 'user'; text: string; ts?: number; }

// ─── Tier badge colors ───────────────
export const TIER_COLORS: Record<string, string> = {
  AAA: '#14c972', AA: '#3b82f6', A: '#f59e0b', BB: '#f97316', C: '#ef4444',
};

// ─── Mock data for demo rendering ────
export const MOCK_AGENTS: AgentInfo[] = [
  { id: 'credit-agent', name: 'Credit Agent', role: 'Oracle', tier: 1, status: 'active', balance: '4.21', opsToday: 23, limitUsedPct: 12, lastAction: 'Scored DRpb…21hy → 720 (AA)', color: '#a78bfa', icon: 'brain' },
  { id: 'lending-agent', name: 'Lending Agent', role: 'Lending', tier: 2, status: 'active', balance: '2.85', opsToday: 8, limitUsedPct: 34, lastAction: 'Disbursed 3,000 USDT → 0xB3f2…', color: '#14c972', icon: 'banknote' },
  { id: 'collection-agent', name: 'Collection Agent', role: 'Collection', tier: 1, status: 'active', balance: '1.50', opsToday: 15, limitUsedPct: 5, lastAction: 'Pulled installment 3/6 loan #42', color: '#f59e0b', icon: 'clock' },
  { id: 'yield-agent', name: 'Yield Agent', role: 'Yield', tier: 2, status: 'idle', balance: '0.92', opsToday: 2, limitUsedPct: 1, lastAction: 'Pool rate adjusted to 6.8%', color: '#3b82f6', icon: 'trending-up' },
];

export const MOCK_LOANS: Loan[] = [
  { id: 42, borrower: 'DRpbCBMx…21hy', principal: 3000, rateBps: 650, dueDate: '2026-05-18', repaid: 1500, status: 'Active', escrowStatus: 'Locked', paidInstallments: 3, totalInstallments: 6, installmentAmount: 500 },
  { id: 41, borrower: '7nYB5K6q…9mPz', principal: 1000, rateBps: 1000, dueDate: '2026-04-20', repaid: 1050, status: 'Repaid', escrowStatus: 'Released', paidInstallments: 4, totalInstallments: 4, installmentAmount: 250 },
  { id: 39, borrower: 'Bx9K3mRt…4pQw', principal: 500, rateBps: 1500, dueDate: '2026-04-08', repaid: 83, status: 'Defaulted', escrowStatus: 'Liquidated', paidInstallments: 1, totalInstallments: 6, installmentAmount: 83 },
];

export const MOCK_POOL: PoolState = {
  totalDeposited: 50000, totalBorrowed: 12000, utilization: 24,
  interestEarned: 340, activeLoans: 3, defaultRate: 1.2, baseRateBps: 650,
  source: 'demo',
};

export const MOCK_POOL_HISTORY = Array.from({ length: 30 }, (_, i) => ({
  date: `Mar ${i + 1}`, deposited: 40000 + Math.random() * 15000,
  borrowed: 8000 + Math.random() * 8000,
}));

export const MOCK_DECISIONS: Decision[] = [
  { action: 'Score updated', agent: 'Credit Agent', status: 'success', timestamp: '2 min ago', summary: 'DRpb… scored 720 (AA tier, 89% confidence)', txHash: '3xJ4kB…mN7p', decisionHash: '7a8b9c…' },
  { action: 'Loan disbursed', agent: 'Lending Agent', status: 'success', timestamp: '5 min ago', summary: '4 gates passed → 3,000 USDT disbursed', txHash: '5dE2fR…qP8s', decisionHash: '4d5e6f…' },
  { action: 'Installment pulled', agent: 'Collection Agent', status: 'success', timestamp: '1 hr ago', summary: 'Installment 3/6: 500 USDT auto-pulled via delegate', txHash: '9gH1jK…wX3z' },
  { action: 'Limit rejected', agent: 'Lending Agent', status: 'error', timestamp: '2 hr ago', summary: 'Daily limit: 8,500 + 2,000 = 10,500 > 10,000 cap' },
  { action: 'ZK proof verified', agent: 'Credit Agent', status: 'success', timestamp: '3 hr ago', summary: 'Score privacy proof validated (SHA-256 stub)', decisionHash: 'bb12cc…' },
];

export const LIVE_AGENTS: Omit<AgentInfo, 'status' | 'balance' | 'opsToday' | 'limitUsedPct' | 'lastAction'>[] = [
  { id: 'credit-agent', name: 'Credit Agent', role: 'Oracle', tier: 1, color: '#a78bfa', icon: 'brain' },
  { id: 'lending-agent', name: 'Lending Agent', role: 'Lending', tier: 2, color: '#14c972', icon: 'banknote' },
  { id: 'collection-agent', name: 'Collection Agent', role: 'Collection', tier: 1, color: '#f59e0b', icon: 'clock' },
  { id: 'yield-agent', name: 'Yield Agent', role: 'Yield', tier: 2, color: '#3b82f6', icon: 'trending-up' },
];
