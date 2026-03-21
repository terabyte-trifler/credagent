// ═══════════════════════════════════════════
// hooks/useCredAgent.ts — Program interaction hooks
// ═══════════════════════════════════════════

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { ML_API_URL, type CreditResult, type PoolState } from '../lib/constants';

/** Fetch credit score from ML API */
export function useCreditScore() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const score = useCallback(async (address: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${ML_API_URL}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { score, result, loading, error, reset: () => { setResult(null); setError(null); } };
}

/** Fetch pool state (mock or from on-chain) */
export function usePoolState() {
  const { connection } = useConnection();
  const [pool, setPool] = useState<PoolState | null>(null);

  const refresh = useCallback(async () => {
    // In production: deserialize PoolState PDA from on-chain
    // For hackathon: use mock data
    setPool({
      totalDeposited: 50000, totalBorrowed: 12000, utilization: 24,
      interestEarned: 340, activeLoans: 3, defaultRate: 1.2, baseRateBps: 650,
    });
  }, [connection]);

  return { pool, refresh };
}

/** Demo step runner — simulates golden path lifecycle */
export function useDemoRunner() {
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const STEPS = [
    { label: 'Scoring borrower via ML API…', duration: 1200 },
    { label: 'Score: 720 (AA tier, 89% confidence)', duration: 800 },
    { label: 'Locking 1.5 XAUT collateral in escrow PDA…', duration: 1000 },
    { label: 'Escrow locked ✓ — PDA-owned vault', duration: 600 },
    { label: 'Conditional disbursement — checking 4 gates…', duration: 1400 },
    { label: '✓ Score valid  ✓ Escrow locked  ✓ Util OK  ✓ Agent auth', duration: 800 },
    { label: 'Disbursed 3,000 USDT to borrower', duration: 600 },
    { label: 'Creating 6-installment repayment schedule…', duration: 800 },
    { label: 'Pulling installment 1/6: 500 USDT via delegate…', duration: 1000 },
    { label: 'Borrower repays remaining balance…', duration: 800 },
    { label: 'Loan fully repaid — releasing collateral…', duration: 1000 },
    { label: '1.5 XAUT returned to borrower. Lifecycle complete ✓', duration: 0 },
  ];

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    setCurrentStep(0);
    for (let i = 0; i < STEPS.length; i++) {
      setCurrentStep(i);
      setLog(prev => [...prev, STEPS[i].label]);
      if (STEPS[i].duration > 0) {
        await new Promise(r => setTimeout(r, STEPS[i].duration));
      }
    }
    setRunning(false);
  }, [running]);

  return { run, running, currentStep, log, totalSteps: STEPS.length };
}
