/**
 * CredAgent Dashboard — Main App
 *
 * 6 screens + DemoButton wired into a single-page layout.
 * Designed for hackathon demo: judges see everything on one page,
 * scroll through sections, or click "Run Demo" for the golden path.
 */
import React, { useState, useCallback } from 'react';
import AgentStatus from './components/AgentStatus';
import CreditExplorer from './components/CreditExplorer';
import { LoanManager, PoolDashboard, NegotiationChat, DecisionLog, DemoButton } from './components/Screens';

// Mock data for demo rendering
const MOCK_AGENTS = {
  'credit-agent':     { status: 'active', balance: '4.21', opsToday: 23, limitUsedPct: 12, lastAction: 'Scored 0xDRpb...21hy → 720 (AA)' },
  'lending-agent':    { status: 'active', balance: '2.85', opsToday: 8,  limitUsedPct: 34, lastAction: 'Disbursed 3,000 USDT → 0xB3f2...' },
  'collection-agent': { status: 'active', balance: '1.50', opsToday: 15, limitUsedPct: 5,  lastAction: 'Pulled installment 3/6 for loan #42' },
  'yield-agent':      { status: 'idle',   balance: '0.92', opsToday: 2,  limitUsedPct: 1,  lastAction: 'Adjusted pool rate to 6.8%' },
};

const MOCK_LOANS = [
  { id: 42, borrower: 'DRpbCBMx...21hy', principal: 3000, rateBps: 650, dueDate: '2026-05-18', repaid: 1500, escrowStatus: 'Locked', paidInstallments: 3, totalInstallments: 6, status: 'Active' },
  { id: 41, borrower: '7nYB5K6q...9mPz', principal: 1000, rateBps: 1000, dueDate: '2026-04-20', repaid: 1050, escrowStatus: 'Released', paidInstallments: 4, totalInstallments: 4, status: 'Repaid' },
];

const MOCK_POOL = { totalDeposited: 50000, totalBorrowed: 12000, utilization: 24, interestEarned: 340, activeLoans: 3, defaultRate: 1.2 };

const MOCK_DECISIONS = [
  { action: 'Score updated', agent: 'Credit Agent', status: 'success', timestamp: '2 min ago', summary: 'Borrower DRpb... scored 720 (AA tier, 89% confidence)', txHash: 'abc123def456', decisionHash: 'sha256:7a8b9c...' },
  { action: 'Loan disbursed', agent: 'Lending Agent', status: 'success', timestamp: '5 min ago', summary: 'Conditional disburse: 4 gates passed, 3,000 USDT sent', txHash: 'def789ghi012', decisionHash: 'sha256:4d5e6f...' },
  { action: 'Installment pulled', agent: 'Collection Agent', status: 'success', timestamp: '1 hr ago', summary: 'Installment 3/6 pulled: 500 USDT from borrower via delegate', txHash: 'jkl345mno678' },
  { action: 'Rate limit rejected', agent: 'Lending Agent', status: 'error', timestamp: '2 hr ago', summary: 'Daily spending limit exceeded: 8,500/10,000 USDT + 2,000 = over limit' },
];

export default function App() {
  const [demoRunning, setDemoRunning] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'agent', text: 'Welcome. I\'m the CredAgent Lending Agent. I can evaluate your loan request based on your on-chain credit score. What amount do you need?' },
  ]);

  const runDemo = useCallback(async () => {
    setDemoRunning(true);
    // Simulated golden path steps
    const steps = [
      'Step 1: Scoring borrower via ML API...',
      'Step 2: Locking 1.5 XAUT collateral in escrow PDA...',
      'Step 3: Conditional disbursement — checking 4 gates...',
      'Step 4: All gates passed. Disbursing 3,000 USDT...',
      'Step 5: Creating 6-installment repayment schedule...',
      'Step 6: Pulling first installment (500 USDT)...',
      'Step 7: Full repayment detected. Releasing collateral...',
      'Demo complete! Full loan lifecycle executed.',
    ];
    for (const step of steps) {
      setChatMessages(prev => [...prev, { role: 'agent', text: step }]);
      await new Promise(r => setTimeout(r, 1200));
    }
    setDemoRunning(false);
  }, []);

  const handleChatSend = (text) => {
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    // Simulate agent response
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        role: 'agent',
        text: `Based on your credit score of 720 (AA tier), I can offer: ${text.includes('3000') || text.includes('3,000')
          ? '3,000 USDT at 6.5% APR for 60 days with 60% LTV collateral (1.5 XAUT). Shall I proceed?'
          : 'Let me check your eligibility. What amount and duration are you looking for?'
        }`,
      }]);
    }, 800);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-sm">C</div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">CredAgent</h1>
              <p className="text-[10px] text-gray-400">Autonomous Lending · Solana · WDK</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Devnet · 4 agents active
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Demo button — top, prominent */}
        <DemoButton onRun={runDemo} running={demoRunning} />

        {/* Agent status */}
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Agent status</h2>
          <AgentStatus agentData={MOCK_AGENTS} />
        </section>

        {/* Credit explorer */}
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Credit scoring</h2>
          <CreditExplorer />
        </section>

        {/* Two-column: Loan manager + Chat */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section>
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Active loans</h2>
            <LoanManager loans={MOCK_LOANS} />
          </section>
          <section>
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Loan negotiation</h2>
            <NegotiationChat messages={chatMessages} onSend={handleChatSend} />
          </section>
        </div>

        {/* Pool dashboard */}
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Pool analytics</h2>
          <PoolDashboard pool={MOCK_POOL} />
        </section>

        {/* Decision log */}
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Agent decisions</h2>
          <DecisionLog decisions={MOCK_DECISIONS} />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 mt-12 py-4">
        <p className="text-center text-xs text-gray-400">
          CredAgent · Tether WDK + OpenClaw + Solana · Hackathon Galactica 2026
        </p>
      </footer>
    </div>
  );
}
