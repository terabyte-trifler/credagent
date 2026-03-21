/**
 * @module CreditAssessmentAgent
 *
 * FIX AUDIT [P1 #1]:
 * - Now calls 'push_score_onchain' MCP tool to write score on-chain.
 * - Status is PUSHED only when the tool call succeeds.
 * - On tool failure → status is PUSH_FAILED (never false PUSHED).
 * - Cache only populated on confirmed push or explicit dryRun.
 * - dryRun mode clearly returns DRY_RUN and never calls on-chain tool.
 */

const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_SOL_FOR_TX = 10_000_000;
const MAX_BATCH_SIZE = 20;
const PUSH_COOLDOWN_MS = 60 * 60 * 1000;

export class CreditAssessmentAgent {
  #mcpBridge;
  #scoreCache = new Map();
  #pushTimestamps = new Map();
  #audit = [];

  constructor(mcpBridge) {
    if (!mcpBridge) throw new Error('CreditAssessmentAgent requires mcpBridge');
    this.#mcpBridge = mcpBridge;
  }

  async scoreBorrower(address, opts = {}) {
    const t0 = performance.now();

    // Validate address
    if (typeof address !== 'string' || !SOLANA_BASE58_RE.test(address)) {
      return this.#fail(address, 'INVALID_ADDRESS', 'Not valid Solana base58', t0);
    }

    // Staleness check
    if (!opts.forceFresh) {
      const cached = this.#checkStaleness(address);
      if (cached) {
        this.#log('CACHED', address, cached.score, cached.tier);
        return { status: 'CACHED', ...cached, durationMs: performance.now() - t0 };
      }
    }

    // Check SOL for tx fees
    try {
      const bal = await this.#mcpBridge.executeTool('get_balance', { agent_id: 'credit-agent' });
      if (bal.success && BigInt(bal.result?.lamports || '0') < BigInt(MIN_SOL_FOR_TX)) {
        return this.#fail(address, 'LOW_BALANCE', 'Agent needs >= 0.01 SOL for tx fees', t0);
      }
    } catch { /* non-fatal */ }

    // Compute score via ML API
    const scoreResult = await this.#mcpBridge.executeTool('compute_credit_score', { address });
    if (!scoreResult.success) {
      return this.#fail(address, 'ML_ERROR', scoreResult.error, t0);
    }
    const data = scoreResult.result;

    // Validate ML output
    if (!data.score || data.score < 300 || data.score > 850) {
      return this.#fail(address, 'INVALID_SCORE', `ML returned score=${data.score}`, t0);
    }
    if (data.confidence <= 0) {
      return this.#fail(address, 'ZERO_CONFIDENCE', 'ML model confidence is 0', t0);
    }

    // Push cooldown
    const lastPush = this.#pushTimestamps.get(address) || 0;
    if (Date.now() - lastPush < PUSH_COOLDOWN_MS && !opts.forceFresh) {
      return this.#fail(address, 'COOLDOWN', 'Score pushed < 1h ago', t0);
    }

    // ZK proof stub hash
    const zkProofHash = await this.#generateZkProofHash(
      address, data.score, Date.now(), data.model_hash, data.features || {},
    );
    const zkHex = this.#bytesToHex(zkProofHash);

    // ══════════════════════════════════════════════════════════
    // PUSH ON-CHAIN — the actual oracle update [FIX P1 #1]
    //
    // dryRun → skip, return DRY_RUN
    // live   → call push_score_onchain tool; PUSHED only on success
    // ══════════════════════════════════════════════════════════
    let pushStatus, pushTxHash = null, pushError = null;

    if (opts.dryRun) {
      pushStatus = 'DRY_RUN';
    } else {
      const pushResult = await this.#mcpBridge.executeTool('push_score_onchain', {
        agent_id: 'credit-agent',
        borrower: address,
        score: data.score,
        confidence: data.confidence,
        model_hash: data.model_hash,
        zk_proof_hash: zkHex,
      });

      if (pushResult.success) {
        pushStatus = 'PUSHED';
        pushTxHash = pushResult.result?.txHash || pushResult.result?.tx_hash || null;
        this.#pushTimestamps.set(address, Date.now());
      } else {
        pushStatus = 'PUSH_FAILED';
        pushError = pushResult.error;
        // AUDIT: Do NOT set push timestamp — nothing was published
      }
    }

    const result = {
      status: pushStatus,
      address,
      score: data.score,
      tier: data.risk_tier,
      tierNum: data.risk_tier_num,
      confidence: data.confidence,
      defaultProbability: data.default_probability,
      modelHash: data.model_hash,
      zkProofHash: zkHex,
      recommendedTerms: data.recommended_terms,
      components: data.components,
      txHash: pushTxHash,
      timestamp: Date.now(),
      durationMs: performance.now() - t0,
    };
    if (pushError) result.pushError = pushError;

    // AUDIT: Only cache on confirmed push or explicit dry run
    if (pushStatus === 'PUSHED' || pushStatus === 'DRY_RUN') {
      this.#scoreCache.set(address, {
        score: data.score, tier: data.risk_tier, tierNum: data.risk_tier_num,
        confidence: data.confidence, timestamp: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        onChain: pushStatus === 'PUSHED',
      });
    }

    this.#log(pushStatus, address, result.score, result.tier, pushError || '');
    return result;
  }

  async batchScore(addresses, opts = {}) {
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('batchScore requires non-empty array');
    if (addresses.length > MAX_BATCH_SIZE) throw new Error(`Batch size ${addresses.length} exceeds max ${MAX_BATCH_SIZE}`);

    const results = [];
    let scored = 0, cached = 0, failed = 0;
    for (const addr of addresses) {
      const r = await this.scoreBorrower(addr, opts);
      results.push(r);
      if (r.status === 'PUSHED' || r.status === 'DRY_RUN') scored++;
      else if (r.status === 'CACHED') cached++;
      else failed++;
      await new Promise(r => setTimeout(r, 200));
    }
    return { results, summary: { total: addresses.length, scored, cached, failed } };
  }

  #checkStaleness(address) {
    const c = this.#scoreCache.get(address);
    if (!c) return null;
    const now = Date.now();
    if (c.expiresAt < now || now - c.timestamp > STALENESS_WINDOW_MS) return null;
    return c;
  }

  async #generateZkProofHash(address, score, timestamp, modelHash, features) {
    const enc = new TextEncoder();
    const parts = [
      enc.encode(address),
      new Uint8Array(new Uint16Array([score]).buffer),
      new Uint8Array(new BigInt64Array([BigInt(Math.floor(timestamp / 1000))]).buffer),
      this.#hexToBytes(modelHash || '0'.repeat(64)),
      new Uint8Array(await crypto.subtle.digest('SHA-256',
        enc.encode(JSON.stringify(features, Object.keys(features).sort())))),
    ];
    const total = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) { total.set(p, off); off += p.length; }
    return new Uint8Array(await crypto.subtle.digest('SHA-256', total));
  }

  #fail(address, status, reason, t0) {
    this.#log(status, address || '(null)', 0, 'N/A', reason);
    return { status, address, score: 0, tier: 'N/A', tierNum: -1, confidence: 0, error: reason, durationMs: performance.now() - t0 };
  }

  #log(status, address, score, tier, detail = '') {
    this.#audit.push({ ts: new Date().toISOString(), agent: 'credit-agent', status, address: String(address).slice(0, 8) + '...', score, tier, detail });
  }

  #bytesToHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
  #hexToBytes(h) { const b = new Uint8Array(32); if (h.length === 64) for (let i = 0; i < 32; i++) b[i] = parseInt(h.slice(i*2, i*2+2), 16); return b; }

  getAuditLog(n = 50) { return this.#audit.slice(-n); }
  getCachedScore(a) { return this.#scoreCache.get(a) || null; }
}

export default CreditAssessmentAgent;