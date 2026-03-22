// ═══════════════════════════════════════════
// hooks/useCredAgent.ts — Program interaction hooks
// ═══════════════════════════════════════════

import { useState, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  MCP_API_URL,
  ML_API_URL,
  LIVE_AGENTS,
  PROGRAM_IDS,
  type AgentInfo,
  type CreditResult,
  type Decision,
  type IntegrationGap,
  type Loan,
  type PoolState,
  type ServiceStatus,
} from '../lib/constants';

/** Fetch credit score from ML API */
export function useCreditScore() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const score = useCallback(async (address: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${ML_API_URL}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { score, result, loading, error, reset: () => { setResult(null); setError(null); } };
}

/** Fetch pool state. Falls back to clearly labeled demo data when no live source exists. */
export function usePoolState() {
  const { connection } = useConnection();
  const [pool, setPool] = useState<PoolState | null>(null);

  const refresh = useCallback(async () => {
    // TODO: replace with PoolState PDA deserialization once the client SDK exists.
    // Until then, expose demo data explicitly so the UI cannot be mistaken for
    // a live protocol monitor.
    setPool({
      totalDeposited: 50000, totalBorrowed: 12000, utilization: 24,
      interestEarned: 340, activeLoans: 3, defaultRate: 1.2, baseRateBps: 650,
      source: 'demo',
    });
  }, [connection]);

  return { pool, refresh };
}

const LOAN_DISCRIMINATOR = Uint8Array.from([20, 195, 70, 117, 165, 227, 182, 1]);
const SCHEDULE_DISCRIMINATOR = Uint8Array.from([98, 13, 81, 29, 86, 156, 104, 172]);

function matchesDiscriminator(data: Uint8Array, discriminator: Uint8Array) {
  if (data.length < discriminator.length) return false;
  return discriminator.every((byte, index) => data[index] === byte);
}

function readPubkey(data: Uint8Array, offset: number) {
  return new PublicKey(data.slice(offset, offset + 32));
}

function readU64(data: Uint8Array, offset: number) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return Number(view.getBigUint64(0, true));
}

function readI64(data: Uint8Array, offset: number) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return Number(view.getBigInt64(0, true));
}

function readU16(data: Uint8Array, offset: number) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 2);
  return view.getUint16(0, true);
}

function statusLabel(code: number) {
  switch (code) {
    case 0: return 'Active' as const;
    case 1: return 'Repaid' as const;
    case 2:
    case 3:
      return 'Defaulted' as const;
    default:
      return 'Active' as const;
  }
}

function escrowStatusLabel(status: Loan['status'], dueDateMs: number) {
  if (status === 'Repaid') return 'Released' as const;
  if (status === 'Defaulted') return 'Liquidated' as const;
  return dueDateMs < Date.now() ? 'Locked' as const : 'Locked' as const;
}

export function useLoanBook() {
  const { connection } = useConnection();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [loanAccounts, scheduleAccounts] = await Promise.all([
        connection.getProgramAccounts(PROGRAM_IDS.lendingPool, {
          commitment: 'confirmed',
        }),
        connection.getProgramAccounts(PROGRAM_IDS.lendingPool, {
          commitment: 'confirmed',
        }),
      ]);

      const schedules = new Map<number, { total: number; paid: number; amount: number }>();
      for (const account of scheduleAccounts) {
        const raw = account.account.data;
        const bytes = Uint8Array.from(raw as Uint8Array);
        if (!matchesDiscriminator(bytes, SCHEDULE_DISCRIMINATOR)) continue;
        const body = bytes.slice(8);
        const loanId = readU64(body, 0);
        schedules.set(loanId, {
          total: body[72],
          paid: body[73],
          amount: readU64(body, 74),
        });
      }

      const decoded = loanAccounts
        .map((account) => {
          const raw = account.account.data;
          const bytes = Uint8Array.from(raw as Uint8Array);
          if (!matchesDiscriminator(bytes, LOAN_DISCRIMINATOR)) return null;
          const body = bytes.slice(8);
          const id = readU64(body, 0);
          const borrower = readPubkey(body, 40).toBase58();
          const principal = readU64(body, 104);
          const rateBps = readU16(body, 112);
          const dueDateSecs = readI64(body, 122);
          const repaid = readU64(body, 130);
          const status = statusLabel(body[138]);
          const schedule = schedules.get(id);

          return {
            id,
            borrower,
            principal,
            rateBps,
            dueDate: new Date(dueDateSecs * 1000).toISOString().slice(0, 10),
            repaid,
            status,
            escrowStatus: escrowStatusLabel(status, dueDateSecs * 1000),
            paidInstallments: schedule?.paid ?? 0,
            totalInstallments: schedule?.total ?? 0,
            installmentAmount: schedule?.amount ?? 0,
          } satisfies Loan;
        })
        .filter(Boolean) as Loan[];

      decoded.sort((a, b) => b.id - a.id);
      setLoans(decoded);
    } catch {
      setLoans([]);
    } finally {
      setLoaded(true);
    }
  }, [connection]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { loans, loaded, refresh };
}

export function useRuntimeStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const checks: Array<[string, string, (data: any) => string]> = [
        ['ML API', `${ML_API_URL}/health`, data => `${data.model_version || 'healthy'} · ${data.status}`],
        ['MCP Server', `${MCP_API_URL}/health`, data => `paused=${String(data.paused)} · breaker=${String(data.circuitBreaker)}`],
      ];

      const results = await Promise.all(
        checks.map(async ([name, url, format]) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(String(resp.status));
            const data = await resp.json();
            return { name, state: 'online' as const, detail: format(data) };
          } catch (err: any) {
            return { name, state: 'offline' as const, detail: err?.message || 'unreachable' };
          }
        }),
      );

      if (active) setServices(results);
    };

    load();
    const timer = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return { services };
}

export function useDecisionFeed() {
  const [decisions, setDecisions] = useState<Decision[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const resp = await fetch(`${MCP_API_URL}/audit`);
        if (!resp.ok) throw new Error(String(resp.status));
        const data = await resp.json();
        const mapped: Decision[] = (data.entries || []).slice().reverse().map((entry: any) => ({
          action: entry.action || entry.tool || 'Tool call',
          agent: entry.agentId || entry.agent_id || entry.clientId || 'system',
          status: entry.success === false ? 'error' : entry.blocked ? 'error' : 'success',
          timestamp: entry.timestamp || entry.ts || 'recent',
          summary: entry.summary || entry.error || entry.status || 'No summary available',
          txHash: entry.txHash || entry.tx_hash,
          decisionHash: entry.decisionHash || entry.decision_hash,
        }));
        if (active) setDecisions(mapped);
      } catch {
        if (active) setDecisions([]);
      }
    };

    load();
    const timer = window.setInterval(load, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return { decisions };
}

export function useAgentStatus() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const results = await Promise.all(
        LIVE_AGENTS.map(async base => {
          try {
            const resp = await fetch(`${MCP_API_URL}/mcp/call`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tool: 'get_balance', params: { agent_id: base.id } }),
            });
            const payload = await resp.json();

            if (!resp.ok || payload.success === false) {
              const message = payload.error || `HTTP ${resp.status}`;
              const uninitialized = /AGENT_NOT_FOUND|wallet/i.test(message);
              return {
                ...base,
                status: uninitialized ? 'uninitialized' : 'error',
                balance: '--',
                opsToday: 0,
                limitUsedPct: 0,
                lastAction: uninitialized ? 'Wallet not initialized in MCP yet' : message,
              } satisfies AgentInfo;
            }

            const lamports = BigInt(payload.result?.lamports || '0');
            const sol = Number(lamports) / 1_000_000_000;
            return {
              ...base,
              status: 'active',
              balance: sol.toFixed(2),
              opsToday: Number(payload.result?.opsToday || 0),
              limitUsedPct: Number(payload.result?.limitUsedPct || 0),
              lastAction: payload.result?.lastAction || 'Connected to MCP runtime',
            } satisfies AgentInfo;
          } catch (err: any) {
            return {
              ...base,
              status: 'error',
              balance: '--',
              opsToday: 0,
              limitUsedPct: 0,
              lastAction: err?.message || 'Unable to reach MCP server',
            } satisfies AgentInfo;
          }
        }),
      );

      if (active) setAgents(results);
    };

    load();
    const timer = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return { agents };
}

export function useIntegrationGaps(services: ServiceStatus[], agents: AgentInfo[], decisions: Decision[], loanBookLoaded: boolean) {
  const [gaps, setGaps] = useState<IntegrationGap[]>([]);

  useEffect(() => {
    const mcp = services.find(s => s.name === 'MCP Server');
    const ml = services.find(s => s.name === 'ML API');
    const liveAgents = agents.filter(a => a.status === 'active').length;

    setGaps([
      {
        key: 'credit-scoring',
        title: 'Live credit scoring',
        status: ml?.state === 'online' ? 'ready' : 'blocked',
        detail: ml?.state === 'online' ? 'ML API is live and can score real wallets.' : 'ML API must be online for live scoring.',
      },
      {
        key: 'agent-wallets',
        title: 'Agent wallet runtime',
        status: liveAgents > 0 ? 'ready' : mcp?.state === 'online' ? 'pending' : 'blocked',
        detail: liveAgents > 0 ? `${liveAgents}/4 agents reporting live balances.` : 'Initialize agent wallets in MCP to enable live balances and actions.',
      },
      {
        key: 'loan-book',
        title: 'Live loan book',
        status: loanBookLoaded ? 'ready' : 'pending',
        detail: loanBookLoaded
          ? 'Loan table is reading real Loan and InstallmentSchedule accounts from the lending program.'
          : 'Frontend is still loading the on-chain loan book.',
      },
      {
        key: 'pool-metrics',
        title: 'Pool analytics',
        status: 'pending',
        detail: 'Pool charts need LendingPool PDA reads or an indexed API instead of synthetic history.',
      },
      {
        key: 'decision-stream',
        title: 'Decision timeline',
        status: decisions.length > 0 ? 'ready' : 'pending',
        detail: decisions.length > 0 ? 'MCP audit feed is populating decisions.' : 'No audit events yet; timeline will fill as tools run.',
      },
    ]);
  }, [services, agents, decisions]);

  return { gaps };
}

/** Demo step runner — explicitly simulates the golden-path lifecycle for UI previews. */
export function useDemoRunner() {
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const STEPS = [
    { label: '[Demo] Scoring borrower via ML API…', duration: 1200 },
    { label: '[Demo] Score: 720 (AA tier, 89% confidence)', duration: 800 },
    { label: '[Demo] Locking 1.5 XAUT collateral in escrow PDA…', duration: 1000 },
    { label: '[Demo] Escrow locked ✓ — PDA-owned vault', duration: 600 },
    { label: '[Demo] Conditional disbursement — checking 4 gates…', duration: 1400 },
    { label: '[Demo] ✓ Score valid  ✓ Escrow locked  ✓ Util OK  ✓ Agent auth', duration: 800 },
    { label: '[Demo] Disbursed 3,000 USDT to borrower', duration: 600 },
    { label: '[Demo] Creating 6-installment repayment schedule…', duration: 800 },
    { label: '[Demo] Pulling installment 1/6: 500 USDT via delegate…', duration: 1000 },
    { label: '[Demo] Borrower repays remaining balance…', duration: 800 },
    { label: '[Demo] Loan fully repaid — releasing collateral…', duration: 1000 },
    { label: '[Demo] 1.5 XAUT returned to borrower. Lifecycle complete ✓', duration: 0 },
  ];

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    setCurrentStep(0);
    for (let i = 0; i < STEPS.length; i++) {
      setCurrentStep(i);
      setLog(prev => [...prev, STEPS[i].label]);
      if (STEPS[i].duration > 0) {
        await new Promise(r => setTimeout(r, STEPS[i].duration));
      }
    }
    setRunning(false);
  }, [running]);

  return { run, running, currentStep, log, totalSteps: STEPS.length };
}
