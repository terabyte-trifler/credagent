import {
  DEFAULT_INTENT_TTL_SECS,
  SolanaLiquidationIntentReadyEvent,
} from "./schema";

export function buildDemoSolanaIntentEvent(nowUnixTs: number): SolanaLiquidationIntentReadyEvent {
  return {
    loanId: 1n,
    pool: "Pool111111111111111111111111111111111111111",
    borrower: "Borrower11111111111111111111111111111111111",
    collateralMint: "XautMint111111111111111111111111111111111",
    collateralAmount: 1_500_000n,
    debtOutstanding: 3_000_000_000n,
    minimumRecoveryTarget: 2_895_000_000n,
    liquidationMode: "IMMEDIATE",
    liquidationUrgency: "HIGH",
    intentExpiry: nowUnixTs + DEFAULT_INTENT_TTL_SECS,
    nonce: 1n,
    targetChainId: 1n,
  };
}
