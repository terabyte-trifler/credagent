export function createBridgeService(walletService) {
  return {
    walletService,
    async bridgeUsdt0({ sourceChain, destinationChain, amount }) {
      return {
        sourceChain,
        destinationChain,
        amount,
        status: "stubbed",
      };
    },
  };
}
