import { PublicKey } from '@solana/web3.js';

export const PROGRAM_IDS = {
  creditOracle: new PublicKey(import.meta.env.VITE_CREDIT_ORACLE_ID || '4cDu7SCGMzs6etzjJTyUXNXSJ6eRz54cDikSngezabhE'),
  lendingPool: new PublicKey(import.meta.env.VITE_LENDING_POOL_ID || '8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid'),
  agentPerms: new PublicKey(import.meta.env.VITE_AGENT_PERMS_ID || '57uCTUNFStnMEkGLQT869Qdo5fo9EAqPsp5dn5QWQUqG'),
};

export const ML_API_URL = import.meta.env.VITE_ML_API_URL || 'http://localhost:5001';
export const MCP_API_URL = import.meta.env.VITE_MCP_API_URL || 'http://localhost:3100';
export const POOL_TOKEN_MINT = import.meta.env.VITE_MOCK_USDT_MINT
  || import.meta.env.VITE_POOL_TOKEN_MINT
  || '6kacrDqGEv9Jh5eNv86pZEASx4C3jcmnjc1CNWQHS8Ca';

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
  issueTime?: string;
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
    eventType?: string;
    eventLabel?: string;
    eventAmount?: number;
    loanId?: number | null;
    txHash?: string | null;
    borrower?: string;
  }>;
  source?: 'demo' | 'onchain';
}

export interface LiquidityPosition {
  wallet: string | null;
  walletBalance: number;
  supplied: number;
  sharePct: number;
  estimatedYield: number;
  estimatedApr: number;
  loading: boolean;
  tokenMint?: string;
  source: 'live' | 'unavailable';
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
  timestampMs?: number;
}

export interface ChatMessage { role: 'agent' | 'user'; text: string; ts?: number; }

// ─── Tier badge colors ───────────────
export const TIER_COLORS: Record<string, string> = {
  AAA: '#14c972', AA: '#3b82f6', A: '#f59e0b', BB: '#f97316', C: '#ef4444',
};

export const LIVE_AGENTS: Omit<AgentInfo, 'status' | 'balance' | 'opsToday' | 'limitUsedPct' | 'lastAction'>[] = [
  { id: 'credit-agent', name: 'Credit Agent', role: 'Oracle', tier: 1, color: '#a78bfa', icon: 'brain' },
  { id: 'lending-agent', name: 'Lending Agent', role: 'Lending', tier: 2, color: '#14c972', icon: 'banknote' },
  { id: 'collection-agent', name: 'Collection Agent', role: 'Collection', tier: 1, color: '#f59e0b', icon: 'clock' },
  { id: 'yield-agent', name: 'Yield Agent', role: 'Yield', tier: 2, color: '#3b82f6', icon: 'trending-up' },
];
