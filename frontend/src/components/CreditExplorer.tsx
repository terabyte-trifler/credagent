import React, { useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts';
import { Search, ShieldCheck, Loader2 } from 'lucide-react';
import { TIER_COLORS, type CreditResult } from '../lib/constants';
import { useCreditScore } from '../hooks/useCredAgent';

/** SVG score gauge arc */
function ScoreGauge({ score, tier }: { score: number; tier: string }) {
  const pct = Math.max(0, Math.min(1, (score - 300) / 550));
  const radius = 70;
  const circ = 2 * Math.PI * radius;
  const arcLen = circ * 0.75; // 270 degrees
  const offset = arcLen * (1 - pct);
  const color = TIER_COLORS[tier] || '#6b7280';

  return (
    <svg viewBox="0 0 180 160" className="w-48 h-40">
      <circle cx="90" cy="90" r={radius} fill="none" stroke="currentColor"
        className="text-surface-3" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset="0"
        transform="rotate(135 90 90)" />
      <circle cx="90" cy="90" r={radius} fill="none" stroke={color}
        strokeWidth="10" strokeLinecap="round" className="score-arc"
        strokeDasharray={`${arcLen} ${circ}`} strokeDashoffset={offset}
        transform="rotate(135 90 90)" />
      <text x="90" y="85" textAnchor="middle" className="fill-gray-100 font-display"
        fontSize="36" fontWeight="700">{score}</text>
      <text x="90" y="108" textAnchor="middle" className="fill-gray-500"
        fontSize="11" fontWeight="500">of 850</text>
    </svg>
  );
}

/** T5.8 — ZK Proof Badge */
function ZkBadge({ hash, status }: { hash?: string; status?: 'stub' | 'verified' | 'missing' }) {
  const resolvedStatus = status || (hash ? 'stub' : 'missing');
  const title = resolvedStatus === 'verified' ? 'Credit Verified Privately' : 'ZK Proof Stub';
  const subtitle =
    resolvedStatus === 'verified'
      ? 'verified proof'
      : resolvedStatus === 'stub'
        ? 'demo placeholder'
        : 'awaiting proof';
  const badgeClass =
    resolvedStatus === 'verified'
      ? 'bg-cred-900/20 border-cred-800/30 text-cred-400'
      : 'bg-amber-900/20 border-amber-800/30 text-amber-400';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${badgeClass}`}>
      <ShieldCheck size={14} className="flex-shrink-0" />
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider">{title}</div>
        <div className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
          {subtitle}: {hash ? hash.slice(0, 24) + '…' : 'not available'}
        </div>
      </div>
    </div>
  );
}

function ProofField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/50 p-2.5">
      <div className="text-[9px] text-gray-500 uppercase tracking-widest">{label}</div>
      <div className="mt-1 break-all font-mono text-[10px] text-gray-300">
        {value || 'n/a'}
      </div>
    </div>
  );
}

function ProofDetails({ result }: { result: CreditResult }) {
  if (!result.zk_proof_hash) return null;

  return (
    <div className="mt-4 rounded-xl border border-white/[0.05] bg-surface-2/30 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-200">Proof Details</div>
          <div className="text-[11px] text-gray-500">
            {result.zk_proof_status === 'verified'
              ? 'Real proof verified by the API'
              : 'Proof metadata unavailable'}
          </div>
        </div>
        <div className="rounded-full border border-cred-700/40 bg-cred-900/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cred-300">
          {result.zk_proof_scheme || 'unknown'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <ProofField label="Proof Hash" value={result.zk_proof_hash} />
        <ProofField label="Statement Hash" value={result.zk_proof?.statement_hash} />
        <ProofField label="Features Hash" value={result.zk_proof?.features_hash} />
        <ProofField label="Commitment" value={result.zk_proof?.commitment} />
      </div>
    </div>
  );
}

export default function CreditExplorer({ onResult }: { onResult?: (result: CreditResult) => void }) {
  const { score: fetchScore, result, loading, error } = useCreditScore();
  const [address, setAddress] = useState('');
  const [cluster, setCluster] = useState<'devnet' | 'mainnet-beta'>('devnet');

  const handleScore = async () => {
    if (address.length < 32) return;
    const scored = await fetchScore(address, cluster);
    if (scored && onResult) onResult(scored);
  };

  const radarData = result?.components
    ? Object.entries(result.components).map(([key, value]) => ({
        label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: Math.round(Number(value) * 100),
      }))
    : [];

  return (
    <div className="glass p-6">
      <h2 className="text-base font-semibold text-gray-100 mb-4">Credit score explorer</h2>

      {/* Search bar */}
      <div className="flex gap-2 mb-6">
        <select
          value={cluster}
          onChange={e => setCluster(e.target.value as 'devnet' | 'mainnet-beta')}
          className="rounded-xl bg-surface-2 border border-white/[0.04] px-3 py-2.5 text-sm text-gray-200 outline-none transition-all focus:border-cred-600/30 focus:ring-1 focus:ring-cred-600/50"
        >
          <option value="devnet">Devnet</option>
          <option value="mainnet-beta">Mainnet</option>
        </select>
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={address} onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScore()}
            placeholder="Enter Solana wallet address…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface-2 border border-white/[0.04] text-sm text-gray-200 placeholder:text-gray-600 focus:ring-1 focus:ring-cred-600/50 focus:border-cred-600/30 outline-none transition-all" />
        </div>
        <button onClick={handleScore} disabled={loading || address.length < 32}
          className="px-5 py-2.5 rounded-xl bg-cred-600 text-white text-sm font-medium hover:bg-cred-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2">
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? 'Scoring…' : 'Score'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-900/20 border border-red-800/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 animate-fade-up">
          {/* Left: Score gauge + tier + terms */}
          <div className="lg:col-span-2 flex flex-col items-center">
            <ScoreGauge score={result.score} tier={result.risk_tier} />

            <div className="flex items-center gap-2 mt-2 mb-4">
              <span className="px-3 py-1 rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: TIER_COLORS[result.risk_tier] || '#6b7280' }}>
                {result.risk_tier} Tier
              </span>
              <span className="text-xs text-gray-500">{result.confidence}% confidence</span>
            </div>

            {/* Recommended terms */}
            <div className="w-full grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'Max LTV', value: `${(result.recommended_terms.max_ltv_bps / 100)}%` },
                { label: 'Rate', value: `${(result.recommended_terms.rate_bps / 100).toFixed(1)}%` },
                { label: 'Max loan', value: `$${result.recommended_terms.max_loan_usd.toLocaleString()}` },
              ].map(t => (
                <div key={t.label} className="text-center rounded-lg bg-surface-2/60 p-2.5">
                  <div className="text-[9px] text-gray-500 uppercase tracking-widest">{t.label}</div>
                  <div className="text-sm font-semibold text-gray-200 mt-0.5">{t.value}</div>
                </div>
              ))}
            </div>

            <ZkBadge hash={result.zk_proof_hash} status={result.zk_proof_status} />
          </div>

          {/* Right: Radar chart */}
          <div className="lg:col-span-3">
            <div className="text-xs text-gray-500 font-medium mb-2">FICO component breakdown</div>
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={radarData} outerRadius="75%">
                <PolarGrid stroke="#222233" />
                <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Radar dataKey="value" stroke="#14c972" fill="#14c972" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>

            {/* Default probability */}
            <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2/40">
              <span className="text-xs text-gray-500">Default probability</span>
              <span className="text-sm font-mono font-semibold text-gray-300">
                {(result.default_probability * 100).toFixed(2)}%
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2/40">
              <span className="text-xs text-gray-500">Scoring cluster</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                {cluster === 'mainnet-beta' ? 'Mainnet' : 'Devnet'}
              </span>
            </div>

            <ProofDetails result={result} />
          </div>
        </div>
      )}
    </div>
  );
}
