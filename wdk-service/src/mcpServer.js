/**
 * @module mcpServer
 * @description Standalone MCP SSE server for CredAgent.
 *
 * Endpoints:
 * - GET  /mcp         authenticated SSE stream
 * - POST /mcp/call    authenticated tool invocation
 * - GET  /mcp/tools   authenticated tool discovery
 * - POST /auth/token  exchange API key for short-lived session token
 * - POST /auth/revoke authenticated session revocation
 * - GET  /health      public healthcheck
 * - GET  /audit       authenticated audit log access
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WalletService } from './walletService.js';
import { TokenOps } from './tokenOps.js';
import { BridgeService } from './bridgeService.js';
import { MCPBridge } from './mcpBridge.js';
import { SafetyMiddleware } from './safetyMiddleware.js';
import { AuditLog } from './auditLog.js';
import { createAuthFromEnv } from './auth.js';
import 'dotenv/config';

const DEFAULT_HOST = process.env.MCP_HOST || '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.MCP_PORT || '3100', 10);
const DEFAULT_ML_API_URL = process.env.ML_API_URL || 'http://localhost:5001';
const DEFAULT_LOCAL_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3100',
  'http://localhost:3100',
];

const DEFAULT_AGENT_TIERS = {
  'credit-agent': 1,
  'lending-agent': 2,
  'collection-agent': 1,
  'yield-agent': 2,
};

const DEFAULT_AGENT_LIMITS = {
  'lending-agent': '10000000000',
  'collection-agent': '1000000000',
  'yield-agent': '5000000000',
};

function isLocalHost(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

function parseOriginList(value) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveAllowedOrigins(config = {}, host = DEFAULT_HOST) {
  if (config.allowedOrigins) return [...config.allowedOrigins];
  const envOrigins = parseOriginList(
    process.env.MCP_CORS_ORIGINS || process.env.MCP_ALLOWED_ORIGINS || '',
  );
  if (envOrigins.length > 0) return envOrigins;
  return isLocalHost(host) ? [...DEFAULT_LOCAL_ORIGINS] : [];
}

class SSEManager {
  #clients = new Set();
  #nextId = 1;

  add(res, toolCount, clientId = 'anonymous') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.#send(res, 'connected', {
      id: this.#nextId++,
      tools: toolCount,
      clientId,
    });
    this.#clients.add(res);
    res.on('close', () => {
      this.#clients.delete(res);
    });
  }

  broadcast(event, data) {
    for (const client of this.#clients) {
      this.#send(client, event, data);
    }
  }

  drainAll() {
    for (const client of this.#clients) {
      this.#send(client, 'shutdown', { reason: 'server stopping' });
      try {
        client.end();
      } catch {}
    }
    this.#clients.clear();
  }

  get size() {
    return this.#clients.size;
  }

  #send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function applyCorsHeaders(req, res, allowedOrigins, authEnabled) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    authEnabled ? 'Content-Type, Authorization' : 'Content-Type',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function cors(req, res, allowedOrigins, authEnabled) {
  if (!applyCorsHeaders(req, res, allowedOrigins, authEnabled)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'CORS_FORBIDDEN' }));
    return;
  }
  res.writeHead(204);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Body too large (>1MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString() || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function combineAuditEntries(services, count) {
  const limit = Math.max(1, Math.min(count, 200));
  const entries = [
    ...(services.audit?.getRecent ? services.audit.getRecent(limit) : []),
    ...(services.mcpBridge?.getAuditLog ? services.mcpBridge.getAuditLog(limit) : []),
    ...(services.safety?.getAuditLog ? services.safety.getAuditLog(limit) : []),
  ];
  return entries
    .sort((a, b) => {
      const left = String(b.ts || b.isoTime || b.timestamp || '');
      const right = String(a.ts || a.isoTime || a.timestamp || '');
      return left.localeCompare(right);
    })
    .slice(0, limit);
}

function isBuildOnlyResult(result) {
  return (
    result?.success &&
    result?.result?.status === 'instruction_built' &&
    result?.result?.submitted === false
  );
}

export async function createServices(config = {}) {
  const audit = config.audit || new AuditLog();
  const rpcUrl = config.rpcUrl || process.env.WDK_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const walletService = new WalletService({ rpcUrl });
  const tokenOps = new TokenOps(walletService, rpcUrl, audit);
  const bridgeService = new BridgeService({ audit });

  const mcpBridge = new MCPBridge(
    { walletService, tokenOps, bridgeService },
    { mlApiUrl: config.mlApiUrl || DEFAULT_ML_API_URL },
  );

  const safety = new SafetyMiddleware(mcpBridge, {
    agentTiers: config.agentTiers || DEFAULT_AGENT_TIERS,
  });

  const limits = config.agentLimits || DEFAULT_AGENT_LIMITS;
  for (const [agentId, limit] of Object.entries(limits)) {
    safety.registerAgentLimit(agentId, limit);
  }

  const auth = config.auth !== undefined ? config.auth : createAuthFromEnv(audit);

  return { walletService, tokenOps, bridgeService, mcpBridge, safety, audit, auth };
}

export function createHttpServer(services, config = {}) {
  const { safety, mcpBridge, auth } = services;
  const sse = new SSEManager();
  const startedAt = Date.now();
  const host = config.host || DEFAULT_HOST;
  const allowedOrigins = new Set(resolveAllowedOrigins(config, host));
  const authEnabled = auth !== null && auth !== undefined;

  const requireAuth = (req, res) => {
    if (!authEnabled) {
      return {
        authenticated: true,
        clientId: 'local',
        public: false,
        allowedAgents: null,
        tier: 3,
      };
    }

    const authResult = auth.authenticate(req);
    if (!authResult?.authenticated) {
      json(res, authResult?.statusCode || 401, {
        success: false,
        error: authResult?.error || 'Unauthorized',
      });
      return null;
    }
    return authResult;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    if (!applyCorsHeaders(req, res, allowedOrigins, authEnabled)) {
      return json(res, 403, { success: false, error: 'CORS_FORBIDDEN' });
    }

    if (req.method === 'OPTIONS') return cors(req, res, allowedOrigins, authEnabled);

    if (pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        status: 'ok',
        service: 'credagent-mcp',
        host,
        port: config.port || DEFAULT_PORT,
        authEnabled,
        sseClients: sse.size,
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        ...(authEnabled && auth?.getStats ? { authStats: auth.getStats() } : {}),
      });
    }

    if (pathname === '/auth/token' && req.method === 'POST') {
      if (!authEnabled) {
        return json(res, 200, {
          token: 'ses_localhost-mode',
          note: 'Auth disabled in localhost mode. This token is a no-op.',
          expiresInSecs: 999999,
        });
      }

      const authResult = auth.authenticate(req);
      if (!authResult?.authenticated) {
        return json(res, authResult?.statusCode || 401, {
          success: false,
          error: authResult?.error || 'Unauthorized',
        });
      }

      const session = auth.createSession(authResult);
      if (session?.error) {
        return json(res, 400, { success: false, error: session.error });
      }
      return json(res, 200, { success: true, ...session });
    }

    if (pathname === '/auth/revoke' && req.method === 'POST') {
      if (!authEnabled) {
        return json(res, 200, { success: true, revoked: false, note: 'Auth disabled' });
      }
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      try {
        const body = await readBody(req);
        return json(res, 200, { success: true, revoked: auth.revokeSession(body.token || '') });
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/mcp' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      sse.add(res, mcpBridge.getToolList().length, authResult.clientId);
      return;
    }

    if (pathname === '/mcp/call' && req.method === 'POST') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;

      try {
        const body = await readBody(req);
        if (!body?.tool || typeof body.tool !== 'string') {
          return json(res, 400, { success: false, error: 'Missing "tool" field' });
        }

        const agentId = body.params?.agent_id;
        if (authEnabled && agentId && !auth.isAgentAllowed(authResult, agentId)) {
          return json(res, 403, {
            success: false,
            error: `AGENT_SCOPE: Key "${authResult.clientId}" is not authorized for agent "${agentId}"`,
            blocked: true,
          });
        }

        const toolTierMap = safety.getToolTierMap();
        const requiredTier = toolTierMap[body.tool];
        if (
          authEnabled &&
          requiredTier !== undefined &&
          Number.isFinite(authResult.tier) &&
          authResult.tier < requiredTier
        ) {
          return json(res, 403, {
            success: false,
            error: `CLIENT_TIER: Key "${authResult.clientId}" has tier ${authResult.tier}, tool "${body.tool}" requires tier ${requiredTier}`,
            blocked: true,
            clientTier: authResult.tier,
            requiredTier,
          });
        }

        const result = await safety.executeTool(body.tool, body.params || {});
        if (isBuildOnlyResult(result)) {
          return json(res, 409, {
            success: false,
            error: `BUILD_ONLY_UNAVAILABLE: ${body.tool} requires signer/config not available to the running MCP server`,
            blocked: true,
            result: result.result,
          });
        }

        sse.broadcast('tool_result', {
          tool: body.tool,
          result,
          clientId: authResult.clientId,
          ts: Date.now(),
        });
        return json(res, result.success ? 200 : 422, result);
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/mcp/tools' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      return json(res, 200, {
        tools: mcpBridge.getToolList(),
        tierMap: safety.getToolTierMap(),
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
        clientId: authResult.clientId,
      });
    }

    if (pathname === '/audit' && req.method === 'GET') {
      const authResult = requireAuth(req, res);
      if (!authResult) return;
      const count = Number.parseInt(url.searchParams.get('count') || '50', 10);
      return json(res, 200, { entries: combineAuditEntries(services, count) });
    }

    return json(res, 404, { error: 'Endpoint not found', status: 404 });
  });

  return { server, sse };
}

export async function startServer(config = {}) {
  const services = config.services || await createServices(config);
  const host = config.host || DEFAULT_HOST;
  const port = config.port || DEFAULT_PORT;
  const allowedOrigins = resolveAllowedOrigins(config, host);
  if ((host === '0.0.0.0' || host === '::') && allowedOrigins.length === 0) {
    throw new Error('MCP_CORS_ORIGINS or MCP_ALLOWED_ORIGINS is required when exposing the MCP server beyond localhost');
  }

  const { server, sse } = createHttpServer(services, { host, port, allowedOrigins });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  let closing = false;
  const shutdown = (signal = 'SIGTERM') => {
    if (closing) return;
    closing = true;
    sse.broadcast('shutdown', { signal, reason: 'server stopping' });
    sse.drainAll();
    const forceTimer = setTimeout(() => process.exit(1), 5000);
    server.close(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  };

  if (!config.disableSignalHandlers) {
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  return {
    server,
    services,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => {
      sse.drainAll();
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  startServer()
    .then(({ url, services }) => {
      const authEnabled = services.auth !== null && services.auth !== undefined;
      console.log(`[mcp] listening on ${url}`);
      console.log(`[mcp] auth: ${authEnabled ? 'enabled' : 'disabled (localhost mode)'}`);
      console.log(`[mcp] sse: ${url}/mcp`);
      console.log(`[mcp] auth token: ${url}/auth/token`);
      console.log(`[mcp] health: ${url}/health`);
    })
    .catch((error) => {
      console.error('[mcp] failed to start:', error);
      process.exit(1);
    });
}
