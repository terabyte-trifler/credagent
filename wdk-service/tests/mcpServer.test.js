import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createHttpServer } from '../src/mcpServer.js';

describe('MCP HTTP server', () => {
  let server;
  let baseUrl;
  let port;

  beforeEach(async () => {
    const fakeMcpBridge = {
      getToolList: () => [
        { name: 'get_balance', description: 'Read balance', inputSchema: { type: 'object' } },
        { name: 'conditional_disburse', description: 'Disburse', inputSchema: { type: 'object' } },
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
        return { success: false, error: 'UNKNOWN_TOOL' };
      },
    };

    ({ server } = createHttpServer({ safety: fakeSafety, mcpBridge: fakeMcpBridge }, { host: '127.0.0.1', port: 0 }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('/health returns service status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('credagent-mcp');
  });

  test('/mcp/tools returns tool list and tier map', async () => {
    const res = await fetch(`${baseUrl}/mcp/tools`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tools).toHaveLength(2);
    expect(body.tierMap.conditional_disburse).toBe(2);
  });

  test('POST /mcp/call routes successful tool execution', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'get_balance', params: { agent_id: 'credit-agent' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.token).toBe('SOL');
  });

  test('POST /mcp/call returns blocked tier failure', async () => {
    const res = await fetch(`${baseUrl}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${baseUrl}/audit?count=10`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries).toHaveLength(2);
  });

  test('/mcp opens an SSE stream', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: connected');
    await reader.cancel();
  });
});
