/**
 * CredAgent Dashboard — App.tsx
 *
 * Wires all 9 screens into a single-page layout.
 * Design: dark mode, glass morphism, DM Sans font, cred-green accent.
 *
 * T5.1: AgentStatus — top row, 4 cards
 * T5.2: CreditExplorer — address → score + radar + ZK badge
 * T5.3: LoanManager — expandable loan rows
 * T5.4: PoolDashboard — TVL + utilization + area chart
 * T5.5: NegotiationChat — LLM negotiation messages
 * T5.6: DecisionLog — timeline with tx links
 * T5.7: DemoButton — golden path runner (hero position)
 * T5.8: ZK badge inside CreditExplorer
 * T5.9: Error boundaries, loading, responsive, dark mode, wallet
 */

import React, { useState, useCallback } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { AlertCircle, CheckCircle2, Clock3, ServerCog } from 'lucide-react';
import AgentStatus from './components/AgentStatus';
import CreditExplorer from './components/CreditExplorer';
import LoanManager from './components/LoanManager';
import PoolDashboard from './components/PoolDashboard';
import { NegotiationChat, DecisionLog, DemoButton } from './components/Widgets';
import ErrorBoundary from './components/ErrorBoundary';
import {
  useAgentStatus,
  useDecisionFeed,
  useDemoRunner,
  useIntegrationGaps,
  useLoanBook,
  useRuntimeStatus,
} from './hooks/useCredAgent';
import {
  MOCK_POOL,
  type ChatMessage,
} from './lib/constants';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-[0.15em]">{children}</span>
      <div className="flex-1 h-px bg-gradient-to-r from-white/[0.04] to-transparent" />
    </div>
  );
}

export default function App() {
  const { connected, publicKey } = useWallet();
  const demo = useDemoRunner();
  const { services } = useRuntimeStatus();
  const { agents } = useAgentStatus();
  const { decisions } = useDecisionFeed();
  const { loans, loaded: loanBookLoaded } = useLoanBook();
  const { gaps } = useIntegrationGaps(services, agents, decisions, loanBookLoaded);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'agent', text: "I'm the CredAgent Lending Agent. I can evaluate your loan request using your on-chain credit score and negotiate terms. What amount are you looking for?" },
  ]);

  const handleChatSend = useCallback((text: string) => {
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setTimeout(() => {
      const isAmount = /\d/.test(text);
      setChatMessages(prev => [...prev, {
        role: 'agent',
        text: isAmount
          ? `Based on your AA-tier score (720), I can offer: ${text.includes('3000') || text.includes('3,000')
            ? '3,000 USDT at 6.5% APR for 60 days. Collateral: 1.5 XAUT (60% LTV). Schedule: 6 × $500 every 10 days. Shall I proceed with these terms?'
            : `Up to $5,000 USDT at 6.5% APR. What amount and duration work for you?`}`
          : "Could you specify the loan amount you need? I'll calculate the best terms for your credit tier.",
      }]);
    }, 800);
  }, []);

  // Feed demo log into chat
  const runDemo = useCallback(async () => {
    await demo.run();
  }, [demo]);

  // Combine demo log with chat
  const allMessages: ChatMessage[] = [
    ...chatMessages,
    ...demo.log.map(l => ({ role: 'agent' as const, text: l })),
  ];

  const activeAgents = agents.filter(a => a.status === 'active').length;

  return (
    <div className="min-h-screen bg-surface-0">
      {/* ═══ Header ═══ */}
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-surface-0/80 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cred-600 flex items-center justify-center shadow-lg shadow-cred-600/20">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-100 tracking-tight">CredAgent</h1>
              <p className="text-[9px] text-gray-600 uppercase tracking-[0.15em]">
                Autonomous lending · Solana · WDK
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Network badge */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-white/[0.04]">
              <span className="w-1.5 h-1.5 rounded-full bg-cred-500 animate-pulse" />
                <span className="text-[10px] text-gray-400 font-mono">devnet / operator view</span>
            </div>

            {/* Agent count */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-white/[0.04]">
              <span className="text-[10px] text-gray-400">
                {activeAgents}/4 live agents
              </span>
            </div>

            {/* Wallet connect (T5.9) */}
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* ═══ Main Content ═══ */}
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-6">

        {/* T5.7: Demo button — hero position */}
        <ErrorBoundary>
          <DemoButton onRun={runDemo} running={demo.running}
            currentStep={demo.currentStep} totalSteps={demo.totalSteps} />
        </ErrorBoundary>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass p-5">
            <div className="flex items-center gap-2 mb-4">
              <ServerCog size={16} className="text-cred-400" />
              <h2 className="text-base font-semibold text-gray-100">Runtime status</h2>
            </div>
            <div className="space-y-2">
              {services.map(service => (
                <div key={service.name} className="flex items-center justify-between rounded-xl bg-surface-2/40 px-4 py-3">
                  <div>
                    <div className="text-sm text-gray-200">{service.name}</div>
                    <div className="text-[11px] text-gray-500">{service.detail}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                    service.state === 'online'
                      ? 'bg-cred-500/10 text-cred-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}>
                    {service.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={16} className="text-amber-400" />
              <h2 className="text-base font-semibold text-gray-100">What’s still missing</h2>
            </div>
            <div className="space-y-2">
              {gaps.map(gap => (
                <div key={gap.key} className="rounded-xl bg-surface-2/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-gray-200">{gap.title}</div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                      gap.status === 'ready'
                        ? 'bg-cred-500/10 text-cred-400'
                        : gap.status === 'pending'
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-red-500/10 text-red-400'
                    }`}>
                      {gap.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">{gap.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* T5.1: Agent status */}
        <section>
          <SectionLabel>Agent runtime</SectionLabel>
          <ErrorBoundary>
            <AgentStatus agents={agents} />
          </ErrorBoundary>
        </section>

        {/* T5.2 + T5.8: Credit explorer (includes ZK badge) */}
        <section>
          <SectionLabel>Credit scoring</SectionLabel>
          <ErrorBoundary>
            <CreditExplorer />
          </ErrorBoundary>
        </section>

        {/* T5.3 + T5.5: Loans + Negotiation (side by side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 dashboard-grid">
          <section>
          <SectionLabel>Active loans</SectionLabel>
            <ErrorBoundary>
              <LoanManager loans={loans} live />
            </ErrorBoundary>
          </section>
          <section>
          <SectionLabel>Operator negotiation console</SectionLabel>
            <ErrorBoundary>
              <NegotiationChat messages={allMessages} onSend={handleChatSend}
                loanTerms={{ rateBps: 650, durationDays: 60, collateral: '1.5 XAUT' }} />
            </ErrorBoundary>
          </section>
        </div>

        {/* T5.4: Pool dashboard */}
        <section>
          <SectionLabel>Pool analytics</SectionLabel>
          <ErrorBoundary>
            <PoolDashboard pool={MOCK_POOL} />
          </ErrorBoundary>
        </section>

        {/* T5.6: Decision log */}
        <section>
          <SectionLabel>Agent decisions</SectionLabel>
          <ErrorBoundary>
            <DecisionLog decisions={decisions} />
          </ErrorBoundary>
        </section>
      </main>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-white/[0.04] mt-12">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-[10px] text-gray-700">
            CredAgent · Tether WDK + OpenClaw + Solana · Hackathon Galactica 2026
          </p>
          <div className="flex items-center gap-3 text-[10px] text-gray-700">
            <span>7 payment primitives</span>
            <span>·</span>
            <span>{activeAgents}/4 agent runtimes connected</span>
            <span>·</span>
            <span>XGBoost ML scoring + live proof verification</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
