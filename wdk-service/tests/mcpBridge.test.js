import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import { MCPBridge } from '../src/mcpBridge.js';
import { ALL_TOOLS, TOOL_MAP } from '../src/toolDefs.js';
import { validate } from '../src/safetyLayer.js';
import { AuditLog } from '../src/auditLog.js';

describe('Tool definitions', () => {
  test('defines exactly 12 tools with stable schema metadata', () => {
    expect(ALL_TOOLS).toHaveLength(12);
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(TOOL_MAP[tool.name]).toBe(tool);
    }
  });
});

describe('Safety layer', () => {
  test('validates required fields and patterns', () => {
    const schema = TOOL_MAP.create_wallet.inputSchema;
    expect(() => validate.toolParams('create_wallet', { agent_id: 'credit-agent' }, schema)).not.toThrow();
    expect(() => validate.toolParams('create_wallet', {}, schema)).toThrow('MISSING_FIELD');
    expect(() => validate.toolParams('create_wallet', { agent_id: '../hack' }, schema)).toThrow('PATTERN_ERROR');
  });

  test('validates amount strings and addresses', () => {
    expect(validate.amountString('1000')).toBe(1000n);
    expect(() => validate.amountString('1.5')).toThrow('INVALID_AMOUNT');
    expect(() => validate.solanaAddress('11111111111111111111111111111111')).not.toThrow();
    expect(() => validate.solanaAddress('0x' + 'a'.repeat(40))).toThrow('INVALID_ADDRESS');
  });
});

describe('Audit log', () => {
  test('sanitizes sensitive keys and preserves hash chaining', () => {
    const log = new AuditLog();
    log.log('test_tool', 'agent-1', { seed: 'secret', normal: 'visible' }, 'ok', 5);
    log.log('test_tool_2', 'agent-1', {}, 'ok', 5);
    const entries = log.getAll();
    expect(entries[0].operation).toBe('test_tool');
    expect(JSON.stringify(entries[0])).not.toContain('secret');
    expect(entries[1].prevHash).not.toBe('0');
  });
});

describe('MCP bridge', () => {
  let walletService;
  let bridgeService;
  let bridge;

  beforeEach(() => {
    walletService = {
      createAgentWallet: jest.fn().mockResolvedValue({ agentId: 'credit-agent', address: '1'.repeat(32), chain: 'solana' }),
      getSolBalance: jest.fn().mockResolvedValue({ token: 'SOL', lamports: '5000000000', sol: '5.000000000' }),
      getTokenBalance: jest.fn().mockResolvedValue({ token: 'mock', rawBalance: '1000000' }),
      sendSol: jest.fn().mockResolvedValue({ txHash: 'abc123', fee: '5000' }),
      sendToken: jest.fn().mockResolvedValue({ txHash: 'def456', fee: '5000' }),
      getAddress: jest.fn().mockReturnValue('1'.repeat(32)),
    };
    bridgeService = {
      isReady: true,
      bridge: jest.fn().mockResolvedValue({ txHash: 'bridge-tx' }),
    };
    bridge = new MCPBridge({ walletService, bridgeService }, { rateLimitPerHour: 1000 });
  });

  test('lists tools for MCP discovery', () => {
    expect(bridge.getToolList()).toHaveLength(12);
  });

  test('dispatches wallet and bridge tools', async () => {
    await expect(bridge.executeTool('create_wallet', { agent_id: 'credit-agent' })).resolves.toMatchObject({
      success: true,
      result: { agentId: 'credit-agent' },
    });

    await expect(bridge.executeTool('get_balance', { agent_id: 'credit-agent' })).resolves.toMatchObject({
      success: true,
      result: { token: 'SOL' },
    });

    await expect(bridge.executeTool('send_token', {
      agent_id: 'credit-agent',
      to: 'dest',
      amount: '10',
      token_mint: 'mint',
    })).resolves.toMatchObject({
      success: true,
      result: { txHash: 'def456' },
    });

    await expect(bridge.executeTool('bridge_usdt0', {
      target_chain: 'polygon',
      recipient: '0x' + 'a'.repeat(40),
      token_address: '0x' + 'b'.repeat(40),
      amount: '1000',
    })).resolves.toMatchObject({
      success: true,
      result: { txHash: 'bridge-tx' },
    });
  });

  test('returns structured failures for invalid tool calls', async () => {
    await expect(bridge.executeTool('missing_tool', {})).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('UNKNOWN_TOOL'),
    });

    await expect(bridge.executeTool('create_wallet', {})).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('MISSING_FIELD'),
    });
  });

  test('logs both success and failure calls', async () => {
    await bridge.executeTool('create_wallet', { agent_id: 'log-test' });
    await bridge.executeTool('missing_tool', {});
    const log = bridge.getAuditLog(10);
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.map((entry) => entry.operation)).toContain('create_wallet');
    expect(log.map((entry) => entry.status)).toContain('error');
  });
});
