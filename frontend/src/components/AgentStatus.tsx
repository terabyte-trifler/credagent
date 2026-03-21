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

  return (
    <div className="glass p-5 hover:border-white/[0.08] transition-all duration-300 group">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ backgroundColor: agent.color + '18', color: agent.color }}>
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
          <span className={`w-2 h-2 rounded-full ${active ? 'bg-cred-500 animate-pulse-ring' : 'bg-gray-600'}`} />
          <span className={`text-[11px] font-medium ${active ? 'text-cred-400' : 'text-gray-500'}`}>
            {agent.status === 'active' ? 'Live' : agent.status === 'paused' ? 'Paused' : 'Idle'}
          </span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'Balance', value: `${agent.balance}`, unit: 'SOL' },
          { label: 'Ops today', value: String(agent.opsToday), unit: '' },
          { label: 'Limit', value: `${agent.limitUsedPct}%`, unit: '' },
        ].map(m => (
          <div key={m.label} className="rounded-lg bg-surface-2/60 p-2.5">
            <div className="text-[9px] text-gray-500 uppercase tracking-widest">{m.label}</div>
            <div className="text-sm font-semibold text-gray-200 mt-0.5">
              {m.value}{m.unit && <span className="text-[10px] text-gray-500 ml-0.5">{m.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Spending limit bar */}
      <div className="mb-3">
        <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${agent.limitUsedPct}%`, backgroundColor: agent.color }} />
        </div>
      </div>

      {/* Last action */}
      <div className="text-[11px] text-gray-500 truncate">
        <span className="text-gray-600 mr-1">Last:</span>{agent.lastAction}
      </div>
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
