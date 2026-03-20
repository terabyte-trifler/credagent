export function createWalletService() {
  return {
    async createWallet(label = "agent-wallet") {
      return { label, address: "SOLANA_WDK_PLACEHOLDER" };
    },
    async getBalance(address) {
      return { address, balance: "0" };
    },
    async sendTokens({ from, to, amount, mint }) {
      return { from, to, amount, mint, status: "stubbed" };
    },
    async signMessage(message) {
      return { message, signature: "stub-signature" };
    },
  };
}
