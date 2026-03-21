const test = require('node:test');
const assert = require('node:assert/strict');

function mockBridge(overrides = {}) {
  const calls = [];
  return {
    calls,
    async executeTool(name, params) {
      calls.push({ name, params });
      if (overrides[name]) {
        return overrides[name](params);
      }
      return { success: true, result: { tool: name } };
    },
  };
}

test('SafetyMiddleware allows READ agent to use get_balance', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge(), {
    agentTiers: { reader: SafetyMiddleware.TIERS.READ },
  });
  const result = await sm.executeTool('get_balance', { agent_id: 'reader' });
  assert.equal(result.success, true);
});

test('SafetyMiddleware blocks READ agent from send_sol', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge(), {
    agentTiers: { reader: SafetyMiddleware.TIERS.READ },
  });
  const result = await sm.executeTool('send_sol', {
    agent_id: 'reader',
    to: '1'.repeat(32),
    lamports: '1000',
  });
  assert.equal(result.success, false);
  assert.equal(result.blocked, true);
});

test('SafetyMiddleware enforces conditional_disburse daily limit', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge(), {
    agentTiers: { lender: SafetyMiddleware.TIERS.MANAGE },
  });
  sm.registerAgentLimit('lender', '5000');

  await sm.executeTool('conditional_disburse', {
    agent_id: 'lender',
    borrower: '2'.repeat(32),
    principal: '4000',
    interest_rate_bps: 650,
    duration_days: 60,
    decision_hash: 'a'.repeat(64),
  });

  const result = await sm.executeTool('conditional_disburse', {
    agent_id: 'lender',
    borrower: '3'.repeat(32),
    principal: '2000',
    interest_rate_bps: 650,
    duration_days: 60,
    decision_hash: 'b'.repeat(64),
  });

  assert.equal(result.success, false);
  assert.match(result.error, /LIMIT_EXCEEDED/);
});

test('SafetyMiddleware trips circuit breaker and pauses', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge());
  sm.setDepositsSnapshot('100000');
  sm.recordLoss('11000');
  assert.equal(sm.isCircuitBreakerActive, true);
  assert.equal(sm.isPaused, true);
});

test('SafetyMiddleware blocks conditional_disburse while paused', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge(), {
    agentTiers: { lender: SafetyMiddleware.TIERS.MANAGE },
  });
  sm.pause();
  const result = await sm.executeTool('conditional_disburse', {
    agent_id: 'lender',
    borrower: '2'.repeat(32),
    principal: '1000',
    interest_rate_bps: 650,
    duration_days: 60,
    decision_hash: 'a'.repeat(64),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PAUSED/);
});

test('SafetyMiddleware allows get_balance while paused', async () => {
  const { SafetyMiddleware } = await import('../../wdk-service/src/safetyMiddleware.js');
  const sm = new SafetyMiddleware(mockBridge(), {
    agentTiers: { reader: SafetyMiddleware.TIERS.READ },
  });
  sm.pause();
  const result = await sm.executeTool('get_balance', { agent_id: 'reader' });
  assert.equal(result.success, true);
});
