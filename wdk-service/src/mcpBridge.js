export function createMcpBridge({ walletService, bridgeService }) {
  const tools = {
    create_wallet: (input) => walletService.createWallet(input?.label),
    get_balance: (input) => walletService.getBalance(input?.address),
    send_tokens: (input) => walletService.sendTokens(input),
    sign_message: (input) => walletService.signMessage(input?.message ?? ""),
    bridge_usdt0: (input) => bridgeService.bridgeUsdt0(input),
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
