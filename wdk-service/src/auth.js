import crypto from 'node:crypto';

const DEFAULT_SESSION_TTL_MS = Number.parseInt(process.env.MCP_SESSION_TTL_MS || `${60 * 60 * 1000}`, 10);
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const PUBLIC_ROUTES = new Set(['/health']);

function sanitizeIdentity(value) {
  return typeof value === 'string' ? value.slice(0, 32) : 'unknown';
}

export class AuthManager {
  #apiKeys = new Map();
  #sessions = new Map();
  #failedAttempts = new Map();
  #audit;
  #sessionTtlMs;
  #tokenSecret;

  constructor(config = {}) {
    this.#audit = config.audit || null;
    this.#sessionTtlMs = config.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.#tokenSecret = config.tokenSecret || process.env.MCP_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

    const keys = config.apiKeys || [];
    const keyConfigs = config.keyConfigs || {};
    for (const rawKey of keys) {
      if (!rawKey || rawKey.length < 16) continue;
      const keyHash = this.#hashKey(rawKey);
      const keyConfig = keyConfigs[rawKey] || {};
      this.#apiKeys.set(keyHash, {
        clientId: keyConfig.clientId || `client-${keyHash.slice(0, 8)}`,
        allowedAgents: keyConfig.allowedAgents ?? null,
        tier: keyConfig.tier ?? 2,
        keyHash,
        createdAt: Date.now(),
      });
    }

    setInterval(() => this.#cleanup(), 5 * 60 * 1000).unref();
  }

  authenticate(req) {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (PUBLIC_ROUTES.has(url.pathname)) {
      return { authenticated: true, public: true, clientId: 'public' };
    }

    const ip = req.socket?.remoteAddress || 'unknown';
    if (this.#isLockedOut(ip)) {
      this.#log('LOCKED_OUT', ip, url.pathname);
      return { authenticated: false, statusCode: 429, error: 'Too many failed attempts. Try again later.' };
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      this.#recordFailure(ip);
      this.#log('MISSING_TOKEN', ip, url.pathname);
      return { authenticated: false, statusCode: 401, error: 'Missing Authorization header. Use: Bearer <api_key_or_session_token>' };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      this.#recordFailure(ip);
      return { authenticated: false, statusCode: 401, error: 'Empty bearer token' };
    }

    if (token.startsWith('ses_')) {
      return this.#authenticateSession(token, ip, url.pathname);
    }
    return this.#authenticateApiKey(token, ip, url.pathname);
  }

  createSession(authResult) {
    if (!authResult?.authenticated) {
      return { error: 'Cannot create session: not authenticated' };
    }

    const tokenId = `ses_${crypto.randomUUID()}`;
    const hmac = crypto.createHmac('sha256', this.#tokenSecret).update(tokenId).digest('hex').slice(0, 16);
    const token = `${tokenId}.${hmac}`;
    const expiresAt = Date.now() + this.#sessionTtlMs;

    this.#sessions.set(tokenId, {
      tokenId,
      clientId: authResult.clientId,
      allowedAgents: authResult.allowedAgents ?? null,
      tier: authResult.tier ?? 2,
      createdAt: Date.now(),
      expiresAt,
      lastUsed: Date.now(),
    });

    return {
      token,
      expiresAt,
      expiresInSecs: Math.floor(this.#sessionTtlMs / 1000),
    };
  }

  revokeSession(token) {
    const tokenId = token.includes('.') ? token.slice(0, token.indexOf('.')) : token;
    const deleted = this.#sessions.delete(tokenId);
    if (deleted) this.#log('SESSION_REVOKED', tokenId, '/auth/revoke');
    return deleted;
  }

  isAgentAllowed(authResult, agentId) {
    if (!authResult?.authenticated) return false;
    if (authResult.allowedAgents === null || authResult.allowedAgents === undefined) return true;
    return authResult.allowedAgents.includes(agentId);
  }

  getStats() {
    return {
      registeredKeys: this.#apiKeys.size,
      activeSessions: this.#sessions.size,
      lockedIps: [...this.#failedAttempts.values()].filter((r) => r.lockedUntil && Date.now() < r.lockedUntil).length,
    };
  }

  #authenticateApiKey(rawKey, ip, path) {
    const keyHash = this.#hashKey(rawKey);
    const record = this.#apiKeys.get(keyHash);
    if (!record) {
      this.#recordFailure(ip);
      this.#log('INVALID_KEY', ip, path);
      return { authenticated: false, statusCode: 401, error: 'Invalid API key' };
    }

    this.#failedAttempts.delete(ip);
    this.#log('API_KEY_OK', record.clientId, path);
    return {
      authenticated: true,
      clientId: record.clientId,
      allowedAgents: record.allowedAgents,
      tier: record.tier,
    };
  }

  #authenticateSession(token, ip, path) {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) {
      this.#recordFailure(ip);
      return { authenticated: false, statusCode: 401, error: 'Malformed session token' };
    }

    const tokenId = token.slice(0, dotIndex);
    const providedHmac = token.slice(dotIndex + 1);
    const expectedHmac = crypto.createHmac('sha256', this.#tokenSecret).update(tokenId).digest('hex').slice(0, 16);

    if (!this.#timingSafeEqual(providedHmac, expectedHmac)) {
      this.#recordFailure(ip);
      this.#log('INVALID_SESSION_HMAC', ip, path);
      return { authenticated: false, statusCode: 401, error: 'Invalid session token' };
    }

    const session = this.#sessions.get(tokenId);
    if (!session) {
      this.#recordFailure(ip);
      this.#log('SESSION_NOT_FOUND', ip, path);
      return { authenticated: false, statusCode: 401, error: 'Session expired or revoked' };
    }

    if (Date.now() > session.expiresAt) {
      this.#sessions.delete(tokenId);
      this.#log('SESSION_EXPIRED', session.clientId, path);
      return { authenticated: false, statusCode: 401, error: 'Session expired' };
    }

    session.lastUsed = Date.now();
    this.#failedAttempts.delete(ip);
    this.#log('SESSION_OK', session.clientId, path);
    return {
      authenticated: true,
      clientId: session.clientId,
      allowedAgents: session.allowedAgents,
      tier: session.tier,
    };
  }

  #recordFailure(ip) {
    let record = this.#failedAttempts.get(ip);
    if (!record) {
      record = { count: 0, firstAttempt: Date.now(), lockedUntil: null };
      this.#failedAttempts.set(ip, record);
    }
    record.count += 1;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      this.#log('BRUTE_FORCE_LOCKOUT', ip, `${record.count} attempts`);
    }
  }

  #isLockedOut(ip) {
    const record = this.#failedAttempts.get(ip);
    if (!record) return false;
    if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
      this.#failedAttempts.delete(ip);
    }
    return false;
  }

  #cleanup() {
    const now = Date.now();
    for (const [tokenId, session] of this.#sessions) {
      if (now > session.expiresAt) this.#sessions.delete(tokenId);
    }
    for (const [ip, record] of this.#failedAttempts) {
      if (record.lockedUntil && now > record.lockedUntil) this.#failedAttempts.delete(ip);
      else if (now - record.firstAttempt > LOCKOUT_DURATION_MS * 2) this.#failedAttempts.delete(ip);
    }
  }

  #hashKey(rawKey) {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  #timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }

  #log(event, identity, detail) {
    if (this.#audit?.log) {
      this.#audit.log(event, sanitizeIdentity(identity), { detail: String(detail).slice(0, 100) }, null, 0);
    }
  }
}

export function createAuthFromEnv(audit = null) {
  const host = process.env.MCP_HOST || '127.0.0.1';
  const keys = (process.env.MCP_API_KEYS || '').split(',').map((key) => key.trim()).filter(Boolean);
  const allowPublicNoAuth = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.MCP_ALLOW_PUBLIC_NOAUTH || '').toLowerCase(),
  );

  if (keys.length === 0 && (host === '127.0.0.1' || host === 'localhost')) {
    return null;
  }

  if (keys.length === 0 && allowPublicNoAuth) {
    if (audit?.log) {
      audit.log(
        'AUTH_DISABLED_PUBLIC',
        'system',
        { detail: 'Public MCP auth disabled via MCP_ALLOW_PUBLIC_NOAUTH' },
        null,
        0,
      );
    }
    return null;
  }

  if (keys.length === 0) {
    throw new Error(
      'SECURITY: MCP_HOST is not localhost but no MCP_API_KEYS configured. Set MCP_API_KEYS, use MCP_HOST=127.0.0.1 for local-only mode, or explicitly opt in with MCP_ALLOW_PUBLIC_NOAUTH=true.',
    );
  }

  const keyConfigs = {};
  for (const key of keys) {
    const hash8 = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
    keyConfigs[key] = {
      clientId: process.env[`MCP_KEY_${hash8}_CLIENT`] || `client-${hash8}`,
      allowedAgents: process.env[`MCP_KEY_${hash8}_AGENTS`]
        ? process.env[`MCP_KEY_${hash8}_AGENTS`].split(',').map((v) => v.trim()).filter(Boolean)
        : null,
      tier: Number.parseInt(process.env[`MCP_KEY_${hash8}_TIER`] || '2', 10),
    };
  }

  return new AuthManager({
    apiKeys: keys,
    keyConfigs,
    sessionTtlMs: Number.parseInt(process.env.MCP_SESSION_TTL_MS || `${DEFAULT_SESSION_TTL_MS}`, 10),
    tokenSecret: process.env.MCP_TOKEN_SECRET,
    audit,
  });
}

export default AuthManager;
