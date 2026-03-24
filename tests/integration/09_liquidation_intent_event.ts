import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";

import {
  buildDemoIntentReadyEvent,
  buildEvmLiquidationIntentPayload,
  DEMO_ASSET_PAIR,
  validateSolanaLiquidationIntentReadyEvent,
} from "../../scripts/cross-chain/day1-mvp-schema";

const ROOT = process.cwd();
const markDefaultPath = path.join(
  ROOT,
  "programs/lending_pool/src/instructions/mark_default.rs",
);
const lendingPoolIdlPath = path.join(ROOT, "target/idl/lending_pool.json");
const lendingPoolTypesPath = path.join(ROOT, "target/types/lending_pool.ts");

describe("IT-09: Day 3 — Liquidation intent contract", () => {
  const markDefaultSource = fs.readFileSync(markDefaultPath, "utf8");
  const lendingPoolIdl = JSON.parse(fs.readFileSync(lendingPoolIdlPath, "utf8"));
  const lendingPoolTypesSource = fs.readFileSync(lendingPoolTypesPath, "utf8");

  it("mark_default transitions to Defaulted and emits LiquidationIntentReady", () => {
    expect(markDefaultSource).to.include("loan.status = LoanStatus::Defaulted;");
    expect(markDefaultSource).to.include("emit!(LoanDefaulted {");
    expect(markDefaultSource).to.include("emit!(LiquidationIntentReady {");
    expect(markDefaultSource.indexOf("emit!(LoanDefaulted {")).to.be.lessThan(
      markDefaultSource.indexOf("emit!(LiquidationIntentReady {"),
    );
  });

  it("generated IDL exposes all relayer-required liquidation intent fields", () => {
    const event = lendingPoolIdl.events.find(
      (candidate: { name: string }) => candidate.name === "LiquidationIntentReady",
    );
    expect(event, "LiquidationIntentReady event in IDL").to.exist;
    expect(lendingPoolTypesSource).to.include('"name": "liquidationIntentReady"');

    for (const fieldName of [
      "loanId",
      "pool",
      "borrower",
      "collateralMint",
      "collateralAmount",
      "debtOutstanding",
      "minimumRecoveryTarget",
      "liquidationMode",
      "liquidationUrgency",
      "intentExpiry",
      "nonce",
      "targetChainId",
    ]) {
      expect(lendingPoolTypesSource).to.include(`"name": "${fieldName}"`);
    }
  });

  it("the emitted payload shape validates against the relayer schema and maps to EVM intent config", () => {
    const nowUnixTs = Math.floor(Date.now() / 1000);
    const event = buildDemoIntentReadyEvent({
      pool: "Pool111111111111111111111111111111111111111",
      borrower: "Borrower11111111111111111111111111111111111",
      collateralMint: "XautMint111111111111111111111111111111111",
      collateralAmount: 5_000_000n,
      debtOutstanding: 3_000_000_000n,
      nowUnixTs,
    });

    validateSolanaLiquidationIntentReadyEvent(event, nowUnixTs);

    const payload = buildEvmLiquidationIntentPayload({
      event,
      collateralToken: "0xWrappedXaut",
      approvedLiquidator: "0xLiquidator",
      treasurySink: "0xTreasury",
      feeOverrideBps: 30,
      treasuryFeeSplitBps: 50,
    });

    expect(payload.loanId).to.equal(event.loanId);
    expect(payload.amountToLiquidate).to.equal(event.collateralAmount);
    expect(payload.debtOutstanding).to.equal(event.debtOutstanding);
    expect(payload.minimumRecoveryTarget).to.equal(event.minimumRecoveryTarget);
    expect(payload.expiry).to.equal(event.intentExpiry);
    expect(payload.targetChainId).to.equal(DEMO_ASSET_PAIR.targetChainId);
    expect(payload.sourceProgram).to.equal("lending_pool");
  });
});
