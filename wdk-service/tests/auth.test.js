import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { AuthManager, createAuthFromEnv } from '../src/auth.js';

const TEST_KEY = 'credagent-test-key-1234567890abcdef';
const TEST_KEY_2 = 'credagent-second-key-abcdef1234567890';

function createTestAuth(overrides = {}) {
  return new AuthManager({
    apiKeys: [TEST_KEY, TEST_KEY_2],
    keyConfigs: {
      [TEST_KEY]: {
        clientId: 'openclaw-main',
        allowedAgents: null,
        tier: 2,
      },
      [TEST_KEY_2]: {
        clientId: 'dashboard-readonly',
        allowedAgents: ['credit-agent'],
        tier: 1,
      },
    },
    sessionTtlMs: 5_000,
    tokenSecret: 'b'.repeat(64),
    ...overrides,
  });
}

function mockReq(path, token, ip = '127.0.0.1') {
  const headers = { host: 'localhost:3100' };
  if (token !== undefined && token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  return {
    url: path,
    method: 'GET',
    headers,
    socket: { remoteAddress: ip },
  };
}

describe('AuthManager API key auth', () => {
  test('valid API key authenticates with expected client info', () => {
    const auth = createTestAuth();
    const result = auth.authenticate(mockReq('/mcp/call', TEST_KEY));
    expect(result.authenticated).toBe(true);
    expect(result.clientId).toBe('openclaw-main');
    expect(result.tier).toBe(2);
  });

  test('restricted API key authenticates with scoped agents', () => {
    const auth = createTestAuth();
    const result = auth.authenticate(mockReq('/mcp/call', TEST_KEY_2));
    expect(result.authenticated).toBe(true);
    expect(result.allowedAgents).toEqual(['credit-agent']);
  });

  test('invalid API key is rejected', () => {
    const auth = createTestAuth();
    const result = auth.authenticate(mockReq('/mcp/call', 'wrong-key-long-enough-string'));
    expect(result.authenticated).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  test('missing Authorization header is rejected', () => {
    const auth = createTestAuth();
    const result = auth.authenticate(mockReq('/mcp/call', null));
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Missing Authorization');
  });

  test('/health bypasses auth', () => {
    const auth = createTestAuth();
    const result = auth.authenticate(mockReq('/health', null));
    expect(result.authenticated).toBe(true);
    expect(result.public).toBe(true);
  });

  test('short API keys are ignored at registration', () => {
    const auth = new AuthManager({ apiKeys: ['short'] });
    expect(auth.getStats().registeredKeys).toBe(0);
  });
});

describe('AuthManager session tokens', () => {
  test('creates and authenticates a session token', () => {
    const auth = createTestAuth();
    const apiAuth = auth.authenticate(mockReq('/auth/token', TEST_KEY));
    const session = auth.createSession(apiAuth);
    expect(session.token.startsWith('ses_')).toBe(true);

    const result = auth.authenticate(mockReq('/mcp/call', session.token));
    expect(result.authenticated).toBe(true);
    expect(result.clientId).toBe('openclaw-main');
  });

  test('session inherits API key scope', () => {
    const auth = createTestAuth();
    const apiAuth = auth.authenticate(mockReq('/auth/token', TEST_KEY_2));
    const session = auth.createSession(apiAuth);
    const result = auth.authenticate(mockReq('/mcp/call', session.token));
    expect(result.allowedAgents).toEqual(['credit-agent']);
  });

  test('expired session is rejected', async () => {
    const auth = createTestAuth({ sessionTtlMs: 50 });
    const apiAuth = auth.authenticate(mockReq('/auth/token', TEST_KEY));
    const session = auth.createSession(apiAuth);
    await new Promise((resolve) => setTimeout(resolve, 75));
    const result = auth.authenticate(mockReq('/mcp/call', session.token));
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('revoked session cannot be reused', () => {
    const auth = createTestAuth();
    const apiAuth = auth.authenticate(mockReq('/auth/token', TEST_KEY));
    const session = auth.createSession(apiAuth);
    expect(auth.revokeSession(session.token)).toBe(true);
    const result = auth.authenticate(mockReq('/mcp/call', session.token));
    expect(result.authenticated).toBe(false);
  });

  test('tampered session HMAC is rejected', () => {
    const auth = createTestAuth();
    const apiAuth = auth.authenticate(mockReq('/auth/token', TEST_KEY));
    const session = auth.createSession(apiAuth);
    const tampered = `${session.token.slice(0, -4)}XXXX`;
    const result = auth.authenticate(mockReq('/mcp/call', tampered));
    expect(result.authenticated).toBe(false);
  });
});

describe('AuthManager brute-force protection and scopes', () => {
  test('locks out IP after repeated failed attempts', () => {
    const auth = createTestAuth();
    const ip = '10.0.0.50';
    for (let i = 0; i < 5; i += 1) {
      auth.authenticate(mockReq('/mcp/call', 'wrong-key-long-enough-string', ip));
    }
    const result = auth.authenticate(mockReq('/mcp/call', TEST_KEY, ip));
    expect(result.authenticated).toBe(false);
    expect(result.statusCode).toBe(429);
  });

  test('successful auth resets failure counter for an IP', () => {
    const auth = createTestAuth();
    const ip = '10.0.0.60';
    for (let i = 0; i < 3; i += 1) {
      auth.authenticate(mockReq('/mcp/call', 'wrong-key-long-enough-string', ip));
    }
    expect(auth.authenticate(mockReq('/mcp/call', TEST_KEY, ip)).authenticated).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      auth.authenticate(mockReq('/mcp/call', 'wrong-key-long-enough-string', ip));
    }
    expect(auth.authenticate(mockReq('/mcp/call', TEST_KEY, ip)).authenticated).toBe(true);
  });

  test('agent scope allows unrestricted and blocks unauthorized agents', () => {
    const auth = createTestAuth();
    const unrestricted = auth.authenticate(mockReq('/mcp/call', TEST_KEY));
    const restricted = auth.authenticate(mockReq('/mcp/call', TEST_KEY_2));
    expect(auth.isAgentAllowed(unrestricted, 'yield-agent')).toBe(true);
    expect(auth.isAgentAllowed(restricted, 'credit-agent')).toBe(true);
    expect(auth.isAgentAllowed(restricted, 'lending-agent')).toBe(false);
  });
});

describe('createAuthFromEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MCP_API_KEYS;
    delete process.env.MCP_TOKEN_SECRET;
    delete process.env.MCP_SESSION_TTL_MS;
    delete process.env.MCP_HOST;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns null in localhost mode with no API keys', () => {
    process.env.MCP_HOST = '127.0.0.1';
    expect(createAuthFromEnv()).toBeNull();
  });

  test('throws when exposed without API keys', () => {
    process.env.MCP_HOST = '0.0.0.0';
    expect(() => createAuthFromEnv()).toThrow(/MCP_API_KEYS/);
  });

  test('creates auth manager from configured keys', () => {
    process.env.MCP_HOST = '0.0.0.0';
    process.env.MCP_API_KEYS = TEST_KEY;
    process.env.MCP_TOKEN_SECRET = 'c'.repeat(64);
    const auth = createAuthFromEnv();
    expect(auth).toBeInstanceOf(AuthManager);
    expect(auth.getStats().registeredKeys).toBe(1);
  });
});
