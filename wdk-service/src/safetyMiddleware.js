/**
 * @module SafetyMiddleware
 * JS-side safety layer wrapping the MCP bridge.
 *
 * ARCHITECTURE:
 *   Agent -> SafetyMiddleware -> MCPBridge -> WDK
 *
 * The on-chain programs remain the source of truth. This layer adds
 * fast-fail checks to reduce wasted fees and keep agent behavior aligned
 * with the protocol's safety model.
 */

const TIERS = { READ: 0, OPERATE: 1, MANAGE: 2, ADMIN: 3 };

const TOOL_TIER_MAP = {
  get_balance: TIERS.READ,
  compute_credit_score: TIERS.READ,
  check_eligibility: TIERS.READ,
  get_default_probability: TIERS.READ,

  send_sol: TIERS.OPERATE,
  send_token: TIERS.OPERATE,
  pull_installment: TIERS.OPERATE,
  push_score_onchain: TIERS.OPERATE,
  send_notification: TIERS.OPERATE,

  lock_collateral: TIERS.MANAGE,
  conditional_disburse: TIERS.MANAGE,
  create_installment_schedule: TIERS.MANAGE,
  bridge_usdt0: TIERS.MANAGE,
  mark_default: TIERS.MANAGE,
  liquidate_escrow: TIERS.MANAGE,
  record_loan_defaulted: TIERS.MANAGE,

  create_wallet: TIERS.ADMIN,
  emergency_pause: TIERS.ADMIN,
  unpause: TIERS.ADMIN,
  register_agent: TIERS.ADMIN,
  deactivate_agent: TIERS.ADMIN,
  set_daily_limit: TIERS.ADMIN,
  request_admin_rotation: TIERS.ADMIN,
  finalize_admin_rotation: TIERS.ADMIN,
  reset_circuit_breaker: TIERS.ADMIN,
};

const BLOCKED_WHEN_PAUSED = new Set([
  'conditional_disburse',
  'lock_collateral',
  'create_installment_schedule',
  'pull_installment',
  'bridge_usdt0',
  'push_score_onchain',
]);

const CIRCUIT_BREAKER_LOSS_BPS = 1000;
const CIRCUIT_BREAKER_WINDOW_MS = 24 * 60 * 60 * 1000;

export class SafetyMiddleware {
  #mcpBridge;
  #agentTiers = new Map();
  #agentLimits = new Map();
  #isPaused = false;
  #circuitBreakerActive = false;
  #losses24h = 0n;
  #depositsSnapshot = 0n;
  #snapshotTime = Date.now();
  #audit = [];

  constructor(mcpBridge, config = {}) {
    if (!mcpBridge || typeof mcpBridge.executeTool !== 'function') {
      throw new Error('SafetyMiddleware requires an mcpBridge with executeTool()');
    }

    this.#mcpBridge = mcpBridge;

    if (config.agentTiers) {
      for (const [agentId, tier] of Object.entries(config.agentTiers)) {
        this.registerAgentTier(agentId, tier);
      }
    }
  }

  async executeTool(toolName, params = {}) {
    const agentId = params.agent_id || 'anonymous';
    const t0 = performance.now();

    try {
      if (this.#isPaused || this.#circuitBreakerActive) {
        if (BLOCKED_WHEN_PAUSED.has(toolName)) {
          const reason = this.#circuitBreakerActive
            ? 'Circuit breaker active: pool losses exceeded 10% in 24h'
            : 'System paused by admin';
          this.#logBlock(toolName, agentId, reason, t0);
          return { success: false, error: `PAUSED: ${reason}`, blocked: true };
        }
      }

      const requiredTier = TOOL_TIER_MAP[toolName];
      if (requiredTier !== undefined) {
        const agentTier = this.#agentTiers.get(agentId);
        if (agentTier === undefined) {
          if (requiredTier > TIERS.READ) {
            this.#logBlock(toolName, agentId, `Unknown agent, needs tier ${requiredTier}`, t0);
            return {
              success: false,
              error: `TIER_CHECK: Agent "${agentId}" not registered`,
              blocked: true,
            };
          }
        } else if (agentTier < requiredTier) {
          this.#logBlock(toolName, agentId, `Tier ${agentTier} < required ${requiredTier}`, t0);
          return {
            success: false,
            error: `INSUFFICIENT_TIER: Agent "${agentId}" has tier ${agentTier}, needs ${requiredTier} for ${toolName}`,
            blocked: true,
          };
        }
      }

      if (toolName === 'conditional_disburse' && params.principal) {
        const amount = BigInt(params.principal);
        const limitState = this.#agentLimits.get(agentId);
        if (limitState) {
          this.#resetLimitIfNeeded(limitState);
          const newSpent = limitState.dailySpent + amount;
          if (newSpent > limitState.dailyLimit) {
            this.#logBlock(toolName, agentId, `Daily limit exceeded`, t0);
            return {
              success: false,
              error: `LIMIT_EXCEEDED: Would spend ${newSpent}, limit is ${limitState.dailyLimit}`,
              blocked: true,
            };
          }
        }
      }

      const result = await this.#mcpBridge.executeTool(toolName, params);

      if (result.success && toolName === 'conditional_disburse' && params.principal) {
        const limitState = this.#agentLimits.get(agentId);
        if (limitState) {
          limitState.dailySpent += BigInt(params.principal);
        }
      }

      if (result.success && (toolName === 'mark_default' || toolName === 'liquidate_escrow')) {
        this.recordLoss(BigInt(params.outstanding || params.amount || '0'));
      }

      this.#logAllow(toolName, agentId, result.success, t0);
      return result;
    } catch (error) {
      this.#logBlock(toolName, agentId, `Exception: ${error.message}`, t0);
      return { success: false, error: error.message };
    }
  }

  registerAgentTier(agentId, tier) {
    if (tier < TIERS.READ || tier > TIERS.ADMIN) {
      throw new Error(`Invalid tier ${tier}, must be 0-3`);
    }
    this.#agentTiers.set(agentId, tier);
  }

  registerAgentLimit(agentId, dailyLimitRaw) {
    this.#agentLimits.set(agentId, {
      dailyLimit: BigInt(dailyLimitRaw),
      dailySpent: 0n,
      resetTime: Date.now() + 86_400_000,
    });
  }

  getAgentTier(agentId) {
    return this.#agentTiers.get(agentId) ?? null;
  }

  recordLoss(amount) {
    const now = Date.now();
    if (now - this.#snapshotTime > CIRCUIT_BREAKER_WINDOW_MS) {
      this.#losses24h = 0n;
      this.#snapshotTime = now;
    }
    this.#losses24h += BigInt(amount);

    if (this.#depositsSnapshot > 0n) {
      const lossBps = (this.#losses24h * 10000n) / this.#depositsSnapshot;
      if (lossBps >= BigInt(CIRCUIT_BREAKER_LOSS_BPS)) {
        this.#circuitBreakerActive = true;
        this.#isPaused = true;
        this.#audit.push({
          ts: new Date().toISOString(),
          event: 'CIRCUIT_BREAKER_TRIPPED',
          losses: this.#losses24h.toString(),
          deposits: this.#depositsSnapshot.toString(),
          lossBps: Number(lossBps),
        });
      }
    }
  }

  setDepositsSnapshot(amount) {
    this.#depositsSnapshot = BigInt(amount);
  }

  resetCircuitBreaker() {
    this.#circuitBreakerActive = false;
    this.#losses24h = 0n;
    this.#snapshotTime = Date.now();
  }

  pause() {
    this.#isPaused = true;
    this.#audit.push({ ts: new Date().toISOString(), event: 'PAUSED' });
  }

  unpause() {
    if (this.#circuitBreakerActive) {
      throw new Error('Cannot unpause while circuit breaker is active - reset it first');
    }
    this.#isPaused = false;
    this.#audit.push({ ts: new Date().toISOString(), event: 'UNPAUSED' });
  }

  get isPaused() {
    return this.#isPaused;
  }

  get isCircuitBreakerActive() {
    return this.#circuitBreakerActive;
  }

  getAuditLog(n = 50) {
    return this.#audit.slice(-n);
  }

  getToolTierMap() {
    return { ...TOOL_TIER_MAP };
  }

  getAgentLimitSnapshot(agentId) {
    const limitState = this.#agentLimits.get(agentId);
    if (!limitState) return null;
    this.#resetLimitIfNeeded(limitState);
    const usedPct = limitState.dailyLimit > 0n
      ? Number((limitState.dailySpent * 100n) / limitState.dailyLimit)
      : 0;
    return {
      dailyLimit: limitState.dailyLimit.toString(),
      dailySpent: limitState.dailySpent.toString(),
      usedPct,
      resetTime: limitState.resetTime,
    };
  }

  static get TIERS() {
    return { ...TIERS };
  }

  #resetLimitIfNeeded(limitState) {
    if (Date.now() >= limitState.resetTime) {
      limitState.dailySpent = 0n;
      limitState.resetTime = Date.now() + 86_400_000;
    }
  }

  #logBlock(tool, agent, reason, t0) {
    this.#audit.push({
      ts: new Date().toISOString(),
      event: 'BLOCKED',
      tool,
      agent,
      reason,
      durationMs: Math.round((performance.now() - t0) * 100) / 100,
    });
  }

  #logAllow(tool, agent, success, t0) {
    this.#audit.push({
      ts: new Date().toISOString(),
      event: success ? 'ALLOWED' : 'TOOL_FAILED',
      tool,
      agent,
      durationMs: Math.round((performance.now() - t0) * 100) / 100,
    });
  }
}

export default SafetyMiddleware;
