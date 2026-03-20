import test from "node:test";
import assert from "node:assert/strict";
import { createWalletService } from "../src/walletService.js";
import { createBridgeService } from "../src/bridgeService.js";
import { createMcpBridge } from "../src/mcpBridge.js";

test("mcp bridge dispatches named tools", async () => {
  const walletService = createWalletService();
  const bridgeService = createBridgeService(walletService);
  const mcpBridge = createMcpBridge({ walletService, bridgeService });
  const result = await mcpBridge.executeTool("get_balance", { address: "abc" });
  assert.equal(result.address, "abc");
});
