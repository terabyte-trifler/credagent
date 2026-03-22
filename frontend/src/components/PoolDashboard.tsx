import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { PoolState } from '../lib/constants';
import { MOCK_POOL_HISTORY } from '../lib/constants';

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

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-3 py-2 text-xs shadow-xl">
      <div className="text-gray-500 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-400 capitalize">{p.name}:</span>
          <span className="text-gray-200 font-semibold">${Math.round(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function PoolDashboard({ pool }: { pool: PoolState }) {
  const metrics = [
    { label: 'Total deposited', value: `$${pool.totalDeposited.toLocaleString()}` },
    { label: 'Total borrowed', value: `$${pool.totalBorrowed.toLocaleString()}` },
    { label: 'Interest earned', value: `$${pool.interestEarned.toLocaleString()}` },
    { label: 'Active loans', value: String(pool.activeLoans) },
    { label: 'Base rate', value: `${(pool.baseRateBps / 100).toFixed(1)}%` },
    { label: 'Default rate', value: `${pool.defaultRate}%` },
  ];

  return (
    <div className="glass p-6">
      <h2 className="text-base font-semibold text-gray-100 mb-4">Pool analytics</h2>

      {pool.source === 'demo' && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-300">
          Pool totals and chart history are still synthetic until live LendingPool reads or an indexed metrics API are connected.
        </div>
      )}

      {/* Utilization hero */}
      <div className="rounded-xl bg-surface-2/60 p-4 mb-4">
        <div className="flex items-end justify-between mb-1">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Pool utilization</span>
          <span className="text-2xl font-bold text-gray-100">{pool.utilization}%</span>
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

      {/* Area chart */}
      <div className="text-xs text-gray-500 font-medium mb-2">Deposits vs borrows (30d)</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={MOCK_POOL_HISTORY} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gDeposited" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14c972" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#14c972" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gBorrowed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#4b5563' }} axisLine={false} tickLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="deposited" stroke="#14c972" fill="url(#gDeposited)" strokeWidth={2} />
          <Area type="monotone" dataKey="borrowed" stroke="#3b82f6" fill="url(#gBorrowed)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
