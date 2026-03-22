import React, { useState } from 'react';
import { Lock, Unlock, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react';
import type { Loan } from '../lib/constants';

const STATUS_STYLE: Record<string, string> = {
  Active: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Repaid: 'bg-cred-500/10 text-cred-400 border-cred-500/20',
  Defaulted: 'bg-red-500/10 text-red-400 border-red-500/20',
};
const ESCROW_ICON: Record<string, typeof Lock> = {
  Locked: Lock, Released: Unlock, Liquidated: AlertTriangle,
};

function ProgressBar({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? (paid / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full rounded-full bg-cred-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-gray-500 font-mono">{paid}/{total}</span>
    </div>
  );
}

export default function LoanManager({
  loans,
  live = false,
  onRepay,
  repayingLoanId,
}: {
  loans: Loan[];
  live?: boolean;
  onRepay?: (loan: Loan) => void | Promise<void>;
  repayingLoanId?: number | null;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const hasSampleData = !live && loans.length > 0;

  return (
    <div className="glass p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-100">Active loans</h2>
        <span className="text-xs text-gray-500">{loans.filter(l => l.status === 'Active').length} active</span>
      </div>

      {hasSampleData && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-300">
          Sample lifecycle data is shown here until a live loan indexer or LendingPool client is wired into the dashboard.
        </div>
      )}

      <div className="space-y-2">
        {loans.map(loan => {
          const EscIcon = ESCROW_ICON[loan.escrowStatus] || Lock;
          const isOpen = expanded === loan.id;

          return (
            <div key={loan.id} className="rounded-xl bg-surface-2/50 border border-white/[0.03] overflow-hidden transition-all">
              {/* Row */}
              <button onClick={() => setExpanded(isOpen ? null : loan.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-3/30 transition-colors">
                <span className="text-xs font-mono text-gray-500 w-10">#{loan.id}</span>
                <span className="text-xs font-mono text-gray-400 w-24 truncate">{loan.borrower}</span>
                <span className="text-sm font-semibold text-gray-200 w-20">${loan.principal.toLocaleString()}</span>
                <span className="text-xs text-gray-500 w-12">{(loan.rateBps / 100).toFixed(1)}%</span>
                <div className="flex-1"><ProgressBar paid={loan.paidInstallments} total={loan.totalInstallments} /></div>
                <div className="flex items-center gap-1 w-20">
                  <EscIcon size={12} className="text-gray-500" />
                  <span className="text-[11px] text-gray-500">{loan.escrowStatus}</span>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[loan.status]}`}>
                  {loan.status}
                </span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-white/[0.03] animate-fade-up">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Principal', value: `$${loan.principal.toLocaleString()} USDT` },
                      { label: 'Repaid', value: `$${loan.repaid.toLocaleString()} USDT` },
                      { label: 'Due date', value: loan.dueDate },
                      { label: 'Installment', value: `$${loan.installmentAmount} × ${loan.totalInstallments}` },
                    ].map(d => (
                      <div key={d.label}>
                        <div className="text-[9px] text-gray-600 uppercase tracking-widest">{d.label}</div>
                        <div className="text-sm text-gray-300 font-medium mt-0.5">{d.value}</div>
                      </div>
                    ))}
                  </div>
                  {loan.status === 'Active' && (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => onRepay?.(loan)}
                        disabled={!onRepay || repayingLoanId === loan.id}
                        className="px-3 py-1.5 rounded-lg bg-cred-600/20 text-cred-400 text-xs font-medium hover:bg-cred-600/30 transition-colors disabled:opacity-50"
                      >
                        {repayingLoanId === loan.id ? 'Repaying…' : 'Repay'}
                      </button>
                      <a
                        href={loan.accountPubkey
                          ? `https://explorer.solana.com/address/${loan.accountPubkey}?cluster=devnet`
                          : undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-surface-3 text-gray-400 text-xs font-medium hover:bg-surface-3/80 transition-colors flex items-center gap-1"
                      >
                        View on Explorer <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {loans.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">
            {live ? 'No live loans found on the lending program' : 'No loans found'}
          </div>
        )}
      </div>
    </div>
  );
}
