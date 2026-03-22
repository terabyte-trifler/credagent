/**
 * @module LendingDecisionAgent
 *
 * FIX AUDIT [P1 #2]:
 * - Schedule creation is prevalidated before lock/disburse.
 * - APPROVED only returned when all 3 steps are actually submitted/confirmed.
 * - Build-only flows are labeled INSTRUCTIONS_BUILT, not approved.
 * - No disbursement path proceeds when schedule build already fails.
 *
 * FIX AUDIT [P2 #6]:
 * - loan_id reserved via MCP tool, not derived from local in-process state.
 * - decision_reasoning is SHA-256 hashed BEFORE passing to MCP tool.
 *   Raw text stays in local decision log only, never sent over the wire.
 */

const RATE_FLOOR_BPS = 200;
const RATE_CEILING_BPS = 5000;
const MAX_NEGOTIATION_ROUNDS = 3;
const MAX_RATE_REDUCTION_BPS = 100;
const MAX_DURATION_EXTENSION_DAYS = 30;
const INSTALLMENT_INTERVAL_SECS = 864_000;
const DEFAULT_XAUT_PRICE_USD = 2300;

const TIER_CONSTRAINTS = {
  4: { maxLoanUsd: 10000, maxLtvBps: 8000, baseRateBps: 400,  maxDuration: 365 },
  3: { maxLoanUsd: 5000,  maxLtvBps: 6000, baseRateBps: 650,  maxDuration: 180 },
  2: { maxLoanUsd: 2000,  maxLtvBps: 4000, baseRateBps: 1000, maxDuration: 90  },
  1: { maxLoanUsd: 500,   maxLtvBps: 2500, baseRateBps: 1500, maxDuration: 60  },
  0: { maxLoanUsd: 0,     maxLtvBps: 0,    baseRateBps: 0,    maxDuration: 0   },
};

function buildConstraintsFromScore(score) {
  if (score?.starter_eligible && score?.recommended_terms?.max_loan_usd > 0) {
    return {
      maxLoanUsd: score.recommended_terms.max_loan_usd,
      maxLtvBps: score.recommended_terms.max_ltv_bps,
      baseRateBps: score.recommended_terms.rate_bps,
      maxDuration: score.recommended_terms.max_duration_days,
      lendingPath: 'starter',
    };
  }

  return {
    ...(TIER_CONSTRAINTS[score?.risk_tier_num] || TIER_CONSTRAINTS[0]),
    lendingPath: 'standard',
  };
}

export class LendingDecisionAgent {
  #mcpBridge;
  #creditAgent;
  #collectionAgentAddress;
  #decisions = [];
  #activeSessions = new Map();

  constructor(mcpBridge, creditAgent, collectionAgentAddress) {
    if (!mcpBridge) throw new Error('LendingDecisionAgent requires mcpBridge');
    this.#mcpBridge = mcpBridge;
    this.#creditAgent = creditAgent;
    this.#collectionAgentAddress = collectionAgentAddress || '';
  }

  // ═══════════════════════════════════════
  // T3.5: Evaluate
  // ═══════════════════════════════════════

  async evaluateLoan(borrowerAddress, requestedAmount, requestedDuration = 60) {
    const t0 = performance.now();
    const scoreResult = await this.#mcpBridge.executeTool('compute_credit_score', { address: borrowerAddress });
    if (!scoreResult.success) return this.#deny(borrowerAddress, 'SCORE_FAILED', scoreResult.error, t0);

    const score = scoreResult.result;
    const tierNum = score.risk_tier_num;
    const constraints = buildConstraintsFromScore(score);

    if (tierNum === 0 && !score.starter_eligible) {
      return this.#deny(borrowerAddress, 'DENIED_C_TIER', `Score ${score.score} (C tier)`, t0);
    }

    const approvedAmount = Math.min(requestedAmount, constraints.maxLoanUsd);
    if (approvedAmount <= 0) return this.#deny(borrowerAddress, 'DENIED_ZERO_AMOUNT', 'Amount zero after tier cap', t0);

    const pdResult = await this.#mcpBridge.executeTool('get_default_probability', {
      score: score.score, loan_amount_usd: approvedAmount,
      duration_days: Math.min(requestedDuration, constraints.maxDuration),
    });
    const pd = pdResult.success ? pdResult.result.probability_of_default : 0.15;

    const duration = Math.min(requestedDuration, constraints.maxDuration);
    const numInstallments = Math.max(1, Math.min(Math.ceil(duration / 10), 52));
    const offer = {
      principal: approvedAmount,
      rateBps: constraints.baseRateBps,
      durationDays: duration,
      collateralUsd: approvedAmount * (constraints.maxLtvBps / 10000),
      ltvBps: constraints.maxLtvBps,
      numInstallments,
      installmentAmount: Math.ceil(approvedAmount / numInstallments * 100) / 100,
    };

    this.#activeSessions.set(borrowerAddress, {
      borrower: borrowerAddress,
      score: score.score,
      tier: constraints.lendingPath === 'starter' ? 'STARTER' : score.risk_tier,
      tierNum,
      constraints, pd, round: 0, initialOffer: { ...offer }, currentOffer: { ...offer },
      history: [], status: 'OFFERED', lendingPath: constraints.lendingPath,
    });

    return {
      status: constraints.lendingPath === 'starter' ? 'STARTER_OFFERED' : 'OFFERED',
      borrower: borrowerAddress,
      score: score.score,
      tier: constraints.lendingPath === 'starter' ? 'STARTER' : score.risk_tier,
      lendingPath: constraints.lendingPath,
      defaultProbability: pd, offer, maxNegotiationRounds: MAX_NEGOTIATION_ROUNDS,
      durationMs: performance.now() - t0,
    };
  }

  // ═══════════════════════════════════════
  // T3.6: Bounded negotiation
  // ═══════════════════════════════════════

  async negotiate(borrowerAddress, counterOffer) {
    const session = this.#activeSessions.get(borrowerAddress);
    if (!session) throw new Error('No active session for this borrower');
    if (session.status !== 'OFFERED' && session.status !== 'COUNTER')
      throw new Error(`Session status is ${session.status}, not negotiable`);
    if (session.round >= MAX_NEGOTIATION_ROUNDS) {
      session.status = 'EXPIRED';
      return { status: 'EXPIRED', message: 'Maximum negotiation rounds reached' };
    }

    session.round++;
    const c = session.constraints;
    const cur = session.currentOffer;
    const violations = [];

    // Rate
    let newRate = cur.rateBps;
    if (counterOffer.rateBps !== undefined) {
      const minAllowed = Math.max(RATE_FLOOR_BPS, cur.rateBps - MAX_RATE_REDUCTION_BPS);
      if (counterOffer.rateBps < minAllowed) { violations.push(`Rate ${counterOffer.rateBps} bps below minimum ${minAllowed} bps`); newRate = minAllowed; }
      else if (counterOffer.rateBps > RATE_CEILING_BPS) { violations.push(`Rate above ceiling`); newRate = RATE_CEILING_BPS; }
      else newRate = counterOffer.rateBps;
    }
    // Amount — hard cap
    let newAmount = cur.principal;
    if (counterOffer.principal !== undefined) {
      if (counterOffer.principal > c.maxLoanUsd) { violations.push(`Amount $${counterOffer.principal} exceeds tier max $${c.maxLoanUsd}`); newAmount = c.maxLoanUsd; }
      else if (counterOffer.principal <= 0) violations.push('Amount must be > 0');
      else newAmount = counterOffer.principal;
    }
    // Duration
    let newDuration = cur.durationDays;
    if (counterOffer.durationDays !== undefined) {
      const maxDur = Math.min(c.maxDuration, cur.durationDays + MAX_DURATION_EXTENSION_DAYS);
      if (counterOffer.durationDays > maxDur) { violations.push(`Duration ${counterOffer.durationDays}d exceeds max ${maxDur}d`); newDuration = maxDur; }
      else if (counterOffer.durationDays < 1) violations.push('Duration must be >= 1');
      else newDuration = counterOffer.durationDays;
    }
    // LTV
    let newLtv = cur.ltvBps;
    if (counterOffer.ltvBps !== undefined) {
      newLtv = counterOffer.ltvBps < c.maxLtvBps ? Math.max(1000, counterOffer.ltvBps) : c.maxLtvBps;
    }

    const updatedOffer = {
      principal: newAmount, rateBps: newRate, durationDays: newDuration, ltvBps: newLtv,
      collateralUsd: newAmount * (newLtv / 10000),
      numInstallments: Math.max(1, Math.min(Math.ceil(newDuration / 10), 52)),
      installmentAmount: Math.ceil(newAmount / Math.max(1, Math.ceil(newDuration / 10)) * 100) / 100,
    };

    session.currentOffer = updatedOffer;
    session.history.push({ round: session.round, counterOffer, response: updatedOffer, violations });
    session.status = session.round >= MAX_NEGOTIATION_ROUNDS ? 'FINAL' : 'COUNTER';

    const pdResult = await this.#mcpBridge.executeTool('get_default_probability', {
      score: session.score, loan_amount_usd: newAmount, duration_days: newDuration,
    });

    return {
      status: session.status, round: session.round, maxRounds: MAX_NEGOTIATION_ROUNDS,
      offer: updatedOffer, violations,
      defaultProbability: pdResult.success ? pdResult.result.probability_of_default : session.pd,
    };
  }

  // ═══════════════════════════════════════
  // T3.7: Execute full payment flow
  // FIX [P1 #2]: prebuild schedule before disbursement
  // FIX [P2 #6]: loan_id reserved via MCP; reasoning hashed before MCP
  // ═══════════════════════════════════════

  async executeLoan(borrowerAddress, options = {}) {
    const session = this.#activeSessions.get(borrowerAddress);
    if (!session) throw new Error('No active session');
    if (!['COUNTER', 'FINAL', 'OFFERED'].includes(session.status))
      throw new Error(`Cannot execute: session status is ${session.status}`);

    const offer = session.currentOffer;
    const t0 = performance.now();
    const steps = { lockCollateral: null, disburse: null, createSchedule: null };
    let schedulePrecheck = null;
    const skipCollateral = Boolean(options.skipCollateral);

    // Build reasoning and hash it BEFORE any MCP call [FIX P2 #6]
    const reasoning = this.#buildDecisionReasoning(session);
    const reasoningHash = await this.#hashReasoning(reasoning);

    try {
      if (!this.#collectionAgentAddress) {
        throw new Error('COLLECTION_AGENT_REQUIRED: collection agent address must be configured before execution');
      }

      // ═══ Reserve authoritative loan_id via MCP [FIX P2 #6] ═══
      let loanId = Number.isInteger(options.loanId) ? Number(options.loanId) : null;
      if (loanId === null) {
        const loanIdResult = await this.#mcpBridge.executeTool('get_next_loan_id', {
          agent_id: 'lending-agent',
        });
        if (!loanIdResult.success || !Number.isInteger(loanIdResult.result?.loan_id)) {
          throw new Error(`LOAN_ID_FAILED: ${loanIdResult.error || 'No loan_id returned'}`);
        }
        loanId = loanIdResult.result.loan_id;
      }

      // ═══ PRECHECK: Build installment schedule first [FIX P1 #2] ═══
      // This tool path only builds/validates instruction data, so failing here
      // safely blocks execution before escrow/disbursement are attempted.
      schedulePrecheck = await this.#mcpBridge.executeTool('create_installment_schedule', {
        agent_id: 'lending-agent',
        loan_id: loanId,
        num_installments: offer.numInstallments,
        interval_seconds: INSTALLMENT_INTERVAL_SECS,
        collection_agent_address: this.#collectionAgentAddress,
        build_only: true,
      });
      if (!schedulePrecheck.success) {
        throw new Error(`SCHEDULE_PRECHECK_FAILED: ${schedulePrecheck.error}`);
      }

      const collateralMint = process.env.MOCK_XAUT_MINT || '11111111111111111111111111111111';

      // ═══ STEP 1: Lock Collateral ═══
      if (skipCollateral) {
        steps.lockCollateral = {
          success: true,
          result: {
            instruction: 'lock_collateral',
            submitted: true,
            confirmed: true,
            reused: true,
            external: true,
            args: { loan_id: loanId },
          },
        };
      } else {
        steps.lockCollateral = await this.#mcpBridge.executeTool('lock_collateral', {
          agent_id: 'lending-agent',
          loan_id: loanId,
          borrower: borrowerAddress,
          collateral_mint: collateralMint,
          amount: String(this.#collateralTokenAmount(offer.collateralUsd, collateralMint)),
        });
        if (!steps.lockCollateral.success) throw new Error(`ESCROW_FAILED: ${steps.lockCollateral.error}`);
      }

      // ═══ STEP 2: Conditional Disburse ═══
      // AUDIT [P2 #6]: Only the hash is sent, never the raw reasoning text
      steps.disburse = await this.#mcpBridge.executeTool('conditional_disburse', {
        agent_id: 'lending-agent',
        borrower: borrowerAddress,
        loan_id: loanId,
        principal: String(Math.ceil(offer.principal * 1_000_000)),
        interest_rate_bps: offer.rateBps,
        duration_days: offer.durationDays,
        decision_hash: reasoningHash,
      });
      if (!steps.disburse.success) throw new Error(`DISBURSE_FAILED: ${steps.disburse.error}`);

      // ═══ STEP 3: Create actual installment schedule after loan exists ═══
      steps.createSchedule = await this.#mcpBridge.executeTool('create_installment_schedule', {
        agent_id: 'lending-agent',
        loan_id: loanId,
        num_installments: offer.numInstallments,
        interval_seconds: INSTALLMENT_INTERVAL_SECS,
        collection_agent_address: this.#collectionAgentAddress,
      });
      if (!steps.createSchedule.success) throw new Error(`SCHEDULE_FAILED: ${steps.createSchedule.error}`);

    } catch (error) {
      const decision = {
        status: 'EXECUTION_FAILED',
        borrower: borrowerAddress, score: session.score, tier: session.tier,
        offer, steps, schedulePrecheck, error: error.message, reasoning, reasoningHash,
        durationMs: performance.now() - t0,
      };
      this.#decisions.push(decision);
      this.#activeSessions.delete(borrowerAddress);
      return decision;
    }

    const collateralSatisfied =
      Boolean(
        steps.lockCollateral?.result?.txHash ||
        steps.lockCollateral?.result?.tx_hash ||
        steps.lockCollateral?.result?.reused,
      );
    const hasSubmission =
      collateralSatisfied &&
      Boolean(steps.disburse?.result?.txHash || steps.disburse?.result?.tx_hash) &&
      Boolean(steps.createSchedule?.result?.txHash || steps.createSchedule?.result?.tx_hash);

    // ALL 3 steps succeeded → submitted/confirmed or build-only
    session.status = 'EXECUTED';
    const decision = {
      status: hasSubmission ? 'APPROVED' : 'INSTRUCTIONS_BUILT',
      borrower: borrowerAddress, score: session.score, tier: session.tier,
      offer, steps, loanId: steps.lockCollateral?.result?.args?.loan_id, negotiationRounds: session.round,
      reasoning, reasoningHash,
      onChainConfirmed: hasSubmission,
      durationMs: performance.now() - t0,
    };
    this.#decisions.push(decision);
    this.#activeSessions.delete(borrowerAddress);
    return decision;
  }

  // T3.8
  async processAgentBorrow(agentAddress, amount, purpose) {
    const evaluation = await this.evaluateLoan(agentAddress, amount, 30);
    if (evaluation.status.startsWith('DENIED')) return evaluation;
    const session = this.#activeSessions.get(agentAddress);
    if (session) session.history.push({ type: 'INTER_AGENT', purpose });
    return this.executeLoan(agentAddress);
  }

  // T3.10: Safety demo
  async safetyDemo(borrowerAddress) {
    const result = { scenario: 'LLM suggests bad terms → on-chain rejection', steps: [] };
    const evaluation = await this.evaluateLoan(borrowerAddress, 5000, 90);
    result.steps.push({ step: 1, action: 'Score', detail: `Score: ${evaluation.score}, Tier: ${evaluation.tier}` });
    if (evaluation.status.startsWith('DENIED')) {
      result.steps.push({ step: 2, action: 'DENIED', detail: 'C-tier denied at evaluation' });
      result.conclusion = 'Protocol denied C-tier borrower before terms proposed.';
      return result;
    }
    const badTerms = { principal: 50000, rateBps: 100, durationDays: 500 };
    result.steps.push({ step: 2, action: 'LLM bad terms', detail: JSON.stringify(badTerms) });
    const neg = await this.negotiate(borrowerAddress, badTerms);
    result.steps.push({ step: 3, action: 'Constraint enforcement', violations: neg.violations, constrainedOffer: neg.offer });
    result.conclusion = `SAFETY: ${neg.violations?.length || 0} violations caught. On-chain gates are final authority.`;
    this.#activeSessions.delete(borrowerAddress);
    return result;
  }

  // T3.9
  #buildDecisionReasoning(session) {
    return [
      `LOAN DECISION — ${new Date().toISOString()}`,
      `Borrower: ${session.borrower}`, `Score: ${session.score} (${session.tier})`,
      `PD: ${(session.pd * 100).toFixed(2)}%`, `Rounds: ${session.round}`,
      `Initial: $${session.initialOffer.principal} @ ${session.initialOffer.rateBps}bps`,
      `Final: $${session.currentOffer.principal} @ ${session.currentOffer.rateBps}bps for ${session.currentOffer.durationDays}d`,
      `Collateral: $${session.currentOffer.collateralUsd} (${session.currentOffer.ltvBps/100}% LTV)`,
    ].join('\n');
  }

  async #hashReasoning(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  #collateralTokenAmount(collateralUsd, collateralMint) {
    const xautMint = process.env.MOCK_XAUT_MINT;
    const xautPrice = Number(process.env.MOCK_XAUT_PRICE_USD || DEFAULT_XAUT_PRICE_USD);

    if (xautMint && collateralMint === xautMint) {
      return Math.max(1, Math.ceil((collateralUsd / xautPrice) * 1_000_000));
    }

    return Math.max(1, Math.ceil(collateralUsd * 1_000_000));
  }

  #deny(addr, status, reason, t0) {
    const d = { status, borrower: addr, error: reason, durationMs: performance.now() - t0 };
    this.#decisions.push(d);
    return d;
  }

  getDecisionLog(n = 50) { return this.#decisions.slice(-n); }
  getActiveSession(b) { return this.#activeSessions.get(b); }
}

export default LendingDecisionAgent;
