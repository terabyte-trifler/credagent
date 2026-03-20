import { createWalletService } from "./walletService.js";
import { createBridgeService } from "./bridgeService.js";
import { createMcpBridge } from "./mcpBridge.js";

export function createServices() {
  const walletService = createWalletService();
  const bridgeService = createBridgeService(walletService);
  const mcpBridge = createMcpBridge({ walletService, bridgeService });

  return { walletService, bridgeService, mcpBridge };
}
