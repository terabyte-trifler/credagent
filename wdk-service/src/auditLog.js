/**
 * @module AuditLog
 * @description Append-only operation log for all WDK service calls.
 *
 * SECURITY:
 * - Every entry sanitized: seed, seedPhrase, privateKey, secret, keyPair stripped
 * - Bounded memory: auto-prunes to half capacity when max exceeded
 * - Entries are frozen (immutable) after creation
 * - Includes hash chain for tamper evidence (each entry hashes the previous)
 */

const SENSITIVE_KEYS = new Set([
  'seed', 'seedPhrase', 'seed_phrase', 'mnemonic',
  'privateKey', 'private_key', 'secret', 'keyPair',
  'key_pair', 'password', 'token', 'apiKey', 'api_key',
]);

export class AuditLog {
  #entries = [];
  #maxEntries;
  #lastHash = '0';

  constructor(maxEntries = 10_000) {
    this.#maxEntries = maxEntries;
  }

  /**
   * Log an operation.
   * @param {string} operation
   * @param {string} agentId
   * @param {object} params — will be sanitized
   * @param {string|null} resultSummary
   * @param {number} durationMs
   * @param {'success'|'error'} [status='success']
   * @param {string|null} [errorMsg=null]
   */
  log(operation, agentId, params, resultSummary, durationMs, status = 'success', errorMsg = null) {
    const entry = Object.freeze({
      seq: this.#entries.length,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      operation,
      agentId,
      params: this.#sanitize(params),
      status,
      errorMsg,
      durationMs: Math.round(durationMs * 100) / 100,
      resultSummary: resultSummary ? String(resultSummary).slice(0, 200) : null,
      prevHash: this.#lastHash,
    });

    // Simple hash chain (not cryptographic, but detects tampering)
    this.#lastHash = this.#simpleHash(JSON.stringify(entry));

    this.#entries.push(entry);

    // AUDIT: Bound memory — prune oldest half when full
    if (this.#entries.length > this.#maxEntries) {
      this.#entries = this.#entries.slice(-Math.floor(this.#maxEntries / 2));
    }
  }

  /** Log an error. */
  logError(operation, agentId, params, error, durationMs) {
    this.log(operation, agentId, params, null, durationMs, 'error', error?.message ?? String(error));
  }

  /** Get most recent N entries. */
  getRecent(count = 50) {
    return this.#entries.slice(-Math.min(count, this.#entries.length));
  }

  /** Get all entries (for export). */
  getAll() {
    return [...this.#entries];
  }

  /** Total entry count. */
  get size() {
    return this.#entries.length;
  }

  // ─── Private ───────────────────────────

  /**
   * AUDIT: Deep-sanitize params object. Removes any key in SENSITIVE_KEYS.
   * Recursively checks nested objects (1 level deep to prevent abuse).
   */
  #sanitize(params) {
    if (!params || typeof params !== 'object') return params;
    const clean = {};
    for (const [k, v] of Object.entries(params)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // One level of nesting
        const inner = {};
        for (const [ik, iv] of Object.entries(v)) {
          if (!SENSITIVE_KEYS.has(ik)) inner[ik] = iv;
        }
        clean[k] = inner;
      } else {
        clean[k] = v;
      }
    }
    return Object.freeze(clean);
  }

  /** FNV-1a 32-bit hash for chain integrity. Not cryptographic. */
  #simpleHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}

export default AuditLog;