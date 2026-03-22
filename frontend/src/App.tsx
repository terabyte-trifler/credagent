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

import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { AlertCircle, CheckCircle2, Clock3, Loader2, ServerCog } from 'lucide-react';
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
  useLoanActions,
  useLoanBook,
  usePoolState,
  useRuntimeStatus,
} from './hooks/useCredAgent';
import {
  type CreditResult,
  type ChatMessage,
  MCP_API_URL,
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
  const wallet = useWallet();
  const demo = useDemoRunner();
  const { services } = useRuntimeStatus();
  const { agents } = useAgentStatus();
  const { decisions } = useDecisionFeed();
  const { loans, loaded: loanBookLoaded, refresh: refreshLoans } = useLoanBook();
  const { pool, refresh: refreshPool } = usePoolState();
  const { repayLoan, repayingLoanId, acceptOfferAndEnableAutopay, startingLoan, actionError, clearActionError } = useLoanActions();
  const { gaps } = useIntegrationGaps(services, agents, decisions, loanBookLoaded);
  const [latestCreditResult, setLatestCreditResult] = useState<CreditResult | null>(null);
  const [negotiationTerms, setNegotiationTerms] = useState<{
    amountUsd: number;
    durationDays: number;
    rateBps: number;
    collateral: string;
    round: number;
  } | null>(null);
  const [negotiationStarted, setNegotiationStarted] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'agent', text: "I'm the CredAgent Lending Agent. Score a wallet in Credit Explorer first, then tell me the loan amount and duration you want, like '3000 for 60 days'." },
  ]);

  const buildCollateralText = useCallback((amountUsd: number, maxLtvBps: number) => {
    if (maxLtvBps <= 0) return 'Collateral unavailable';
    const collateralUsd = amountUsd / (maxLtvBps / 10000);
    const xaut = collateralUsd / 3000;
    return `${xaut.toFixed(2)} XAUT`;
  }, []);

  const parseNegotiationRequest = useCallback((text: string) => {
    const normalized = text.toLowerCase().replace(/,/g, '');
    const amountMatch = normalized.match(/\$?\s*(\d{2,6})/);
    const dayMatch = normalized.match(/(\d{1,3})\s*(day|days|d)\b/);
    const monthMatch = normalized.match(/(\d{1,2})\s*(month|months|mo)\b/);
    const amountUsd = amountMatch ? Number(amountMatch[1]) : null;
    let durationDays = dayMatch ? Number(dayMatch[1]) : null;
    if (!durationDays && monthMatch) durationDays = Number(monthMatch[1]) * 30;
    return {
      amountUsd,
      durationDays,
    };
  }, []);

  const handleChatSend = useCallback((text: string) => {
    setChatMessages(prev => [...prev, { role: 'user', text }]);

    window.setTimeout(async () => {
      if (!latestCreditResult) {
        setChatMessages(prev => [...prev, {
          role: 'agent',
          text: 'I need a fresh wallet score first. Use Credit Explorer, then come back with an amount and duration request.',
        }]);
        return;
      }

      const starterEligible = latestCreditResult.starter_eligible || latestCreditResult.lending_path === 'starter';
      if (latestCreditResult.recommended_terms.max_loan_usd <= 0 && !starterEligible) {
        setChatMessages(prev => [...prev, {
          role: 'agent',
          text: `This borrower is currently ${latestCreditResult.risk_tier} tier with a score of ${latestCreditResult.score}, so I cannot offer a loan. Improve credit history or add stronger collateral evidence before retrying.`,
        }]);
        return;
      }

      const parsed = parseNegotiationRequest(text);
      if (!parsed.amountUsd) {
        setChatMessages(prev => [...prev, {
          role: 'agent',
          text: `I have a ${latestCreditResult.risk_tier}-tier borrower loaded. Tell me the amount and duration you want, for example '2500 for 45 days'. Max loan from the score is $${latestCreditResult.recommended_terms.max_loan_usd.toLocaleString()}.`,
        }]);
        return;
      }

      const requestedDuration = parsed.durationDays || negotiationTerms?.durationDays || Math.min(latestCreditResult.recommended_terms.max_duration_days || 30, 60);

      try {
        const endpoint = negotiationStarted ? '/agent/lending/negotiate' : '/agent/lending/evaluate';
        const resp = await fetch(`${MCP_API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            borrower: latestCreditResult.address,
            amountUsd: parsed.amountUsd,
            durationDays: requestedDuration,
          }),
        });
        const payload = await resp.json();
        if (!resp.ok || payload.success === false) {
          throw new Error(payload.error || `HTTP ${resp.status}`);
        }

        const result = payload.result;
        const offer = result.offer;
        if (!offer) {
          setChatMessages(prev => [...prev, {
            role: 'agent',
            text: result.error || result.message || 'No live offer could be produced for this request.',
          }]);
          return;
        }

        setNegotiationStarted(true);
        setNegotiationTerms({
          amountUsd: offer.principal,
          durationDays: offer.durationDays,
          rateBps: offer.rateBps,
          collateral: buildCollateralText(offer.principal, offer.ltvBps),
          round: result.round || 1,
        });

        const notes = [
          `Live lending agent response for ${latestCreditResult.risk_tier}-tier borrower (${latestCreditResult.score})`,
          `Offer: $${offer.principal.toLocaleString()} at ${(offer.rateBps / 100).toFixed(1)}% APR for ${offer.durationDays} days`,
          `Collateral needed: ${buildCollateralText(offer.principal, offer.ltvBps)}`,
        ];
        if (result.violations?.length) {
          notes.push(`Policy adjustments: ${result.violations.join('; ')}`);
        }
        if (result.defaultProbability !== undefined) {
          notes.push(`Estimated PD ${(Number(result.defaultProbability) * 100).toFixed(2)}%`);
        }
        notes.push(
          result.status === 'FINAL'
            ? 'This is the final negotiation round.'
            : 'Send another counter-offer to continue the live session.',
        );

        setChatMessages(prev => [...prev, { role: 'agent', text: notes.join('. ') + '.' }]);
      } catch (error: any) {
        setChatMessages(prev => [...prev, {
          role: 'agent',
          text: `Live negotiation failed: ${error?.message || 'unknown error'}.`,
        }]);
      }
    }, 300);
  }, [buildCollateralText, latestCreditResult, negotiationStarted, negotiationTerms?.durationDays, parseNegotiationRequest]);

  const handleAcceptOffer = useCallback(async () => {
    if (!latestCreditResult) return;
    try {
      clearActionError();
      const result = await acceptOfferAndEnableAutopay(latestCreditResult.address, {
        amountUsd: negotiationTerms?.amountUsd ?? latestCreditResult.recommended_terms.max_loan_usd,
        durationDays: negotiationTerms?.durationDays ?? latestCreditResult.recommended_terms.max_duration_days,
      });
      setChatMessages(prev => [...prev, {
        role: 'agent',
        text: `Loan started successfully. Collateral locked, funds disbursed, repayment schedule created, and autopay authorized for loan #${result.loanId}.`,
      }]);
    } catch (error: any) {
      setChatMessages(prev => [...prev, {
        role: 'agent',
        text: `Loan initiation failed: ${error?.message || 'unknown error'}.`,
      }]);
    }
  }, [acceptOfferAndEnableAutopay, clearActionError, latestCreditResult, negotiationTerms]);

  const handleRepay = useCallback(async (loan: any) => {
    try {
      clearActionError();
      await repayLoan(loan);
      await Promise.all([refreshLoans(), refreshPool()]);
    } catch {
      // actionError is already set by the hook; keep UI responsive.
    }
  }, [clearActionError, repayLoan, refreshLoans, refreshPool]);

  useEffect(() => {
    if (!latestCreditResult) return;
    const starterEligible = latestCreditResult.starter_eligible || latestCreditResult.lending_path === 'starter';
    setChatMessages([
      {
        role: 'agent',
        text: starterEligible
          ? `Wallet scored at ${latestCreditResult.score} (${latestCreditResult.risk_tier}). This borrower qualifies for a starter loan path: up to $${latestCreditResult.recommended_terms.max_loan_usd.toLocaleString()}, base rate ${(latestCreditResult.recommended_terms.rate_bps / 100).toFixed(1)}%, max duration ${latestCreditResult.recommended_terms.max_duration_days} days. Tell me what amount and duration you want.`
          : `Wallet scored at ${latestCreditResult.score} (${latestCreditResult.risk_tier}). Max loan $${latestCreditResult.recommended_terms.max_loan_usd.toLocaleString()}, base rate ${(latestCreditResult.recommended_terms.rate_bps / 100).toFixed(1)}%, max duration ${latestCreditResult.recommended_terms.max_duration_days} days. Tell me what amount and duration you want.`,
      },
    ]);
    setNegotiationTerms(null);
    setNegotiationStarted(false);
  }, [latestCreditResult]);

  const runDemo = useCallback(async () => {
    if (!latestCreditResult) {
      setChatMessages(prev => [...prev, {
        role: 'agent',
        text: 'Score a wallet first so the live backend flow knows which borrower to evaluate.',
      }]);
      return;
    }
    await demo.run({
      borrower: latestCreditResult.address,
      amountUsd: Math.max(250, Math.min(latestCreditResult.recommended_terms.max_loan_usd || 500, 1000)),
      durationDays: Math.min(latestCreditResult.recommended_terms.max_duration_days || 30, 30),
    });
  }, [demo, latestCreditResult]);

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
            <CreditExplorer onResult={setLatestCreditResult} />
          </ErrorBoundary>
        </section>

        {/* T5.3 + T5.5: Loans + Negotiation (side by side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 dashboard-grid">
          <section>
          <SectionLabel>Active loans</SectionLabel>
            <ErrorBoundary>
              <LoanManager
                loans={loans}
                live
                onRepay={handleRepay}
                repayingLoanId={repayingLoanId}
                actionError={actionError}
                connectedWallet={wallet.publicKey?.toBase58() || null}
              />
            </ErrorBoundary>
          </section>
          <section>
          <SectionLabel>Operator negotiation console</SectionLabel>
            <ErrorBoundary>
              <NegotiationChat messages={allMessages} onSend={handleChatSend}
                loanTerms={negotiationTerms ? {
                  rateBps: negotiationTerms.rateBps,
                  durationDays: negotiationTerms.durationDays,
                  collateral: negotiationTerms.collateral,
                } : latestCreditResult ? {
                  rateBps: latestCreditResult.recommended_terms.rate_bps,
                  durationDays: latestCreditResult.recommended_terms.max_duration_days,
                  collateral: buildCollateralText(
                    Math.max(1, latestCreditResult.recommended_terms.max_loan_usd || 1),
                    latestCreditResult.recommended_terms.max_ltv_bps,
                  ),
                } : null}
                actions={negotiationTerms && latestCreditResult ? (
                  <div className="rounded-xl border border-white/[0.04] bg-surface-2/40 px-3 py-3">
                    <div className="text-[11px] text-gray-500 mb-2">
                      Accepting will ask the borrower wallet to sign collateral lock and autopay approval. The AI agents will handle disbursement, scheduling, and later collections.
                    </div>
                    {actionError && (
                      <div className="mb-2 text-[11px] text-red-400">{actionError}</div>
                    )}
                    <button
                      onClick={handleAcceptOffer}
                      disabled={startingLoan}
                      className="w-full rounded-xl bg-cred-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cred-700 disabled:opacity-60 disabled:cursor-wait transition-colors flex items-center justify-center gap-2"
                    >
                      {startingLoan ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      {startingLoan ? 'Starting loan…' : 'Accept offer and enable autopay'}
                    </button>
                  </div>
                ) : null} />
            </ErrorBoundary>
          </section>
        </div>

        {/* T5.4: Pool dashboard */}
        <section>
          <SectionLabel>Pool analytics</SectionLabel>
          <ErrorBoundary>
            <PoolDashboard pool={pool || {
              totalDeposited: 0,
              totalBorrowed: 0,
              utilization: 0,
              interestEarned: 0,
              activeLoans: 0,
              defaultRate: 0,
              baseRateBps: 0,
              source: 'onchain',
            }} />
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
