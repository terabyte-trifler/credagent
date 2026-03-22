import React from 'react';
import { Brain, Banknote, Clock, TrendingUp, Shield, type LucideIcon } from 'lucide-react';
import type { AgentInfo } from '../lib/constants';

const ICONS: Record<string, LucideIcon> = {
  brain: Brain, banknote: Banknote, clock: Clock, 'trending-up': TrendingUp,
};

const TIER_LABELS = ['Read', 'Operate', 'Manage', 'Admin'];

function AgentCard({ agent }: { agent: AgentInfo }) {
  const Icon = ICONS[agent.icon] || Shield;
  const active = agent.status === 'active';
  const paused = agent.status === 'paused';
  const errored = agent.status === 'error';
  const uninitialized = agent.status === 'uninitialized';
  const statusText = active
    ? 'Live'
    : paused
      ? 'Paused'
      : errored
        ? 'Error'
        : uninitialized
          ? 'Setup needed'
          : 'Idle';
  const dotClass = active
    ? 'bg-cred-500 animate-pulse-ring'
    : paused
      ? 'bg-amber-500'
      : errored
        ? 'bg-red-500'
        : uninitialized
          ? 'bg-blue-500'
          : 'bg-gray-600';
  const textClass = active
    ? 'text-cred-400'
    : paused
      ? 'text-amber-400'
      : errored
        ? 'text-red-400'
        : uninitialized
          ? 'text-blue-400'
          : 'text-gray-500';

  const hasTelemetry = agent.opsToday > 0 || agent.limitUsedPct > 0;

  return (
    <div className="glass p-5 hover:-translate-y-0.5 hover:border-white/[0.12] transition-all duration-300 group overflow-hidden">
      <div
        className="mb-4 h-[3px] w-full rounded-full opacity-80"
        style={{ background: `linear-gradient(90deg, ${agent.color}, transparent)` }}
      />
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ background: `${agent.color}1f`, color: agent.color, boxShadow: `inset 0 1px 0 ${agent.color}33` }}>
            <Icon size={18} strokeWidth={2.2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{agent.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{agent.role}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 font-mono">
                T{agent.tier}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span className={`text-[11px] font-medium ${textClass}`}>
            {statusText}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'Balance', value: `${agent.balance}`, unit: 'SOL' },
          { label: 'Authority', value: TIER_LABELS[agent.tier] || `T${agent.tier}`, unit: '' },
          { label: 'Telemetry', value: hasTelemetry ? 'Live' : 'Bootstrapped', unit: '' },
        ].map(m => (
          <div key={m.label} className="metric-tile p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-widest">{m.label}</div>
            <div className="text-sm font-semibold text-gray-200 mt-0.5">
              {m.value}{m.unit && <span className="text-[10px] text-gray-500 ml-0.5">{m.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {hasTelemetry && (
        <div className="mb-3">
          <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${agent.limitUsedPct}%`, backgroundColor: agent.color }} />
          </div>
        </div>
      )}

      <div className="text-[11px] text-gray-500 truncate">
        <span className="text-gray-600 mr-1">Last event:</span>{agent.lastAction}
      </div>
      {!hasTelemetry && (
        <div className="mt-2 text-[10px] text-gray-600">
          Spend counters and daily usage stay hidden until the runtime exposes richer per-agent telemetry.
        </div>
      )}
    </div>
  );
}

export default function AgentStatus({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 stagger-children">
      {agents.map(a => <AgentCard key={a.id} agent={a} />)}
    </div>
  );
}
