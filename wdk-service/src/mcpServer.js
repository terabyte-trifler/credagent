/**
 * @module mcpServer
 * @description Standalone MCP SSE server for CredAgent.
 *
 * This is the actual HTTP service that OpenClaw connects to at
 * http://localhost:3100/mcp.
 *
 * Endpoints:
 * - GET  /mcp        SSE stream
 * - POST /mcp/call   direct tool invocation
 * - GET  /mcp/tools  tool discovery
 * - GET  /health     healthcheck
 * - GET  /audit      recent sanitized audit entries
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WalletService } from './walletService.js';
import { TokenOps } from './tokenOps.js';
import { BridgeService } from './bridgeService.js';
import { MCPBridge } from './mcpBridge.js';
import { SafetyMiddleware } from './safetyMiddleware.js';
import 'dotenv/config';

const DEFAULT_HOST = process.env.MCP_HOST || '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.MCP_PORT || '3100', 10);
const DEFAULT_ML_API_URL = process.env.ML_API_URL || 'http://localhost:5001';

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

class SSEManager {
  #clients = new Set();
  #nextId = 1;

  add(res, toolCount) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    this.#send(res, 'connected', { id: this.#nextId++, tools: toolCount });
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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function cors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
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

export async function createServices(config = {}) {
  const walletService = new WalletService({
    rpcUrl: config.rpcUrl || process.env.WDK_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  });
  const tokenOps = new TokenOps(
    walletService,
    config.rpcUrl || process.env.WDK_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  );
  const bridgeService = new BridgeService({});

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

  return { walletService, tokenOps, bridgeService, mcpBridge, safety };
}

export function createHttpServer(services, config = {}) {
  const { safety, mcpBridge } = services;
  const sse = new SSEManager();
  const startedAt = Date.now();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') return cors(res);

    if (pathname === '/mcp' && req.method === 'GET') {
      sse.add(res, mcpBridge.getToolList().length);
      return;
    }

    if (pathname === '/mcp/call' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (!body?.tool || typeof body.tool !== 'string') {
          return json(res, 400, { success: false, error: 'Missing "tool" field' });
        }
        const result = await safety.executeTool(body.tool, body.params || {});
        sse.broadcast('tool_result', { tool: body.tool, result, ts: Date.now() });
        return json(res, result.success ? 200 : 422, result);
      } catch (error) {
        return json(res, 400, { success: false, error: error.message });
      }
    }

    if (pathname === '/mcp/tools' && req.method === 'GET') {
      return json(res, 200, {
        tools: mcpBridge.getToolList(),
        tierMap: safety.getToolTierMap(),
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
      });
    }

    if (pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        status: 'ok',
        service: 'credagent-mcp',
        host: config.host || DEFAULT_HOST,
        port: config.port || DEFAULT_PORT,
        sseClients: sse.size,
        paused: safety.isPaused,
        circuitBreaker: safety.isCircuitBreakerActive,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      });
    }

    if (pathname === '/audit' && req.method === 'GET') {
      const count = Number.parseInt(url.searchParams.get('count') || '50', 10);
      const mcpEntries = mcpBridge.getAuditLog(Math.max(1, count));
      const safetyEntries = safety.getAuditLog(Math.max(1, count));
      const entries = [...mcpEntries, ...safetyEntries]
        .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
        .slice(0, Math.max(1, count));
      return json(res, 200, { entries });
    }

    return json(res, 404, { error: 'Endpoint not found', status: 404 });
  });

  return { server, sse };
}

export async function startServer(config = {}) {
  const services = config.services || await createServices(config);
  const host = config.host || DEFAULT_HOST;
  const port = config.port || DEFAULT_PORT;
  const { server, sse } = createHttpServer(services, { host, port });

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
    .then(({ url }) => {
      console.log(`[mcp] listening on ${url}`);
      console.log(`[mcp] sse: ${url}/mcp`);
      console.log(`[mcp] health: ${url}/health`);
    })
    .catch((error) => {
      console.error('[mcp] failed to start:', error);
      process.exit(1);
    });
}
