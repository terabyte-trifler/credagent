import { describe, expect, test, jest } from '@jest/globals';
import { createMcpBridge } from '../src/mcpBridge.js';

describe('MCP bridge', () => {
  test('dispatches to the current wallet and bridge service methods', async () => {
    const walletService = {
      createAgentWallet: jest.fn().mockResolvedValue({ agentId: 'credit-agent', address: 'abc' }),
      getSolBalance: jest.fn().mockResolvedValue({ token: 'SOL', lamports: '1' }),
      getTokenBalance: jest.fn().mockResolvedValue({ token: 'mint', rawBalance: '2' }),
      sendSol: jest.fn().mockResolvedValue({ txHash: 'sol-tx' }),
      sendToken: jest.fn().mockResolvedValue({ txHash: 'spl-tx' }),
    };
    const bridgeService = {
      bridge: jest.fn().mockResolvedValue({ txHash: 'bridge-tx' }),
    };

    const mcpBridge = createMcpBridge({ walletService, bridgeService });

    await expect(mcpBridge.executeTool('create_wallet', { agentId: 'credit-agent' }))
      .resolves.toEqual({ agentId: 'credit-agent', address: 'abc' });
    await expect(mcpBridge.executeTool('get_sol_balance', { agentId: 'credit-agent' }))
      .resolves.toEqual({ token: 'SOL', lamports: '1' });
    await expect(mcpBridge.executeTool('send_token', {
      agentId: 'credit-agent',
      to: 'dest',
      amount: '10',
      mint: 'mint',
    })).resolves.toEqual({ txHash: 'spl-tx' });
    await expect(mcpBridge.executeTool('bridge_usdt0', {
      targetChain: 'polygon',
      recipient: '0xabc',
      tokenAddress: '0xdef',
      amount: '1000',
    })).resolves.toEqual({ txHash: 'bridge-tx' });

    expect(walletService.createAgentWallet).toHaveBeenCalledWith('credit-agent');
    expect(walletService.getSolBalance).toHaveBeenCalledWith('credit-agent');
    expect(walletService.sendToken).toHaveBeenCalledWith('credit-agent', 'dest', '10', 'mint');
    expect(bridgeService.bridge).toHaveBeenCalledWith('polygon', '0xabc', '0xdef', '1000');
  });

  test('throws on unknown tool names', async () => {
    const mcpBridge = createMcpBridge({ walletService: {}, bridgeService: {} });
    await expect(mcpBridge.executeTool('missing_tool', {})).rejects.toThrow('Unknown tool');
  });
});
