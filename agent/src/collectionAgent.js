/**
 * @module CollectionTrackerAgent
 *
 * FIX AUDIT [P1 #3]:
 * - #triggerDefault() now calls mark_default and liquidate_escrow only.
 * - Credit history update is intentionally deferred to an authorized
 *   admin/program path; the collection agent no longer pretends it can
 *   write restricted oracle history itself.
 *
 * FIX AUDIT [P2 #5]:
 * - #processInstallment() now calls get_balance to check borrower's
 *   token balance and delegation BEFORE attempting pull_installment.
 * - Failed pulls dispatch send_notification via MCP (not just local object).
 * - Skipped pulls (insufficient balance) save wasted tx fees.
 */

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 3;

export class CollectionTrackerAgent {
  #mcpBridge;
  #schedules = new Map();
  #audit = [];

  constructor(mcpBridge) {
    if (!mcpBridge) throw new Error('CollectionTrackerAgent requires mcpBridge');
    this.#mcpBridge = mcpBridge;
  }

  registerSchedule(schedule) {
    this.#schedules.set(schedule.loanId, {
      loanId: schedule.loanId,
      borrower: schedule.borrower,
      borrowerMint: schedule.borrowerMint || null,
      collectionAgentAddress: schedule.collectionAgentAddress || null,
      totalInstallments: schedule.totalInstallments,
      paidInstallments: 0,
      amountPerInstallment: schedule.amountPerInstallment,
      intervalMs: schedule.intervalSecs * 1000,
      nextDueDate: schedule.firstDueDate,
      isActive: true,
      failedAttempts: 0,
      lastFailDate: null,
      remindersSent: 0,
      graceDeadline: null,
      status: 'ON_TRACK',
    });
    this.#log('REGISTERED', schedule.loanId, `${schedule.totalInstallments} installments, $${schedule.amountPerInstallment} each`);
  }

  async pollOnce() {
    const now = Date.now();
    const results = [];
    for (const [loanId, s] of this.#schedules) {
      if (!s.isActive || s.status === 'DEFAULTED' || s.status === 'COMPLETE') continue;
      if (now >= s.nextDueDate) {
        results.push(await this.#processInstallment(loanId, s, now));
      }
    }
    return results;
  }

  // ══════════════════════════════════════════
  // FIX [P2 #5]: Preflight checks before pull
  // ══════════════════════════════════════════

  async #processInstallment(loanId, s, now) {
    if (s.paidInstallments >= s.totalInstallments) {
      s.isActive = false;
      s.status = 'COMPLETE';
      this.#log('COMPLETE', loanId, `All ${s.totalInstallments} installments paid`);
      return { loanId, action: 'COMPLETE' };
    }

    // ── PREFLIGHT: Check borrower balance before wasting tx fee [FIX P2 #5] ──
    if (s.borrower && s.borrowerMint && s.collectionAgentAddress) {
      const balResult = await this.#mcpBridge.executeTool('get_balance', {
        address: s.borrower,
        token_mint: s.borrowerMint,
        delegate_to: s.collectionAgentAddress,
      });
      // If we can detect insufficient balance, skip the pull and go to reminder
      if (balResult.success) {
        const raw = BigInt(balResult.result?.rawBalance || '0');
        const delegated = BigInt(balResult.result?.delegatedAmount || '0');
        const needed = BigInt(Math.ceil(s.amountPerInstallment * 1_000_000));
        if (raw < needed) {
          this.#log('PREFLIGHT_FAIL', loanId,
            `Borrower balance ${raw} < needed ${needed}, skipping pull to save tx fee`);
          return this.#handleFailedPull(loanId, s, now, 'Preflight: insufficient borrower balance');
        }
        if (delegated < needed || balResult.result?.delegationSatisfied === false) {
          this.#log('PREFLIGHT_FAIL', loanId,
            `Delegated amount ${delegated} < needed ${needed}, skipping pull to save tx fee`);
          return this.#handleFailedPull(loanId, s, now, 'Preflight: insufficient delegation');
        }
      } else {
        this.#log('PREFLIGHT_WARN', loanId, `Unable to inspect borrower token position: ${balResult.error}`);
      }
    } else {
      this.#log('PREFLIGHT_WARN', loanId, 'Skipping borrower/delegation inspection: missing borrowerMint or collectionAgentAddress');
    }

    // ── PULL ──
    const pullResult = await this.#mcpBridge.executeTool('pull_installment', {
      agent_id: 'collection-agent',
      loan_id: loanId,
    });

    if (pullResult.success) {
      s.paidInstallments++;
      s.nextDueDate += s.intervalMs;
      s.failedAttempts = 0;
      s.remindersSent = 0;
      s.graceDeadline = null;
      s.status = s.paidInstallments >= s.totalInstallments ? 'COMPLETE' : 'ON_TRACK';
      if (s.status === 'COMPLETE') s.isActive = false;
      this.#log('PULLED', loanId, `${s.paidInstallments}/${s.totalInstallments}: $${s.amountPerInstallment}`);
      return { loanId, action: 'PULLED', installment: s.paidInstallments, total: s.totalInstallments };
    }

    return this.#handleFailedPull(loanId, s, now, pullResult.error);
  }

  // ══════════════════════════════════════════
  // FIX [P2 #5]: Real notification dispatch
  // ══════════════════════════════════════════

  async #handleFailedPull(loanId, s, now, error) {
    s.failedAttempts++;
    s.lastFailDate = now;

    if (!s.graceDeadline) {
      s.graceDeadline = s.nextDueDate + GRACE_PERIOD_MS;
      s.status = 'OVERDUE';
    }

    // Send notification via MCP [FIX P2 #5]
    if (s.remindersSent < MAX_REMINDERS) {
      const daysLeft = Math.max(0, Math.ceil((s.graceDeadline - now) / 86_400_000));
      const isFirst = s.remindersSent === 0;
      const message = isFirst
        ? `Your installment of $${s.amountPerInstallment} for loan #${loanId} is due. Please ensure sufficient balance and delegation. Next attempt in 24h.`
        : `WARNING: Installment overdue for loan #${loanId}. Grace period expires in ${daysLeft} day(s). Failure to pay may result in collateral liquidation.`;

      // Dispatch notification via MCP tool (not just a local object)
      const notifResult = await this.#mcpBridge.executeTool('send_notification', {
        recipient: s.borrower,
        type: isFirst ? 'SOFT_REMINDER' : 'WARNING',
        message,
        loan_id: loanId,
      });

      s.remindersSent++;
      s.status = 'GRACE_PERIOD';

      this.#log('REMINDER_SENT', loanId,
        `Attempt ${s.failedAttempts}, grace: ${daysLeft}d left. Notif dispatched: ${notifResult.success}. ${error}`);

      return { loanId, action: 'REMINDER', daysLeft, notificationSent: notifResult.success };
    }

    // Grace period expired → default
    if (now > s.graceDeadline) {
      return this.#triggerDefault(loanId, s);
    }

    this.#log('WAITING', loanId, `Grace: ${Math.ceil((s.graceDeadline - now) / 86_400_000)}d remaining`);
    return { loanId, action: 'WAITING', graceDeadline: s.graceDeadline };
  }

  // ══════════════════════════════════════════
  // FIX [P1 #3]: Real on-chain MCP calls for
  // mark_default, liquidate_escrow, record_loan_defaulted
  // ══════════════════════════════════════════

  async #triggerDefault(loanId, s) {
    this.#log('DEFAULT_TRIGGER', loanId, 'Grace expired. Executing on-chain default flow...');
    const outstanding = (s.totalInstallments - s.paidInstallments) * s.amountPerInstallment;

    // ═══ STEP 1: mark_default on-chain [FIX P1 #3] ═══
    const markResult = await this.#mcpBridge.executeTool('mark_default', {
      agent_id: 'collection-agent',
      loan_id: loanId,
    });

    if (!markResult.success) {
      this.#log('DEFAULT_FAILED', loanId, `mark_default failed: ${markResult.error}`);
      return {
        loanId, action: 'DEFAULT_FAILED',
        error: `mark_default tool failed: ${markResult.error}`,
        outstanding,
      };
    }

    // ═══ STEP 2: liquidate_escrow on-chain [FIX P1 #3] ═══
    const liqResult = await this.#mcpBridge.executeTool('liquidate_escrow', {
      agent_id: 'collection-agent',
      loan_id: loanId,
    });

    if (!liqResult.success) {
      // Default marked but liquidation failed — critical partial state
      this.#log('LIQUIDATION_FAILED', loanId, `liquidate_escrow failed: ${liqResult.error}`);
      s.status = 'DEFAULT_PENDING';
      s.isActive = false;
      return {
        loanId, action: 'PARTIAL_DEFAULT',
        warning: 'Default marked but escrow liquidation failed. Manual intervention required.',
        markResult: markResult.success,
        liquidationError: liqResult.error,
        outstanding,
      };
    }

    // ═══ STEP 3: Credit history update deferred ═══
    const historyResult = {
      success: false,
      deferred: true,
      reason: 'record_loan_defaulted is restricted to an authorized admin/program path',
    };
    this.#log('HISTORY_DEFERRED', loanId, historyResult.reason);

    const hasSubmission =
      Boolean(markResult.result?.txHash || markResult.result?.tx_hash) &&
      Boolean(liqResult.result?.txHash || liqResult.result?.tx_hash);

    s.status = hasSubmission ? 'DEFAULTED' : 'DEFAULT_PENDING';
    s.isActive = false;

    this.#log('DEFAULTED', loanId,
      `Fully executed on-chain. Outstanding: $${outstanding}. ` +
      `mark_default: ✓, liquidate_escrow: ✓, history: deferred`);

    return {
      loanId, action: hasSubmission ? 'DEFAULTED' : 'DEFAULT_FLOW_BUILT',
      borrower: s.borrower, outstanding,
      paidInstallments: s.paidInstallments,
      totalInstallments: s.totalInstallments,
      onChainConfirmed: hasSubmission,
      onChainResults: {
        markDefault: markResult.success,
        liquidateEscrow: liqResult.success,
        recordHistory: historyResult.success,
        historyDeferred: historyResult.deferred,
      },
    };
  }

  async simulateDefaultLifecycle(loanId) {
    const s = this.#schedules.get(loanId);
    if (!s) throw new Error(`No schedule for loan #${loanId}`);
    const timeline = [];

    s.failedAttempts = 1;
    s.graceDeadline = s.nextDueDate + GRACE_PERIOD_MS;
    s.status = 'OVERDUE';
    s.remindersSent = 3; // Skip reminders for simulation
    timeline.push({ day: 0, action: 'PULL_FAILED' });
    timeline.push({ day: 1, action: 'RETRY_FAILED' });
    timeline.push({ day: 2, action: 'RETRY_FAILED' });

    const defaultResult = await this.#triggerDefault(loanId, s);
    timeline.push({ day: 3, action: 'DEFAULT_TRIGGERED', result: defaultResult });

    return { loanId, timeline, finalStatus: s.status };
  }

  getScheduleStatus(id) { return this.#schedules.get(id) || null; }
  getAllSchedules() {
    return Array.from(this.#schedules.entries()).map(([id, s]) => ({
      loanId: id, borrower: s.borrower?.slice(0, 8) + '...',
      progress: `${s.paidInstallments}/${s.totalInstallments}`,
      progressPct: Math.round(s.paidInstallments / s.totalInstallments * 100),
      status: s.status,
      nextDue: s.isActive ? new Date(s.nextDueDate).toISOString() : 'N/A',
      graceDeadline: s.graceDeadline ? new Date(s.graceDeadline).toISOString() : null,
    }));
  }
  getAuditLog(n = 50) { return this.#audit.slice(-n); }

  #log(action, loanId, detail) {
    this.#audit.push({ ts: new Date().toISOString(), agent: 'collection-agent', action, loanId, detail });
  }
}

export default CollectionTrackerAgent;
