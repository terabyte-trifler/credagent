// ═══════════════════════════════════════════
// Screen 3: LoanManager
// Active loans table with escrow status + installment progress
// ═══════════════════════════════════════════
import React, { useState } from 'react';
import { FileText, Lock, Unlock, AlertTriangle } from 'lucide-react';

const STATUS_STYLES = {
  Active: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Repaid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Defaulted: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};
const ESCROW_ICONS = { Locked: Lock, Released: Unlock, Liquidated: AlertTriangle };

export function LoanManager({ loans = [] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">Active loans</h2>
        <span className="text-xs text-gray-400">{loans.length} loans</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              {['ID','Borrower','Principal','Rate','Due','Repaid','Escrow','Installments','Status'].map(h =>
                <th key={h} className="text-left py-2 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loans.map(loan => {
              const EscIcon = ESCROW_ICONS[loan.escrowStatus] || Lock;
              const paidPct = loan.totalInstallments > 0
                ? Math.round((loan.paidInstallments / loan.totalInstallments) * 100) : 0;
              return (
                <tr key={loan.id} className="border-b border-gray-50 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <td className="py-3 px-2 font-mono text-xs">#{loan.id}</td>
                  <td className="py-3 px-2 font-mono text-xs">{loan.borrower?.slice(0,8)}...</td>
                  <td className="py-3 px-2 font-semibold">${loan.principal?.toLocaleString()}</td>
                  <td className="py-3 px-2">{(loan.rateBps / 100).toFixed(1)}%</td>
                  <td className="py-3 px-2 text-xs">{loan.dueDate}</td>
                  <td className="py-3 px-2">${loan.repaid?.toLocaleString()}</td>
                  <td className="py-3 px-2"><EscIcon size={14} className="inline mr-1" />{loan.escrowStatus}</td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden">
                        <div className="h-full bg-teal-500 rounded" style={{ width: `${paidPct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{loan.paidInstallments}/{loan.totalInstallments}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[loan.status] || ''}`}>
                      {loan.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {loans.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400 text-sm">No active loans</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Screen 4: PoolDashboard
// TVL, utilization %, interest earned, default rate
// ═══════════════════════════════════════════
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function PoolDashboard({ pool = {}, history = [] }) {
  const metrics = [
    { label: 'Total deposited', value: `$${(pool.totalDeposited || 0).toLocaleString()}`, color: '#1ABC9C' },
    { label: 'Total borrowed', value: `$${(pool.totalBorrowed || 0).toLocaleString()}`, color: '#3498DB' },
    { label: 'Utilization', value: `${pool.utilization || 0}%`, color: pool.utilization > 80 ? '#E74C3C' : '#F39C12' },
    { label: 'Interest earned', value: `$${(pool.interestEarned || 0).toLocaleString()}`, color: '#6C5CE7' },
    { label: 'Active loans', value: pool.activeLoans || 0, color: '#1ABC9C' },
    { label: 'Default rate', value: `${pool.defaultRate || 0}%`, color: pool.defaultRate > 5 ? '#E74C3C' : '#27AE60' },
  ];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6">
      <h2 className="font-semibold text-lg mb-4 text-gray-900 dark:text-gray-100">Pool dashboard</h2>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {metrics.map(m => (
          <div key={m.label} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{m.label}</div>
            <div className="text-lg font-bold" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={history}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="deposited" stroke="#1ABC9C" fill="#1ABC9C" fillOpacity={0.1} />
            <Area type="monotone" dataKey="borrowed" stroke="#3498DB" fill="#3498DB" fillOpacity={0.1} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Screen 5: NegotiationChat
// LLM-powered loan term negotiation between borrower + lending agent
// ═══════════════════════════════════════════
import { Send, Bot, User } from 'lucide-react';

export function NegotiationChat({ messages = [], onSend, loanTerms = null }) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    onSend?.(input);
    setInput('');
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col" style={{ height: 480 }}>
      <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Loan negotiation</h2>
        {loanTerms && (
          <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">
            {loanTerms.rateBps / 100}% APR · {loanTerms.durationDays}d · {loanTerms.collateral}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'agent' ? '' : 'flex-row-reverse'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
              msg.role === 'agent' ? 'bg-teal-100 dark:bg-teal-900/40' : 'bg-gray-100 dark:bg-gray-800'
            }`}>
              {msg.role === 'agent' ? <Bot size={14} className="text-teal-600" /> : <User size={14} className="text-gray-500" />}
            </div>
            <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
              msg.role === 'agent'
                ? 'bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200'
                : 'bg-teal-600 text-white'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type your offer or response..."
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-teal-500" />
        <button onClick={handleSend}
          className="px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Screen 6: DecisionLog
// Timeline of agent decisions with reasoning hashes
// ═══════════════════════════════════════════
import { CheckCircle, XCircle, Clock as ClockIcon, ExternalLink } from 'lucide-react';

const DECISION_ICONS = { success: CheckCircle, error: XCircle, pending: ClockIcon };
const DECISION_COLORS = {
  success: 'text-emerald-500', error: 'text-red-500', pending: 'text-amber-500',
};

export function DecisionLog({ decisions = [] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6">
      <h2 className="font-semibold text-lg mb-4 text-gray-900 dark:text-gray-100">Agent decision log</h2>
      <div className="space-y-3">
        {decisions.map((d, i) => {
          const Icon = DECISION_ICONS[d.status] || ClockIcon;
          return (
            <div key={i} className="flex gap-3 items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
              <Icon size={16} className={`mt-0.5 flex-shrink-0 ${DECISION_COLORS[d.status] || ''}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{d.action}</span>
                  <span className="text-xs text-gray-400">{d.agent}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{d.timestamp}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{d.summary}</p>
                {d.txHash && (
                  <a href={`https://explorer.solana.com/tx/${d.txHash}?cluster=devnet`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[10px] text-teal-600 hover:underline">
                    {d.txHash.slice(0, 16)}... <ExternalLink size={10} />
                  </a>
                )}
                {d.decisionHash && (
                  <div className="mt-1 font-mono text-[10px] text-gray-400 truncate">
                    Hash: {d.decisionHash}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {decisions.length === 0 && (
          <p className="text-center py-8 text-gray-400 text-sm">No decisions yet</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// DemoButton — 1-click full lifecycle demo
// ═══════════════════════════════════════════
import { Play, Loader2 } from 'lucide-react';

export function DemoButton({ onRun, running = false }) {
  return (
    <button onClick={onRun} disabled={running}
      className="w-full py-4 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-semibold text-base hover:from-teal-700 hover:to-emerald-700 disabled:opacity-60 transition-all flex items-center justify-center gap-3 shadow-lg shadow-teal-500/20">
      {running
        ? <><Loader2 size={20} className="animate-spin" /> Running golden path...</>
        : <><Play size={20} /> Run full demo: Score → Escrow → Disburse → Repay → Release</>
      }
    </button>
  );
}
