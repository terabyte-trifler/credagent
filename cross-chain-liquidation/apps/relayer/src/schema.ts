import { getAddress } from "ethers";

export const BPS_DENOMINATOR = 10_000n;
export const DEFAULT_INTENT_TTL_SECS = 30 * 60;
export const EVM_ETHEREUM_MAINNET_CHAIN_ID = 1n;

export const DEMO_ASSET_PAIR = Object.freeze({
  solanaCollateralSymbol: "XAUT",
  solanaCollateralMintLabel: "xaut_spl_devnet",
  evmCollateralSymbol: "WXAUT",
  recoverySymbol: "USDT",
  evmPoolLabel: "WXAUT/USDT",
  targetChainId: EVM_ETHEREUM_MAINNET_CHAIN_ID,
});

export type LiquidationMode = "IMMEDIATE" | "PARTIAL" | "URGENT";
export type LiquidationUrgency = "LOW" | "MEDIUM" | "HIGH";

export interface SolanaLiquidationIntentReadyEvent {
  loanId: bigint;
  pool: string;
  borrower: string;
  collateralMint: string;
  collateralAmount: bigint;
  debtOutstanding: bigint;
  minimumRecoveryTarget: bigint;
  liquidationMode: LiquidationMode;
  liquidationUrgency: LiquidationUrgency;
  intentExpiry: number;
  nonce: bigint;
  targetChainId: bigint;
}

export interface EvmLiquidationIntentPayload {
  loanId: bigint;
  pool: string;
  borrower: string;
  collateralMint: string;
  collateralToken: string;
  amountToLiquidate: bigint;
  debtOutstanding: bigint;
  minimumRecoveryTarget: bigint;
  liquidationMode: LiquidationMode;
  liquidationUrgency: LiquidationUrgency;
  approvedLiquidator: string;
  treasurySink: string;
  feeOverrideBps: number;
  treasuryFeeSplitBps: number;
  maxLiquidationSize: bigint;
  expiry: number;
  nonce: bigint;
  targetChainId: bigint;
  sourceProgram: "lending_pool";
}

export interface SignedEvmLiquidationIntent {
  payload: EvmLiquidationIntentPayload;
  canonicalPayload: string;
  payloadHash: string;
  protocolSignerId: string;
  protocolSignerAddress: string;
  signature: string;
}

function assertPositiveAmount(name: string, value: bigint) {
  if (value <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }
}

function assertBps(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0 || value > Number(BPS_DENOMINATOR)) {
    throw new Error(`${name} must be an integer between 0 and 10000`);
  }
}

function normalizeEvmAddress(name: string, value: string): string {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid EVM address`);
  }
}

export function validateSolanaLiquidationIntentReadyEvent(
  event: SolanaLiquidationIntentReadyEvent,
  nowUnixTs: number,
) {
  assertPositiveAmount("loanId", event.loanId);
  assertPositiveAmount("collateralAmount", event.collateralAmount);
  assertPositiveAmount("debtOutstanding", event.debtOutstanding);
  assertPositiveAmount("minimumRecoveryTarget", event.minimumRecoveryTarget);
  if (event.minimumRecoveryTarget > event.debtOutstanding) {
    throw new Error("minimumRecoveryTarget cannot exceed debtOutstanding");
  }
  if (event.intentExpiry <= nowUnixTs) {
    throw new Error("intentExpiry must be in the future");
  }
}

export function buildEvmLiquidationIntentPayload(input: {
  event: SolanaLiquidationIntentReadyEvent;
  collateralToken: string;
  approvedLiquidator: string;
  treasurySink: string;
  feeOverrideBps: number;
  treasuryFeeSplitBps: number;
  maxLiquidationSize?: bigint;
}): EvmLiquidationIntentPayload {
  const { event } = input;

  validateSolanaLiquidationIntentReadyEvent(event, Math.floor(Date.now() / 1000));
  assertBps("feeOverrideBps", input.feeOverrideBps);
  assertBps("treasuryFeeSplitBps", input.treasuryFeeSplitBps);

  const maxLiquidationSize = input.maxLiquidationSize ?? event.collateralAmount;
  assertPositiveAmount("maxLiquidationSize", maxLiquidationSize);

  if (maxLiquidationSize > event.collateralAmount) {
    throw new Error("maxLiquidationSize cannot exceed collateralAmount");
  }

  return {
    loanId: event.loanId,
    pool: event.pool,
    borrower: normalizeEvmAddress("borrower", event.borrower),
    collateralMint: event.collateralMint,
    collateralToken: normalizeEvmAddress("collateralToken", input.collateralToken),
    amountToLiquidate: event.collateralAmount,
    debtOutstanding: event.debtOutstanding,
    minimumRecoveryTarget: event.minimumRecoveryTarget,
    liquidationMode: event.liquidationMode,
    liquidationUrgency: event.liquidationUrgency,
    approvedLiquidator: normalizeEvmAddress("approvedLiquidator", input.approvedLiquidator),
    treasurySink: normalizeEvmAddress("treasurySink", input.treasurySink),
    feeOverrideBps: input.feeOverrideBps,
    treasuryFeeSplitBps: input.treasuryFeeSplitBps,
    maxLiquidationSize,
    expiry: event.intentExpiry,
    nonce: event.nonce,
    targetChainId: event.targetChainId,
    sourceProgram: "lending_pool",
  };
}
