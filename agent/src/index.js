/**
 * @module AgentOrchestrator
 * Wires all 4 agents together with shared MCP bridge.
 * Entry point for the agent system.
 */

export { CreditAssessmentAgent } from './creditAgent.js';
export { LendingDecisionAgent } from './lendingAgent.js';
export { CollectionTrackerAgent } from './collectionAgent.js';
export { YieldOptimizerAgent } from './yieldAgent.js';

import { CreditAssessmentAgent } from './creditAgent.js';
import { LendingDecisionAgent } from './lendingAgent.js';
import { CollectionTrackerAgent } from './collectionAgent.js';
import { YieldOptimizerAgent } from './yieldAgent.js';

export class AgentOrchestrator {
  #credit;
  #lending;
  #collection;
  #yield;
  #mcpBridge;
  #collectionAgentAddress;

  constructor(mcpBridge, collectionAgentAddress = '', yieldConfig = {}) {
    this.#mcpBridge = mcpBridge;
    this.#collectionAgentAddress = collectionAgentAddress;
    this.#credit = new CreditAssessmentAgent(mcpBridge);
    this.#lending = new LendingDecisionAgent(mcpBridge, this.#credit, collectionAgentAddress);
    this.#collection = new CollectionTrackerAgent(mcpBridge);
    this.#yield = new YieldOptimizerAgent(mcpBridge, yieldConfig);
  }

  get credit() { return this.#credit; }
  get lending() { return this.#lending; }
  get collection() { return this.#collection; }
  get yieldAgent() { return this.#yield; }

  /** Run the golden path demo end-to-end. */
  async runGoldenPath(borrowerAddress, loanAmount = 3000) {
    const steps = [];

    // 1. Score
    const score = await this.#credit.scoreBorrower(borrowerAddress, { dryRun: true });
    steps.push({ step: 1, action: 'SCORE', result: score });

    // 2. Evaluate
    const evaluation = await this.#lending.evaluateLoan(borrowerAddress, loanAmount, 60);
    steps.push({ step: 2, action: 'EVALUATE', result: evaluation });

    if (evaluation.status === 'DENIED') {
      steps.push({ step: 3, action: 'DENIED', result: evaluation });
      return { status: 'DENIED', steps };
    }

    // 3. Execute (escrow → disburse → schedule)
    const execution = await this.#lending.executeLoan(borrowerAddress);
    steps.push({ step: 3, action: 'EXECUTE', result: execution });

    // 4. Register schedule with collection agent
    if (execution.status === 'APPROVED') {
      this.#collection.registerSchedule({
        loanId: execution.loanId || 1,
        borrower: borrowerAddress,
        collectionAgentAddress: this.#collectionAgentAddress,
        totalInstallments: evaluation.offer.numInstallments,
        amountPerInstallment: evaluation.offer.installmentAmount,
        intervalSecs: 864000,
        firstDueDate: Date.now() + 864000000,
      });
      steps.push({ step: 4, action: 'SCHEDULE_REGISTERED' });
    }

    // 5. Pool health check
    const health = this.#yield.generateHealthReport({
      totalDeposited: 50000, totalBorrowed: loanAmount,
      interestEarned: 0, activeLoans: 1, totalDefaults: 0,
    });
    steps.push({ step: 5, action: 'POOL_HEALTH', result: health });

    return { status: execution.status, steps };
  }
}

export default AgentOrchestrator;
