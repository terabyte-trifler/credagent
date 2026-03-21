/**
 * @module toolDefs
 * @description 12 MCP tool definitions for CredAgent.
 *
 * 3 categories:
 *   WALLET (4 tools)  — create wallet, balance, send SOL, send SPL
 *   CREDIT (3 tools)  — compute score, check eligibility, default probability
 *   PAYMENT (5 tools) — lock collateral, conditional disburse, create schedule,
 *                        pull installment, bridge USDT0
 *
 * AUDIT:
 * - Every tool has strict JSON Schema input validation
 * - Required fields enforced; optional fields have defaults
 * - Amount fields are strings (parsed as BigInt in executor — no float leaks)
 * - Address fields validated as base58 in executor before any RPC call
 * - No tool exposes private keys, seeds, or internal state
 */

// ═══════════════════════════════════════════
// WALLET TOOLS (4)
// ═══════════════════════════════════════════

export const createWallet = {
  name: 'create_wallet',
  description:
    'Create a new self-custodial Solana wallet for an agent using Tether WDK. ' +
    'Returns the public address only. Seed generated internally, never exposed.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'Unique agent identifier (1-64 chars, alphanumeric/hyphen/underscore)',
        pattern: '^[a-zA-Z0-9_-]{1,64}$',
      },
    },
    required: ['agent_id'],
    additionalProperties: false,
  },
};

export const getBalance = {
  name: 'get_balance',
  description:
    'Get SOL or SPL token balance for an agent wallet. ' +
    'Pass token_mint for SPL tokens, omit for native SOL.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      token_mint: {
        type: 'string',
        description: 'SPL token mint address (base58). Omit for SOL balance.',
      },
    },
    required: ['agent_id'],
    additionalProperties: false,
  },
};

export const sendSol = {
  name: 'send_sol',
  description:
    'Send native SOL from an agent wallet. Amount in lamports (string). ' +
    'Safety cap: 100 SOL per transaction.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      to: { type: 'string', description: 'Recipient Solana address (base58)' },
      lamports: { type: 'string', description: 'Amount in lamports (integer string)' },
    },
    required: ['agent_id', 'to', 'lamports'],
    additionalProperties: false,
  },
};

export const sendToken = {
  name: 'send_token',
  description:
    'Send SPL tokens (USDT, XAUT) from an agent wallet. ' +
    'Amount in token smallest units (string, 6 decimals).',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      to: { type: 'string', description: 'Recipient Solana address (base58)' },
      amount: { type: 'string', description: 'Amount in smallest units (integer string)' },
      token_mint: { type: 'string', description: 'SPL token mint address (base58)' },
    },
    required: ['agent_id', 'to', 'amount', 'token_mint'],
    additionalProperties: false,
  },
};

// ═══════════════════════════════════════════
// CREDIT TOOLS (3)
// ═══════════════════════════════════════════

export const computeCreditScore = {
  name: 'compute_credit_score',
  description:
    'Compute FICO-adapted credit score (300-850) for a Solana wallet address. ' +
    'Uses XGBoost ML model with 14 on-chain feature categories. ' +
    'Returns score, risk tier, confidence, and recommended loan terms.',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Borrower Solana address (base58)' },
      features: {
        type: 'object',
        description: 'Optional: pre-extracted features. If omitted, auto-extracted.',
      },
    },
    required: ['address'],
    additionalProperties: false,
  },
};

export const checkEligibility = {
  name: 'check_eligibility',
  description:
    'Check if a borrower is eligible for a loan of given amount. ' +
    'Returns eligible (bool), max_loan, max_ltv, suggested_rate.',
  inputSchema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Borrower Solana address (base58)' },
      loan_amount_usd: { type: 'number', description: 'Requested loan amount in USD' },
    },
    required: ['address', 'loan_amount_usd'],
    additionalProperties: false,
  },
};

export const getDefaultProbability = {
  name: 'get_default_probability',
  description:
    'Predict probability of default given a credit score and loan parameters. ' +
    'Returns PD, credit spread, suggested rate, risk-adjusted return.',
  inputSchema: {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 300, maximum: 850 },
      loan_amount_usd: { type: 'number', minimum: 0, maximum: 1000000 },
      duration_days: { type: 'integer', minimum: 1, maximum: 365 },
    },
    required: ['score'],
    additionalProperties: false,
  },
};

// ═══════════════════════════════════════════
// PAYMENT PRIMITIVE TOOLS (5)
// ═══════════════════════════════════════════

export const lockCollateral = {
  name: 'lock_collateral',
  description:
    'PAYMENT PRIMITIVE 1: Lock borrower collateral in program-owned escrow PDA. ' +
    'Tokens can only be released by release_collateral or liquidate_escrow.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      loan_id: { type: 'integer', minimum: 1, description: 'Loan ID from pool' },
      borrower: { type: 'string', description: 'Borrower Solana address' },
      collateral_mint: { type: 'string', description: 'Collateral token mint (base58)' },
      amount: { type: 'string', description: 'Collateral amount (integer string)' },
    },
    required: ['agent_id', 'loan_id', 'borrower', 'collateral_mint', 'amount'],
    additionalProperties: false,
  },
};

export const conditionalDisburse = {
  name: 'conditional_disburse',
  description:
    'PAYMENT PRIMITIVE 2: Atomic 4-gate conditional loan disbursement. ' +
    'Gates: (1) valid credit score, (2) collateral locked, ' +
    '(3) pool utilization OK, (4) agent authorized. ' +
    'ALL gates must pass or entire transaction reverts.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      borrower: { type: 'string', description: 'Borrower Solana address' },
      principal: { type: 'string', description: 'Loan amount (integer string, token units)' },
      interest_rate_bps: { type: 'integer', minimum: 1, maximum: 5000 },
      duration_days: { type: 'integer', minimum: 1, maximum: 365 },
      decision_reasoning: {
        type: 'string',
        description: 'Agent reasoning text. SHA-256 hashed and stored on-chain.',
        maxLength: 10000,
      },
    },
    required: ['agent_id', 'borrower', 'principal', 'interest_rate_bps', 'duration_days', 'decision_reasoning'],
    additionalProperties: false,
  },
};

export const createSchedule = {
  name: 'create_installment_schedule',
  description:
    'PAYMENT PRIMITIVE 3: Create automated repayment schedule. ' +
    'Collection agent is authorized to pull installments on due dates. ' +
    'Max 52 installments (weekly for 1 year).',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      loan_id: { type: 'integer', minimum: 1 },
      num_installments: { type: 'integer', minimum: 1, maximum: 52 },
      interval_seconds: { type: 'integer', minimum: 3600, description: 'Min 1 hour between installments' },
      collection_agent_address: { type: 'string', description: 'Collection agent pubkey (base58)' },
    },
    required: ['agent_id', 'loan_id', 'num_installments', 'interval_seconds', 'collection_agent_address'],
    additionalProperties: false,
  },
};

export const pullInstallment = {
  name: 'pull_installment',
  description:
    'PAYMENT PRIMITIVE 4: Collection agent pulls a scheduled installment from borrower. ' +
    'Requires: (1) due date passed, (2) borrower has SPL delegation to collection agent, ' +
    '(3) installments remaining. Counter prevents double-pull.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', description: 'Collection agent ID' },
      loan_id: { type: 'integer', minimum: 1 },
    },
    required: ['agent_id', 'loan_id'],
    additionalProperties: false,
  },
};

export const bridgeUsdt0 = {
  name: 'bridge_usdt0',
  description:
    'Bridge USDT0 cross-chain via WDK protocol module. ' +
    'Used by Yield Agent for capital reallocation. ' +
    'Supports: ethereum, polygon, arbitrum, solana, ton, tron.',
  inputSchema: {
    type: 'object',
    properties: {
      target_chain: {
        type: 'string',
        enum: ['ethereum', 'arbitrum', 'polygon', 'solana', 'ton', 'tron', 'optimism', 'avalanche'],
      },
      recipient: { type: 'string', description: 'Recipient address on target chain' },
      token_address: { type: 'string', description: 'USDT contract on source chain (EVM format)' },
      amount: { type: 'string', description: 'Amount in smallest units (integer string)' },
    },
    required: ['target_chain', 'recipient', 'token_address', 'amount'],
    additionalProperties: false,
  },
};

// ═══════════════════════════════════════════
// Export all tools as array
// ═══════════════════════════════════════════

export const ALL_TOOLS = [
  createWallet, getBalance, sendSol, sendToken,
  computeCreditScore, checkEligibility, getDefaultProbability,
  lockCollateral, conditionalDisburse, createSchedule, pullInstallment, bridgeUsdt0,
];

export const TOOL_MAP = Object.fromEntries(ALL_TOOLS.map(t => [t.name, t]));

export default ALL_TOOLS;
