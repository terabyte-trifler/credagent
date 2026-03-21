/**
 * Screen 1: Agent Status Dashboard
 * Shows 4 agent cards with live status, wallet balance, last action, uptime.
 *
 * DESIGN: Matches shadcn/ui card pattern. Teal accent for active, gray for idle.
 */
import React, { useState, useEffect } from 'react';
import { Activity, Shield, TrendingUp, Clock } from 'lucide-react';

const AGENTS = [
  { id: 'credit-agent', name: 'Credit Agent', role: 'Oracle', icon: Activity, color: '#6C5CE7',
    desc: 'Scores borrowers using XGBoost ML model + 14 on-chain features' },
  { id: 'lending-agent', name: 'Lending Agent', role: 'Lending', icon: TrendingUp, color: '#1ABC9C',
    desc: 'Approves loans, negotiates terms, triggers conditional disbursement' },
  { id: 'collection-agent', name: 'Collection Agent', role: 'Collection', icon: Clock, color: '#F39C12',
    desc: 'Schedules installments, auto-pulls payments, manages defaults' },
  { id: 'yield-agent', name: 'Yield Agent', role: 'Yield', icon: Shield, color: '#3498DB',
    desc: 'Reallocates capital, adjusts rates, bridges tokens cross-chain' },
];

export default function AgentStatus({ agentData = {} }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {AGENTS.map(agent => {
        const data = agentData[agent.id] || {};
        const isActive = data.status === 'active';

        return (
          <div key={agent.id}
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5 transition-shadow hover:shadow-md">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: agent.color + '18', color: agent.color }}>
                  <agent.icon size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">{agent.name}</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{agent.role} role</span>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                {isActive ? 'Active' : 'Idle'}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">{agent.desc}</p>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Balance</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {data.balance || '—'} <span className="text-xs font-normal text-gray-400">SOL</span>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Ops today</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {data.opsToday ?? '—'}
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">Limit used</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {data.limitUsedPct ?? '—'}%
                </div>
              </div>
            </div>

            {/* Last action */}
            {data.lastAction && (
              <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 truncate">
                Last: {data.lastAction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
