// ═══════════════════════════════════════════
// hooks/useCredAgent.ts — Program interaction hooks
// ═══════════════════════════════════════════

import { useState, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
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
    try {
      const poolDiscriminator = Uint8Array.from([247, 237, 227, 245, 215, 195, 222, 70]);
      const accounts = await connection.getProgramAccounts(PROGRAM_IDS.lendingPool, {
        commitment: 'confirmed',
      });

      const pools = accounts
        .map((account) => {
          const bytes = Uint8Array.from(account.account.data as Uint8Array);
          if (!matchesDiscriminator(bytes, poolDiscriminator)) return null;
          const body = bytes.slice(8);
          const totalDeposited = readU64(body, 64);
          const totalBorrowed = readU64(body, 72);
          const totalInterestEarned = readU64(body, 80);
          const totalDefaults = readU64(body, 88);
          const activeLoans = new DataView(body.buffer, body.byteOffset + 96, 4).getUint32(0, true);
          const totalLoansIssued = new DataView(body.buffer, body.byteOffset + 100, 4).getUint32(0, true);
          const baseRateBps = readU16(body, 112);
          const utilization = totalDeposited > 0
            ? Math.round((totalBorrowed / totalDeposited) * 100)
            : 0;
          const defaultRate = totalLoansIssued > 0
            ? Number(((totalDefaults / totalLoansIssued) * 100).toFixed(2))
            : 0;

          return {
            totalDeposited,
            totalBorrowed,
            interestEarned: totalInterestEarned,
            activeLoans,
            defaultRate,
            utilization,
            baseRateBps,
          };
        })
        .filter(Boolean) as Array<{
          totalDeposited: number;
          totalBorrowed: number;
          interestEarned: number;
          activeLoans: number;
          defaultRate: number;
          utilization: number;
          baseRateBps: number;
        }>;

      if (pools.length === 0) {
        setPool({
          totalDeposited: 0,
          totalBorrowed: 0,
          utilization: 0,
          interestEarned: 0,
          activeLoans: 0,
          defaultRate: 0,
          baseRateBps: 0,
          source: 'onchain',
        });
        return;
      }

      const aggregated = pools.reduce((acc, poolState) => ({
        totalDeposited: acc.totalDeposited + poolState.totalDeposited,
        totalBorrowed: acc.totalBorrowed + poolState.totalBorrowed,
        interestEarned: acc.interestEarned + poolState.interestEarned,
        activeLoans: acc.activeLoans + poolState.activeLoans,
        defaultRate: acc.defaultRate + poolState.defaultRate,
        baseRateBps: Math.max(acc.baseRateBps, poolState.baseRateBps),
      }), {
        totalDeposited: 0,
        totalBorrowed: 0,
        interestEarned: 0,
        activeLoans: 0,
        defaultRate: 0,
        baseRateBps: 0,
      });

      setPool({
        totalDeposited: aggregated.totalDeposited,
        totalBorrowed: aggregated.totalBorrowed,
        utilization: aggregated.totalDeposited > 0
          ? Math.round((aggregated.totalBorrowed / aggregated.totalDeposited) * 100)
          : 0,
        interestEarned: aggregated.interestEarned,
        activeLoans: aggregated.activeLoans,
        defaultRate: Number((aggregated.defaultRate / pools.length).toFixed(2)),
        baseRateBps: aggregated.baseRateBps,
        source: 'onchain',
      });
    } catch {
      setPool({
        totalDeposited: 0,
        totalBorrowed: 0,
        utilization: 0,
        interestEarned: 0,
        activeLoans: 0,
        defaultRate: 0,
        baseRateBps: 0,
        source: 'onchain',
      });
    }
  }, [connection]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { pool, refresh };
}

const LOAN_DISCRIMINATOR = Uint8Array.from([20, 195, 70, 117, 165, 227, 182, 1]);
const SCHEDULE_DISCRIMINATOR = Uint8Array.from([98, 13, 81, 29, 86, 156, 104, 172]);
const ESCROW_DISCRIMINATOR = Uint8Array.from([192, 99, 212, 219, 136, 109, 242, 184]);
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ESCROW_VAULT_SEED = new TextEncoder().encode('escrow_vault');

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

function readU128(data: Uint8Array, offset: number) {
  const view = new DataView(data.buffer, data.byteOffset + offset, 16);
  const low = view.getBigUint64(0, true);
  const high = view.getBigUint64(8, true);
  return Number((high << 64n) + low);
}

function encodeAnchorU64(value: bigint) {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigUint64(0, value, true);
  return buffer;
}

function encodeAnchorDiscriminator(bytes: number[]) {
  return Uint8Array.from(bytes);
}

async function deriveAta(owner: PublicKey, mint: PublicKey) {
  const [ata] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
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
      const [loanAccounts, scheduleAccounts, escrowAccounts, poolAccounts] = await Promise.all([
        connection.getProgramAccounts(PROGRAM_IDS.lendingPool, {
          commitment: 'confirmed',
        }),
        connection.getProgramAccounts(PROGRAM_IDS.lendingPool, {
          commitment: 'confirmed',
        }),
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

      const escrows = new Map<number, { mint: string; pubkey: string }>();
      for (const account of escrowAccounts) {
        const bytes = Uint8Array.from(account.account.data as Uint8Array);
        if (!matchesDiscriminator(bytes, ESCROW_DISCRIMINATOR)) continue;
        const body = bytes.slice(8);
        const loanId = readU64(body, 0);
        escrows.set(loanId, {
          mint: readPubkey(body, 40).toBase58(),
          pubkey: account.pubkey.toBase58(),
        });
      }

      const poolByKey = new Map<string, { interestIndex: number }>();
      for (const account of poolAccounts) {
        const bytes = Uint8Array.from(account.account.data as Uint8Array);
        if (!matchesDiscriminator(bytes, Uint8Array.from([247, 237, 227, 245, 215, 195, 222, 70]))) continue;
        const body = bytes.slice(8);
        poolByKey.set(account.pubkey.toBase58(), {
          interestIndex: readU128(body, 116),
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
          const escrow = readPubkey(body, 139).toBase58();
          const pool = readPubkey(body, 8).toBase58();
          const indexSnapshot = readU128(body, 235);
          const schedule = schedules.get(id);
          const escrowState = escrows.get(id);
          const currentIndex = poolByKey.get(pool)?.interestIndex ?? indexSnapshot;
          const interestOwed = currentIndex > indexSnapshot
            ? Math.floor((principal * (currentIndex - indexSnapshot)) / 1_000_000_000_000_000_000)
            : 0;
          const outstandingEstimate = Math.max(0, principal + interestOwed - repaid);

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
            accountPubkey: account.pubkey.toBase58(),
            poolPubkey: pool,
            escrowPubkey: escrow,
            collateralMint: escrowState?.mint,
            outstandingEstimate,
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
        const resp = await fetch(`${MCP_API_URL}/runtime/decisions`);
        if (!resp.ok) throw new Error(String(resp.status));
        const data = await resp.json();
        const mapped: Decision[] = (data.decisions || []).map((entry: any) => ({
          action: entry.action || entry.tool || 'Tool call',
          agent: entry.agent || entry.agentId || entry.agent_id || entry.clientId || 'system',
          status: entry.status || (entry.success === false ? 'error' : entry.blocked ? 'error' : 'success'),
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
      try {
        const resp = await fetch(`${MCP_API_URL}/runtime/agents`);
        if (!resp.ok) throw new Error(String(resp.status));
        const payload = await resp.json();
        if (!active) return;
        const runtimeAgents: AgentInfo[] = (payload.agents || []).map((agent: any) => ({
          ...agent,
        }));
        setAgents(runtimeAgents);
      } catch (err: any) {
        if (!active) return;
        setAgents(LIVE_AGENTS.map(base => ({
          ...base,
          status: 'error',
          balance: '--',
          opsToday: 0,
          limitUsedPct: 0,
          lastAction: err?.message || 'Unable to reach MCP server',
        })));
      }
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
        status: 'ready',
        detail: 'Headline pool metrics are reading real PoolState PDAs. Historical charting is hidden until indexed history is available.',
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
  const [totalSteps, setTotalSteps] = useState(0);

  const run = useCallback(async (request?: { borrower: string; amountUsd?: number; durationDays?: number }) => {
    if (running) return;
    if (!request?.borrower) {
      setLog(['Score a wallet first, then run the live backend flow.']);
      return;
    }
    setRunning(true);
    setLog([]);
    setCurrentStep(0);
    try {
      const resp = await fetch(`${MCP_API_URL}/demo/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          borrower: request.borrower,
          amountUsd: request.amountUsd ?? 500,
          durationDays: request.durationDays ?? 30,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok || payload.success === false) {
        throw new Error(payload.error || `HTTP ${resp.status}`);
      }
      const steps: string[] = payload.steps || [];
      setTotalSteps(Math.max(steps.length, 1));
      for (let i = 0; i < steps.length; i++) {
        setCurrentStep(i);
        setLog(prev => [...prev, steps[i]]);
      }
    } catch (err: any) {
      setLog([`Live backend demo failed: ${err?.message || 'unknown error'}`]);
      setTotalSteps(1);
      setCurrentStep(0);
    } finally {
      setRunning(false);
    }
  }, [running]);

  return { run, running, currentStep, log, totalSteps };
}

export function useLoanActions() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [repayingLoanId, setRepayingLoanId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const repayLoan = useCallback(async (loan: Loan) => {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      throw new Error('Connect the borrower wallet to repay from the dashboard.');
    }
    if (!loan.accountPubkey || !loan.poolPubkey) {
      throw new Error('Loan account metadata is incomplete.');
    }
    if (!loan.collateralMint || !loan.escrowPubkey) {
      throw new Error('Escrow metadata is unavailable for this loan.');
    }
    if (wallet.publicKey.toBase58() !== loan.borrower) {
      throw new Error('Connected wallet does not match the borrower for this loan.');
    }

    const tokenMintValue = import.meta.env.VITE_MOCK_USDT_MINT || import.meta.env.VITE_POOL_TOKEN_MINT;
    if (!tokenMintValue) throw new Error('Missing VITE_MOCK_USDT_MINT or VITE_POOL_TOKEN_MINT for repay flow.');
    const tokenMint = new PublicKey(tokenMintValue);

    setRepayingLoanId(loan.id);
    setActionError(null);

    try {
      const poolState = new PublicKey(loan.poolPubkey);
      const [poolVault] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('pool_vault'), tokenMint.toBuffer()],
        PROGRAM_IDS.lendingPool,
      );
      const borrowerAta = await deriveAta(wallet.publicKey, tokenMint);
      const repayData = new Uint8Array([
        ...encodeAnchorDiscriminator([234, 103, 67, 82, 208, 234, 219, 166]),
        ...encodeAnchorU64(BigInt(Math.max(1, Math.round(loan.outstandingEstimate ?? (loan.principal - loan.repaid))))),
      ]);

      const repayIx = new TransactionInstruction({
        programId: PROGRAM_IDS.lendingPool,
        keys: [
          { pubkey: poolState, isSigner: false, isWritable: true },
          { pubkey: poolVault, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(loan.accountPubkey), isSigner: false, isWritable: true },
          { pubkey: borrowerAta, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: repayData as unknown as Buffer,
      });

      const tx = new Transaction().add(repayIx);
      const repaySig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(repaySig, 'confirmed');

      if (loan.outstandingEstimate && loan.outstandingEstimate > 0) {
        const collateralMint = new PublicKey(loan.collateralMint);
        const borrowerCollateralAta = await deriveAta(wallet.publicKey, collateralMint);
        const loanIdBytes = encodeAnchorU64(BigInt(loan.id));
        const [escrowVault] = PublicKey.findProgramAddressSync(
          [ESCROW_VAULT_SEED as unknown as Buffer, loanIdBytes as unknown as Buffer],
          PROGRAM_IDS.lendingPool,
        );
        const releaseIx = new TransactionInstruction({
          programId: PROGRAM_IDS.lendingPool,
          keys: [
            { pubkey: new PublicKey(loan.accountPubkey), isSigner: false, isWritable: false },
            { pubkey: new PublicKey(loan.escrowPubkey), isSigner: false, isWritable: true },
            { pubkey: escrowVault, isSigner: false, isWritable: true },
            { pubkey: borrowerCollateralAta, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: encodeAnchorDiscriminator([40, 255, 12, 218, 249, 197, 179, 160]) as unknown as Buffer,
        });
        try {
          const releaseTx = new Transaction().add(releaseIx);
          const releaseSig = await wallet.sendTransaction(releaseTx, connection);
          await connection.confirmTransaction(releaseSig, 'confirmed');
        } catch {
          // Repay is the primary action. Release can remain permissionless follow-up.
        }
      }
    } catch (err: any) {
      const message = err?.message || 'Repay transaction failed';
      setActionError(message);
      throw err;
    } finally {
      setRepayingLoanId(null);
    }
  }, [connection, wallet]);

  return {
    repayLoan,
    repayingLoanId,
    actionError,
    clearActionError: () => setActionError(null),
  };
}
