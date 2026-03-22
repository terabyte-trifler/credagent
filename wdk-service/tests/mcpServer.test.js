import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { AuthManager } from '../src/auth.js';
import { createHttpServer } from '../src/mcpServer.js';

const TEST_KEY = 'credagent-test-key-1234567890abcdef';
const RESTRICTED_KEY = 'credagent-dashboard-key-abcdef1234567890';

function createServerAuth() {
  return new AuthManager({
    apiKeys: [TEST_KEY, RESTRICTED_KEY],
    keyConfigs: {
      [TEST_KEY]: {
        clientId: 'openclaw-main',
        allowedAgents: null,
        tier: 2,
      },
      [RESTRICTED_KEY]: {
        clientId: 'dashboard-readonly',
        allowedAgents: ['credit-agent'],
        tier: 1,
      },
    },
    sessionTtlMs: 5_000,
    tokenSecret: 'a'.repeat(64),
  });
}

describe('MCP HTTP server', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    const fakeMcpBridge = {
      getToolList: () => [
        { name: 'get_balance', description: 'Read balance', inputSchema: { type: 'object' } },
        { name: 'conditional_disburse', description: 'Disburse', inputSchema: { type: 'object' } },
        { name: 'lock_collateral', description: 'Lock collateral', inputSchema: { type: 'object' } },
      ],
      getAuditLog: () => [{ ts: '2026-03-22T00:00:00.000Z', event: 'MCP_LOG' }],
    };

    const fakeSafety = {
      isPaused: false,
      isCircuitBreakerActive: false,
      getToolTierMap: () => ({ get_balance: 0, conditional_disburse: 2 }),
      getAuditLog: () => [{ ts: '2026-03-22T00:00:01.000Z', event: 'SAFETY_LOG' }],
      executeTool: async (tool, params) => {
        if (tool === 'conditional_disburse' && params.agent_id === 'credit-agent') {
          return { success: false, error: 'INSUFFICIENT_TIER', blocked: true };
        }
        if (tool === 'get_balance') {
          return { success: true, result: { token: 'SOL', lamports: '123' } };
        }
        if (tool === 'lock_collateral') {
          return {
            success: true,
            result: {
              instruction: 'lock_collateral',
              status: 'instruction_built',
              submitted: false,
              confirmed: false,
            },
          };
        }
        return { success: false, error: 'UNKNOWN_TOOL' };
      },
    };

    ({ server } = createHttpServer(
      {
        safety: fakeSafety,
        mcpBridge: fakeMcpBridge,
        audit: { getRecent: () => [{ ts: '2026-03-22T00:00:02.000Z', event: 'AUTH_LOG' }] },
        auth: createServerAuth(),
      },
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://127.0.0.1:3000'],
      },
    ));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function authHeaders(token = TEST_KEY, extra = {}) {
    return {
      Origin: 'http://127.0.0.1:3000',
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  test('/health returns service status without auth', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.authEnabled).toBe(true);
  });

  test('/mcp/tools requires auth', async () => {
    const res = await fetch(`${baseUrl}/mcp/tools`, {
      headers: { Origin: 'http://127.0.0.1:3000' },
    });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  test('/mcp/tools returns tool list when authenticated', async () => {
    const res = await fetch(`${baseUrl}/mcp/tools`, { headers: authHeaders() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tools).toHaveLength(3);
    expect(body.clientId).toBe('openclaw-main');
  });

  test('POST /auth/token exchanges API key for session token', async () => {
    const res = await fetch(`${baseUrl}/auth/token`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token.startsWith('ses_')).toBe(true);
  });

  test('session token can call protected route', async () => {
    const tokenRes = await fetch(`${baseUrl}/auth/token`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const tokenBody = await tokenRes.json();

    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(tokenBody.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tool: 'get_balance', params: { agent_id: 'credit-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('agent scope is enforced for restricted keys', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(RESTRICTED_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tool: 'get_balance', params: { agent_id: 'lending-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain('AGENT_SCOPE');
    expect(body.blocked).toBe(true);
  });

  test('client tier is enforced before agent tier checks', async () => {
    const unrestrictedLowTierKey = 'credagent-unrestricted-low-tier-key-1234567890';
    const auth = new AuthManager({
      apiKeys: [unrestrictedLowTierKey],
      keyConfigs: {
        [unrestrictedLowTierKey]: {
          clientId: 'dashboard-low-tier',
          allowedAgents: null,
          tier: 1,
        },
      },
      sessionTtlMs: 5_000,
      tokenSecret: 'd'.repeat(64),
    });

    await new Promise((resolve) => server.close(resolve));
    const fakeMcpBridge = {
      getToolList: () => [
        { name: 'get_balance', description: 'Read balance', inputSchema: { type: 'object' } },
        { name: 'conditional_disburse', description: 'Disburse', inputSchema: { type: 'object' } },
      ],
      getAuditLog: () => [],
    };
    const fakeSafety = {
      isPaused: false,
      isCircuitBreakerActive: false,
      getToolTierMap: () => ({ get_balance: 0, conditional_disburse: 2 }),
      getAuditLog: () => [],
      executeTool: async () => ({ success: true, result: { shouldNotRun: true } }),
    };

    ({ server } = createHttpServer(
      {
        safety: fakeSafety,
        mcpBridge: fakeMcpBridge,
        audit: { getRecent: () => [] },
        auth,
      },
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://127.0.0.1:3000'],
      },
    ));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        Authorization: `Bearer ${unrestrictedLowTierKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tool: 'conditional_disburse',
        params: { agent_id: 'lending-agent', principal: '1000000' },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain('CLIENT_TIER');
    expect(body.clientTier).toBe(1);
    expect(body.requiredTier).toBe(2);
    expect(body.blocked).toBe(true);
  });

  test('POST /mcp/call routes successful tool execution', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(TEST_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tool: 'get_balance', params: { agent_id: 'credit-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.token).toBe('SOL');
  });

  test('create_wallet bootstrap bypasses target agent tier deadlock', async () => {
    await new Promise((resolve) => server.close(resolve));

    let createCalled = false;
    const fakeMcpBridge = {
      getToolList: () => [
        { name: 'create_wallet', description: 'Create wallet', inputSchema: { type: 'object' } },
      ],
      getAuditLog: () => [],
      executeTool: async (_tool, params) => {
        createCalled = true;
        return {
          success: true,
          result: {
            agentId: params.agent_id,
            address: 'Demo111111111111111111111111111111111111111',
          },
        };
      },
    };
    const fakeSafety = {
      isPaused: false,
      isCircuitBreakerActive: false,
      getToolTierMap: () => ({ create_wallet: 3 }),
      getAuditLog: () => [],
      executeTool: async () => ({ success: false, error: 'should not hit safety' }),
    };

    ({ server } = createHttpServer(
      {
        safety: fakeSafety,
        mcpBridge: fakeMcpBridge,
        audit: { getRecent: () => [] },
        auth: null,
      },
      {
        host: '127.0.0.1',
        port: 0,
        allowedOrigins: ['http://127.0.0.1:3000'],
      },
    ));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool: 'create_wallet', params: { agent_id: 'credit-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(createCalled).toBe(true);
  });

  test('POST /mcp/call returns blocked tier failure', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(TEST_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        tool: 'conditional_disburse',
        params: { agent_id: 'credit-agent', principal: '1000000' },
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.blocked).toBe(true);
  });

  test('/audit returns combined audit entries', async () => {
    const res = await fetch(`${baseUrl}/audit?count=10`, { headers: authHeaders() });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries.length).toBeGreaterThanOrEqual(3);
  });

  test('/mcp opens an authenticated SSE stream', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: authHeaders(TEST_KEY, { Accept: 'text/event-stream' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: connected');
    expect(text).toContain('openclaw-main');
    await reader.cancel();
  });

  test('rejects disallowed cross-origin requests', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://evil.example' },
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('CORS_FORBIDDEN');
  });

  test('rejects build-only tool results over HTTP', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(TEST_KEY, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ tool: 'lock_collateral', params: { agent_id: 'lending-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('BUILD_ONLY_UNAVAILABLE');
    expect(body.blocked).toBe(true);
  });

  test('rejects invalid JSON bodies', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: authHeaders(TEST_KEY, { 'Content-Type': 'application/json' }),
      body: '{bad json',
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
