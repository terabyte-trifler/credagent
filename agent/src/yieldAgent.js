/**
 * @module YieldOptimizerAgent
 *
 * FIX AUDIT [P2 #4]:
 * - Bridge is hard-disabled unless real recipient and token addresses
 *   are configured via constructor or environment variables.
 * - Zero-address (0x000...0) detection added: bridge call throws before
 *   reaching MCP if either address is zero.
 * - Config.bridgeVaults maps chain → { recipient, tokenAddress }.
 */

const RATE_FLOOR_BPS = 200;
const RATE_CEILING_BPS = 5000;
const MAX_RATE_CHANGE_BPS = 200;
const ADJUSTMENT_COOLDOWN_MS = 60 * 60 * 1000;
const BRIDGE_MIN_AMOUNT_USD = 5000;
const BRIDGE_MAX_PCT = 30;
const BRIDGE_UTIL_THRESHOLD = 20;
const RECALL_UTIL_THRESHOLD = 60;

const ZERO_ADDRESS_EVM = /^0x0{40}$/;

const TARGET_YIELDS = {
  arbitrum: 0.06, polygon: 0.045, optimism: 0.05, ethereum: 0.035,
};

export class YieldOptimizerAgent {
  #mcpBridge;
  #lastAdjustment = 0;
  #currentRateBps = 650;
  #bridgedCapital = new Map();
  #bridgeVaults; // chain → { recipient, tokenAddress }
  #audit = [];

  /**
   * @param {object} mcpBridge
   * @param {object} [config]
   * @param {Record<string, {recipient: string, tokenAddress: string}>} [config.bridgeVaults]
   */
  constructor(mcpBridge, config = {}) {
    if (!mcpBridge) throw new Error('YieldOptimizerAgent requires mcpBridge');
    this.#mcpBridge = mcpBridge;

    // FIX [P2 #4]: Bridge vaults must be explicitly configured.
    // If not provided, bridging is hard-disabled at the agent level.
    this.#bridgeVaults = config.bridgeVaults || null;
  }

  // ═══════════════════════════════════════
  // T3.16: Dynamic Rate Adjustment
  // ═══════════════════════════════════════

  calculateOptimalRate(utilizationBps, baseRateBps = 650) {
    let rate, slope;
    if (utilizationBps < 4000) {
      rate = baseRateBps + Math.floor(utilizationBps * 0.5);
      slope = 'GENTLE';
    } else if (utilizationBps <= 8000) {
      rate = baseRateBps + 2000 + Math.floor((utilizationBps - 4000) * 1.5);
      slope = 'MODERATE';
    } else {
      rate = baseRateBps + 8000 + Math.floor((utilizationBps - 8000) * 5);
      slope = 'EMERGENCY';
    }
    rate = Math.max(RATE_FLOOR_BPS, Math.min(RATE_CEILING_BPS, rate));
    return { optimalRateBps: rate, slope };
  }

  async evaluateAndAdjust(poolState) {
    const { totalDeposited = 0, totalBorrowed = 0, baseRateBps = 650 } = poolState;
    const now = Date.now();
    const utilBps = totalDeposited > 0 ? Math.floor((totalBorrowed / totalDeposited) * 10000) : 0;
    const utilPct = (utilBps / 100).toFixed(1);
    const { optimalRateBps, slope } = this.calculateOptimalRate(utilBps, baseRateBps);

    const diff = Math.abs(optimalRateBps - this.#currentRateBps);
    if (diff < 50) return { action: 'HOLD', currentRateBps: this.#currentRateBps, optimalRateBps, utilization: utilPct + '%', slope };
    if (now - this.#lastAdjustment < ADJUSTMENT_COOLDOWN_MS) {
      return { action: 'COOLDOWN', currentRateBps: this.#currentRateBps, optimalRateBps, utilization: utilPct + '%',
        cooldownMinutes: Math.ceil((ADJUSTMENT_COOLDOWN_MS - (now - this.#lastAdjustment)) / 60000) };
    }

    const oldRate = this.#currentRateBps;
    let newRate = optimalRateBps > oldRate
      ? Math.min(oldRate + MAX_RATE_CHANGE_BPS, optimalRateBps)
      : Math.max(oldRate - MAX_RATE_CHANGE_BPS, optimalRateBps);
    newRate = Math.max(RATE_FLOOR_BPS, Math.min(RATE_CEILING_BPS, newRate));

    this.#currentRateBps = newRate;
    this.#lastAdjustment = now;
    this.#log('RATE_ADJUST', `${oldRate} → ${newRate} bps (util: ${utilPct}%, slope: ${slope})`);
    return { action: 'ADJUSTED', oldRateBps: oldRate, newRateBps: newRate, optimalRateBps, changeBps: newRate - oldRate, utilization: utilPct + '%', slope };
  }

  // ═══════════════════════════════════════
  // T3.17: Cross-Chain Bridging
  // FIX [P2 #4]: Hard-disable unless configured
  // ═══════════════════════════════════════

  async evaluateAndBridge(poolState, targetChain = 'arbitrum') {
    // ── HARD GATE: bridge disabled unless vault addresses configured [FIX P2 #4] ──
    if (!this.#bridgeVaults) {
      return {
        action: 'DISABLED',
        reason: 'Bridge vaults not configured. Set config.bridgeVaults with real recipient and token addresses.',
      };
    }

    const vault = this.#bridgeVaults[targetChain];
    if (!vault || !vault.recipient || !vault.tokenAddress) {
      return {
        action: 'DISABLED',
        reason: `No vault configured for chain "${targetChain}". Add to config.bridgeVaults.`,
      };
    }

    // ── ZERO-ADDRESS GUARD [FIX P2 #4] ──
    if (ZERO_ADDRESS_EVM.test(vault.recipient)) {
      return { action: 'BLOCKED', reason: 'Recipient is zero-address — fund-loss risk. Configure a real vault.' };
    }
    if (ZERO_ADDRESS_EVM.test(vault.tokenAddress)) {
      return { action: 'BLOCKED', reason: 'Token address is zero-address. Configure a real USDT contract address.' };
    }

    const { totalDeposited = 0, totalBorrowed = 0 } = poolState;
    const utilPct = totalDeposited > 0 ? (totalBorrowed / totalDeposited) * 100 : 0;
    const idle = totalDeposited - totalBorrowed;
    const currentYield = this.#currentRateBps / 10000;
    const targetYield = TARGET_YIELDS[targetChain] || 0;
    const netTargetYield = targetYield - 0.001;

    const checks = {
      utilizationBelowThreshold: utilPct < BRIDGE_UTIL_THRESHOLD,
      idleCapitalSufficient: idle >= BRIDGE_MIN_AMOUNT_USD,
      targetYieldBetter: netTargetYield > currentYield + 0.01,
      bridgeAmountValid: Math.min(idle * 0.3, totalDeposited * BRIDGE_MAX_PCT / 100) >= BRIDGE_MIN_AMOUNT_USD,
    };

    const allPassed = Object.values(checks).every(Boolean);
    if (!allPassed) {
      const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return { action: 'HOLD', targetChain, utilization: utilPct.toFixed(1) + '%', checks, failedChecks };
    }

    const bridgeAmount = Math.floor(Math.min(idle * 0.3, totalDeposited * BRIDGE_MAX_PCT / 100));

    const bridgeResult = await this.#mcpBridge.executeTool('bridge_usdt0', {
      target_chain: targetChain,
      recipient: vault.recipient,           // Real address, not zero [FIX P2 #4]
      token_address: vault.tokenAddress,    // Real address, not zero [FIX P2 #4]
      amount: String(bridgeAmount * 1_000_000),
    });

    if (!bridgeResult.success) {
      return { action: 'BRIDGE_FAILED', error: bridgeResult.error, targetChain, attemptedAmount: bridgeAmount };
    }

    this.#bridgedCapital.set(targetChain, { amount: bridgeAmount, timestamp: Date.now(), estimatedYield: targetYield });
    this.#log('BRIDGE', `$${bridgeAmount} USDT → ${targetChain} (yield: ${(targetYield*100).toFixed(1)}%)`);
    return {
      action: 'BRIDGED', targetChain, amount: bridgeAmount,
      utilization: utilPct.toFixed(1) + '%',
      currentYield: (currentYield * 100).toFixed(2) + '%',
      targetYield: (targetYield * 100).toFixed(2) + '%',
    };
  }

  async evaluateRecall(poolState) {
    const { totalDeposited = 0, totalBorrowed = 0 } = poolState;
    const utilPct = totalDeposited > 0 ? (totalBorrowed / totalDeposited) * 100 : 0;
    const recalls = [];
    if (utilPct > RECALL_UTIL_THRESHOLD) {
      for (const [chain, data] of this.#bridgedCapital) {
        recalls.push({ action: 'RECALL', chain, amount: data.amount, reason: `Utilization ${utilPct.toFixed(1)}% > ${RECALL_UTIL_THRESHOLD}%` });
        this.#log('RECALL', `$${data.amount} from ${chain}`);
        this.#bridgedCapital.delete(chain);
      }
    }
    return recalls.length > 0
      ? { action: 'RECALL', recalls }
      : { action: 'HOLD', utilization: utilPct.toFixed(1) + '%', bridgedChains: [...this.#bridgedCapital.keys()] };
  }

  generateHealthReport(poolState) {
    const { totalDeposited = 0, totalBorrowed = 0, interestEarned = 0, activeLoans = 0, totalDefaults = 0 } = poolState;
    const utilPct = totalDeposited > 0 ? (totalBorrowed / totalDeposited) * 100 : 0;
    const idle = totalDeposited - totalBorrowed;
    const { optimalRateBps, slope } = this.calculateOptimalRate(Math.floor(utilPct * 100), 650);
    const bridgedTotal = Array.from(this.#bridgedCapital.values()).reduce((s, d) => s + d.amount, 0);

    let recommendation;
    if (utilPct > 80) recommendation = 'RECALL';
    else if (utilPct < 20 && idle > BRIDGE_MIN_AMOUNT_USD && this.#bridgeVaults) recommendation = 'BRIDGE_OUT';
    else if (Math.abs(optimalRateBps - this.#currentRateBps) > 50) recommendation = 'ADJUST_RATE';
    else recommendation = 'HOLD';

    return {
      totalDeposited, totalBorrowed, idle,
      utilization: utilPct.toFixed(1) + '%',
      activeLoans, interestEarned,
      defaultRate: (totalDeposited > 0 ? (totalDefaults / totalDeposited) * 100 : 0).toFixed(2) + '%',
      currentRateBps: this.#currentRateBps, optimalRateBps, rateSlope: slope,
      bridgeConfigured: !!this.#bridgeVaults,
      bridgedCapital: Object.fromEntries(this.#bridgedCapital),
      bridgedTotal, recommendation,
    };
  }

  getCurrentRate() { return this.#currentRateBps; }
  getBridgedCapital() { return new Map(this.#bridgedCapital); }
  getAuditLog(n = 50) { return this.#audit.slice(-n); }

  #log(action, detail) {
    this.#audit.push({ ts: new Date().toISOString(), agent: 'yield-agent', action, detail });
  }
}

export default YieldOptimizerAgent;