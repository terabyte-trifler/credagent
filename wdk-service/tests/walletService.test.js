import test from "node:test";
import assert from "node:assert/strict";
import { createWalletService } from "../src/walletService.js";

test("wallet service exposes placeholder wallet methods", async () => {
  const service = createWalletService();
  const wallet = await service.createWallet("credit-agent");
  assert.equal(wallet.label, "credit-agent");
});
