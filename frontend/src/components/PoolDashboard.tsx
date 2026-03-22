import React, { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LiquidityPosition, Loan, PoolState } from '../lib/constants';

const METRIC_COLORS: Record<string, string> = {
  'Total deposited': '#14c972',
  'Total borrowed': '#3b82f6',
  'Utilization': '#f59e0b',
  'Interest earned': '#a78bfa',
  'Active loans': '#14c972',
  'Default rate': '#ef4444',
};

function UtilBar({ pct }: { pct: number }) {
  const color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#14c972';
  return (
    <div className="w-full h-2 rounded-full bg-surface-3 overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value > 0 && value < 10 ? 2 : 0,
  }).format(value);
}

function formatHistoryDay(value: string) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatIssueTimestamp(value?: string) {
  if (!value) return 'Unknown issue time';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function dayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export default function PoolDashboard({
  pool,
  loans = [],
  connectedWallet,
  liquidityPosition,
  onDeposit,
  depositing = false,
  depositError = null,
}: {
  pool: PoolState;
  loans?: Loan[];
  connectedWallet?: string | null;
  liquidityPosition?: LiquidityPosition | null;
  onDeposit?: (amountUi: number) => Promise<void> | void;
  depositing?: boolean;
  depositError?: string | null;
}) {
  const [depositAmount, setDepositAmount] = useState('250');
  const history = pool.history || [];
  const activeLoans = loans.filter((loan) => loan.status === 'Active');
  const groupedHistory = Array.from(
    history.reduce((map, point) => {
      const key = dayKey(point.timestamp);
      const existing = map.get(key) || {
        timestamp: point.timestamp,
        dayLabel: formatHistoryDay(point.timestamp),
        deposited: point.deposited,
        borrowed: point.borrowed,
        utilization: point.utilization,
        interestEarned: point.interestEarned,
        eventCount: 0,
        eventVolume: 0,
        lastEventLabel: null as string | null,
      };
      existing.timestamp = point.timestamp;
      existing.deposited = point.deposited;
      existing.borrowed = point.borrowed;
      existing.utilization = point.utilization;
      existing.interestEarned = point.interestEarned;
      if (point.eventType && point.eventType !== 'snapshot' && (point.eventAmount || 0) > 0) {
        existing.eventCount += 1;
        existing.eventVolume += point.eventAmount || 0;
        existing.lastEventLabel = point.eventLabel || point.eventType;
      }
      map.set(key, existing);
      return map;
    }, new Map<string, {
      timestamp: string;
      dayLabel: string;
      deposited: number;
      borrowed: number;
      utilization: number;
      interestEarned: number;
      eventCount: number;
      eventVolume: number;
      lastEventLabel: string | null;
    }>()).values(),
  );
  const historyData = groupedHistory.map((point) => ({
    time: point.dayLabel,
    deposited: point.deposited,
    borrowed: point.borrowed,
    eventCount: point.eventCount,
    eventVolume: point.eventVolume,
    lastEventLabel: point.lastEventLabel,
  }));
  const singleDayHistory = groupedHistory.length <= 1;
  const recentEvents = [...history]
    .filter((point) => point.eventType && point.eventType !== 'snapshot' && (point.eventAmount || 0) > 0)
    .slice(-4)
    .reverse();
  const issueEventByLoanId = new Map(
    history
      .filter((point) => point.eventType === 'loan_issued' && point.loanId != null)
      .map((point) => [point.loanId, point]),
  );
  const metrics = [
    { label: 'Total deposited', value: `$${formatUsd(pool.totalDeposited)}` },
    { label: 'Total borrowed', value: `$${formatUsd(pool.totalBorrowed)}` },
    { label: 'Interest earned', value: `$${formatUsd(pool.interestEarned)}` },
    { label: 'Active loans', value: String(pool.activeLoans) },
    { label: 'Base rate', value: `${(pool.baseRateBps / 100).toFixed(1)}%` },
    { label: 'Default rate', value: `${pool.defaultRate}%` },
  ];
  const hasWallet = Boolean(connectedWallet);
  const canDeposit = hasWallet && onDeposit;
  const suggestedDeposit = Math.min(500, Math.max(50, Math.floor((liquidityPosition?.walletBalance || 0) / 2)));

  return (
    <div className="glass overflow-hidden p-6 md:p-7">
      <h2 className="text-base font-semibold text-gray-100 mb-4">Pool analytics</h2>

      {pool.source !== 'onchain' && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-300">
          Pool totals are still synthetic. Connect live LendingPool reads to replace these values.
        </div>
      )}

      {pool.source === 'onchain' && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-300">
          Headline metrics are live from PoolState PDAs. Historical charting now uses MCP snapshot history collected from live pool state.
        </div>
      )}

      {/* Utilization hero */}
      <div className="metric-tile-strong mb-5">
        <div className="flex items-end justify-between mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Pool utilization</span>
          <span className="text-3xl font-bold text-gray-100">{pool.utilization.toFixed(2)}%</span>
        </div>
        <UtilBar pct={pool.utilization} />
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>0%</span><span>40% kink</span><span>80% max</span><span>100%</span>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {metrics.map(m => (
          <div key={m.label} className="metric-tile min-h-[88px]">
            <div className="text-[9px] text-gray-600 uppercase tracking-widest">{m.label}</div>
            <div className="mt-2 text-base font-semibold"
              style={{ color: METRIC_COLORS[m.label] || '#d1d5db' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[24px] border border-white/[0.08] bg-surface-2/20 p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-400 font-medium">Provide liquidity (beta)</div>
              <div className="mt-1 text-[11px] text-gray-500">
                Deposit devnet USDT into the pool from your connected wallet. User withdrawals still need full LP share accounting on-chain.
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Est. pool APR</div>
              <div className="mt-1 text-lg font-semibold text-cred-300">
                {liquidityPosition?.estimatedApr?.toFixed(2) || '0.00'}%
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Wallet USDT</div>
              <div className="mt-2 text-base font-semibold text-white">
                ${formatUsd(liquidityPosition?.walletBalance || 0)}
              </div>
            </div>
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Observed deposited</div>
              <div className="mt-2 text-base font-semibold text-white">
                ${formatUsd(liquidityPosition?.supplied || 0)}
              </div>
            </div>
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Indicative share</div>
              <div className="mt-2 text-base font-semibold text-white">
                {(liquidityPosition?.sharePct || 0).toFixed(2)}%
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Deposit amount (USDT)</div>
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                inputMode="decimal"
                className="mt-2 w-full bg-transparent text-lg font-semibold text-white outline-none"
                placeholder="250"
              />
            </label>
            <button
              type="button"
              onClick={() => setDepositAmount(String(suggestedDeposit))}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-gray-300 transition hover:border-white/[0.14] hover:text-white"
            >
              Use suggested
            </button>
            <button
              type="button"
              disabled={!canDeposit || depositing}
              onClick={async () => {
                const amount = Number(depositAmount);
                if (!onDeposit || !Number.isFinite(amount) || amount <= 0) return;
                await onDeposit(amount);
              }}
              className="rounded-2xl bg-cred-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cred-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {depositing ? 'Depositing…' : hasWallet ? 'Deposit to pool (beta)' : 'Connect wallet'}
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Indicative yield earned</div>
              <div className="mt-2 text-base font-semibold text-white">
                ${formatUsd(liquidityPosition?.estimatedYield || 0)}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Estimated from your observed deposit activity and pool interest accrued so far. This is not yet a withdrawable LP share balance.
              </div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Connected LP wallet</div>
              <div className="mt-2 text-[12px] font-mono text-gray-300 break-all">
                {connectedWallet || 'Connect Phantom on devnet to supply liquidity.'}
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Deposits are live. Individual LP analytics here are estimates until the protocol mints and tracks explicit LP shares per user.
              </div>
            </div>
          </div>
          {depositError && (
            <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[11px] text-red-300">
              {depositError}
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-white/[0.08] bg-surface-2/20 p-4 md:p-5">
          <div className="text-xs text-gray-400 font-medium">Liquidity provider snapshot</div>
          <div className="mt-3 space-y-3">
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Pool coverage</div>
              <div className="mt-2 text-base font-semibold text-white">
                ${(pool.totalDeposited - pool.totalBorrowed).toLocaleString()} idle liquidity
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Available to fund new loans before utilization becomes constrained.
              </div>
            </div>
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Borrower demand</div>
              <div className="mt-2 text-base font-semibold text-white">
                ${formatUsd(pool.totalBorrowed)} deployed across {pool.activeLoans} live loans
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                Depositors earn when borrowers draw liquidity and repay with interest.
              </div>
            </div>
            <div className="metric-tile p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">Withdrawals</div>
              <div className="mt-2 text-base font-semibold text-white">Operator-routed today</div>
              <div className="mt-1 text-[11px] text-gray-500">
                The current program supports user deposits, while end-user withdrawal accounting is still evolving toward full LP share tracking.
              </div>
            </div>
          </div>
        </div>
      </div>

      {history.length > 0 ? (
        <div className="rounded-[24px] border border-white/[0.08] bg-surface-2/20 p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-gray-400 font-medium">Historical pool chart</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-600">
              {singleDayHistory ? 'Today view' : 'Daily summary'}
            </div>
          </div>
          {singleDayHistory && (
            <div className="mb-4 rounded-2xl border border-sky-500/15 bg-sky-500/10 px-4 py-3 text-[11px] text-sky-200">
              All recorded pool history is currently on {groupedHistory[0]?.dayLabel || 'today'}. The chart shows the current day summary, and the detailed loan activity cards below show when loans were issued and for how much.
            </div>
          )}
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="depositedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14c972" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#14c972" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="borrowedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#101418', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}
                  labelStyle={{ color: '#e5e7eb' }}
                  formatter={(value: number, name: string) => [`$${formatUsd(value)}`, name === 'deposited' ? 'Deposited' : 'Borrowed']}
                  labelFormatter={(label, payload: any[]) => {
                    const point = payload?.[0]?.payload;
                    if (point?.eventCount) {
                      const eventText = `${point.eventCount} loan event${point.eventCount > 1 ? 's' : ''} · $${formatUsd(point.eventVolume || 0)}`;
                      return `${label} · ${eventText}`;
                    }
                    return label;
                  }}
                />
                <Area type="monotone" dataKey="deposited" stroke="#14c972" fill="url(#depositedGradient)" strokeWidth={2} />
                <Area type="monotone" dataKey="borrowed" stroke="#3b82f6" fill="url(#borrowedGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {recentEvents.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {recentEvents.map((event, index) => (
                <div key={`${event.timestamp}-${index}`} className="metric-tile p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold text-gray-200">
                      {event.eventLabel || event.eventType}
                    </div>
                    <div className="text-[11px] font-mono text-cred-300">
                      ${formatUsd(event.eventAmount || 0)}
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {formatHistoryDay(event.timestamp)}
                    {event.loanId ? ` · Loan #${event.loanId}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeLoans.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-gray-400">
                {singleDayHistory ? `${groupedHistory[0]?.dayLabel || 'Today'} loan activity` : 'Active loans on pool timeline'}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {activeLoans.map((loan) => {
                  const issueEvent = issueEventByLoanId.get(loan.id);
                  return (
                    <div key={loan.id} className="metric-tile p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-gray-200">Loan #{loan.id}</div>
                        <div className="text-[11px] font-mono text-sky-300">
                          ${formatUsd(issueEvent?.eventAmount ?? loan.principal)}
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] text-gray-500">
                        Issued {loan.issueTime ? formatIssueTimestamp(loan.issueTime) : issueEvent ? formatHistoryDay(issueEvent.timestamp) : 'before history tracking'}
                      </div>
                      <div className="mt-1 text-[10px] text-gray-500">
                        Due {formatHistoryDay(loan.dueDate)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-white/[0.08] bg-surface-2/20 p-4 md:p-5">
          <div className="text-xs text-gray-400 font-medium mb-1">Historical pool chart</div>
          <div className="text-sm text-gray-500">
            Waiting for enough live snapshots to render pool history.
          </div>
        </div>
      )}
    </div>
  );
}
