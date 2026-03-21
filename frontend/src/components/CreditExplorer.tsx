/**
 * Screen 2: Credit Score Explorer
 * Input address → display score gauge, risk tier, component breakdown radar.
 */
import React, { useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from 'recharts';
import { Search, ShieldCheck } from 'lucide-react';

const TIER_COLORS = { AAA: '#1ABC9C', AA: '#3498DB', A: '#F39C12', BB: '#E67E22', C: '#E74C3C' };

export default function CreditExplorer({ onScore }) {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleScore = async () => {
    if (!address || address.length < 32) return;
    setLoading(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_ML_API_URL || 'http://localhost:5001'}/score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await resp.json();
      setResult(data);
      onScore?.(data);
    } catch (e) {
      console.error('Score failed:', e);
    }
    setLoading(false);
  };

  const radarData = result?.components
    ? Object.entries(result.components).map(([key, value]) => ({
        subject: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        score: Math.round(value * 100),
      }))
    : [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-6">
      <h2 className="font-semibold text-lg mb-4 text-gray-900 dark:text-gray-100">Credit score explorer</h2>

      {/* Search bar */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Enter Solana address..." value={address}
            onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScore()}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none" />
        </div>
        <button onClick={handleScore} disabled={loading}
          className="px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors">
          {loading ? 'Scoring...' : 'Score'}
        </button>
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Score gauge */}
          <div className="flex flex-col items-center justify-center p-6 rounded-xl bg-gray-50 dark:bg-gray-900">
            <div className="text-6xl font-bold" style={{ color: TIER_COLORS[result.risk_tier] || '#888' }}>
              {result.score}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: TIER_COLORS[result.risk_tier] || '#888' }}>
                {result.risk_tier} Tier
              </span>
              <span className="text-xs text-gray-500">{result.confidence}% confidence</span>
            </div>
            <div className="mt-4 text-xs text-gray-400">
              Range: 300 (poor) — 850 (excellent)
            </div>
            {/* Terms */}
            {result.recommended_terms && (
              <div className="mt-4 grid grid-cols-3 gap-3 w-full text-center">
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Max LTV</div>
                  <div className="text-sm font-semibold">{(result.recommended_terms.max_ltv_bps / 100).toFixed(0)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Rate</div>
                  <div className="text-sm font-semibold">{(result.recommended_terms.rate_bps / 100).toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-400 uppercase">Max loan</div>
                  <div className="text-sm font-semibold">${result.recommended_terms.max_loan_usd?.toLocaleString()}</div>
                </div>
              </div>
            )}
          </div>

          {/* Radar chart */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Component breakdown</h3>
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Radar dataKey="score" stroke="#1ABC9C" fill="#1ABC9C" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
