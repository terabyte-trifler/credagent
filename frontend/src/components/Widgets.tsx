// ═══════════════════════════════════════════
// T5.5: NegotiationChat — LLM loan negotiation
// ═══════════════════════════════════════════

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Play, Loader2, CheckCircle, XCircle, Clock, ExternalLink, ShieldCheck } from 'lucide-react';
import type { ChatMessage, Decision } from '../lib/constants';

export function NegotiationChat({
  messages, onSend, loanTerms, actions,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  loanTerms?: { rateBps: number; durationDays: number; collateral: string } | null;
  actions?: React.ReactNode;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const send = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="glass flex flex-col" style={{ height: 460 }}>
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-cred-600/20 flex items-center justify-center">
            <Bot size={13} className="text-cred-400" />
          </div>
          <span className="text-sm font-semibold text-gray-200">Loan negotiation</span>
        </div>
        {loanTerms && (
          <span className="text-[11px] text-cred-400 font-mono">
            {(loanTerms.rateBps / 100).toFixed(1)}% · {loanTerms.durationDays}d · {loanTerms.collateral}
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => {
          const isAgent = msg.role === 'agent';
          return (
            <div key={i} className={`flex gap-2.5 ${isAgent ? '' : 'flex-row-reverse'} animate-fade-up`}
              style={{ animationDelay: `${i * 40}ms` }}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                isAgent ? 'bg-cred-600/15' : 'bg-surface-3'
              }`}>
                {isAgent ? <Bot size={13} className="text-cred-400" /> : <User size={13} className="text-gray-400" />}
              </div>
              <div className={`max-w-[75%] px-4 py-2.5 text-[13px] leading-relaxed ${
                isAgent
                  ? 'bg-surface-2 text-gray-300 chat-bubble-agent'
                  : 'bg-cred-600 text-white chat-bubble-user'
              }`}>
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/[0.04] flex gap-2 flex-shrink-0">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Negotiate your loan terms…"
          className="flex-1 px-4 py-2.5 rounded-xl bg-surface-2 border border-white/[0.04] text-sm text-gray-200 placeholder:text-gray-600 outline-none focus:ring-1 focus:ring-cred-600/40 transition-all" />
        <button onClick={send}
          className="px-3.5 py-2.5 rounded-xl bg-cred-600 text-white hover:bg-cred-700 transition-colors">
          <Send size={15} />
        </button>
      </div>
      {actions && (
        <div className="px-3 pb-3">
          {actions}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// T5.6: DecisionLog — agent decision timeline
// ═══════════════════════════════════════════

const STATUS_ICON = { success: CheckCircle, error: XCircle, pending: Clock };
const STATUS_COLOR = { success: 'text-cred-400', error: 'text-red-400', pending: 'text-amber-400' };

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  return (
    <div className="glass p-6">
      <h2 className="text-base font-semibold text-gray-100 mb-4">Agent decisions</h2>
      <div className="space-y-2 stagger-children">
        {decisions.map((d, i) => {
          const Icon = STATUS_ICON[d.status] || Clock;
          return (
            <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-surface-2/40 hover:bg-surface-2/60 transition-colors">
              <Icon size={15} className={`mt-0.5 flex-shrink-0 ${STATUS_COLOR[d.status] || ''}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-200">{d.action}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-gray-500">{d.agent}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">{d.timestamp}</span>
                </div>
                <p className="text-[12px] text-gray-500 truncate">{d.summary}</p>
                <div className="flex items-center gap-3 mt-1">
                  {d.txHash && (
                    <a href={`https://explorer.solana.com/tx/${d.txHash}?cluster=devnet`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-cred-500 hover:text-cred-400 transition-colors font-mono">
                      tx:{d.txHash.slice(0, 10)}… <ExternalLink size={9} />
                    </a>
                  )}
                  {d.decisionHash && (
                    <span className="text-[10px] text-gray-600 font-mono flex items-center gap-1">
                      <ShieldCheck size={9} className="text-cred-700" />
                      {d.decisionHash.slice(0, 16)}…
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {decisions.length === 0 && (
          <div className="text-center py-10 text-gray-600 text-sm">No decisions yet</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// T5.7: DemoButton — 1-click golden path
// ═══════════════════════════════════════════

export function DemoButton({
  onRun, running, currentStep, totalSteps,
}: {
  onRun: () => void;
  running: boolean;
  currentStep: number;
  totalSteps: number;
}) {
  const pct = totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Progress background */}
      {running && (
        <div className="absolute inset-0 bg-cred-600/5 transition-all duration-500"
          style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />
      )}
      <button onClick={onRun} disabled={running}
        className="relative w-full py-5 rounded-2xl border border-cred-600/20 bg-gradient-to-r from-cred-900/30 via-cred-800/10 to-cred-900/30 text-white font-semibold text-sm hover:border-cred-500/40 hover:from-cred-900/50 disabled:cursor-wait transition-all flex items-center justify-center gap-3">
        {running ? (
          <>
            <Loader2 size={18} className="animate-spin text-cred-400" />
            <span className="text-cred-300">
              Step {currentStep + 1}/{Math.max(totalSteps, 1)} — Running live backend flow…
            </span>
          </>
        ) : (
          <>
            <Play size={18} className="text-cred-400" />
            <span>Run live backend flow</span>
            <span className="text-cred-500/60 text-xs ml-1">Score → Evaluate → Execute real MCP steps</span>
          </>
        )}
      </button>
    </div>
  );
}
