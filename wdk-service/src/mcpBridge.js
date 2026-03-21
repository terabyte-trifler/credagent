export function createMcpBridge({ walletService, bridgeService }) {
  const tools = {
    create_wallet: (input) => walletService.createAgentWallet(input?.agentId ?? input?.label),
    get_sol_balance: (input) => walletService.getSolBalance(input?.agentId),
    get_token_balance: (input) => walletService.getTokenBalance(input?.agentId, input?.mint),
    send_sol: (input) => walletService.sendSol(input?.agentId, input?.to, input?.lamports),
    send_token: (input) => walletService.sendToken(input?.agentId, input?.to, input?.amount, input?.mint),
    bridge_usdt0: (input) => bridgeService.bridge(
      input?.targetChain,
      input?.recipient,
      input?.tokenAddress,
      input?.amount,
    ),
  };

  return {
    tools,
    async executeTool(name, input) {
      const tool = tools[name];
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool(input);
    },
  };
}
