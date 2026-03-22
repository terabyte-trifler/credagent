import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PoolState } from '../lib/constants';

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

export default function PoolDashboard({ pool }: { pool: PoolState }) {
  const history = pool.history || [];
  const metrics = [
    { label: 'Total deposited', value: `$${formatUsd(pool.totalDeposited)}` },
    { label: 'Total borrowed', value: `$${formatUsd(pool.totalBorrowed)}` },
    { label: 'Interest earned', value: `$${formatUsd(pool.interestEarned)}` },
    { label: 'Active loans', value: String(pool.activeLoans) },
    { label: 'Base rate', value: `${(pool.baseRateBps / 100).toFixed(1)}%` },
    { label: 'Default rate', value: `${pool.defaultRate}%` },
  ];

  return (
    <div className="glass p-6">
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
      <div className="rounded-xl bg-surface-2/60 p-4 mb-4">
        <div className="flex items-end justify-between mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Pool utilization</span>
          <span className="text-2xl font-bold text-gray-100">{pool.utilization.toFixed(2)}%</span>
        </div>
        <UtilBar pct={pool.utilization} />
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>0%</span><span>40% kink</span><span>80% max</span><span>100%</span>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
        {metrics.map(m => (
          <div key={m.label} className="rounded-lg bg-surface-2/40 p-2.5">
            <div className="text-[9px] text-gray-600 uppercase tracking-widest">{m.label}</div>
            <div className="text-sm font-semibold mt-0.5"
              style={{ color: METRIC_COLORS[m.label] || '#d1d5db' }}>
              {m.value}
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-surface-2/20 p-4">
          <div className="text-xs text-gray-400 font-medium mb-3">Historical pool chart</div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history.map((point) => ({
                time: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                deposited: point.deposited,
                borrowed: point.borrowed,
              }))}>
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
                  formatter={(value: number) => [`$${formatUsd(value)}`, '']}
                />
                <Area type="monotone" dataKey="deposited" stroke="#14c972" fill="url(#depositedGradient)" strokeWidth={2} />
                <Area type="monotone" dataKey="borrowed" stroke="#3b82f6" fill="url(#borrowedGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-surface-2/20 p-4">
          <div className="text-xs text-gray-400 font-medium mb-1">Historical pool chart</div>
          <div className="text-sm text-gray-500">
            Waiting for enough live snapshots to render pool history.
          </div>
        </div>
      )}
    </div>
  );
}
