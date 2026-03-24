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

export const DAY1_HAPPY_PATH = Object.freeze({
  borrowerChain: "solana",
  lendingCore: "CredAgent LendingPool",
  collateralEscrow: "Escrow PDA",
  relayer: "Cross-chain Risk / Liquidation Relayer",
  evmConfig: "LiquidationConfig",
  executionVenue: "Uniswap v4 LiquidationHook + Pool",
  recoverySink: "Protocol Treasury / Recovery Sink",
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
  borrower: string;
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

export interface Day1MvpScope {
  collateralAsset: "XAUT";
  recoveryAsset: "USDT";
  evmWrappedCollateral: "WXAUT";
  singlePool: "WXAUT/USDT";
  singleDefaultSource: "LoanDefaulted + LiquidationIntentReady";
  singleRelayer: true;
  singleActiveLiquidation: true;
  bridgeBackEnabled: false;
  auctionEngineEnabled: false;
  multiAssetEnabled: false;
}

export const DAY1_MVP_SCOPE: Day1MvpScope = Object.freeze({
  collateralAsset: "XAUT",
  recoveryAsset: "USDT",
  evmWrappedCollateral: "WXAUT",
  singlePool: "WXAUT/USDT",
  singleDefaultSource: "LoanDefaulted + LiquidationIntentReady",
  singleRelayer: true,
  singleActiveLiquidation: true,
  bridgeBackEnabled: false,
  auctionEngineEnabled: false,
  multiAssetEnabled: false,
});

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
    borrower: event.borrower,
    collateralToken: input.collateralToken,
    amountToLiquidate: event.collateralAmount,
    debtOutstanding: event.debtOutstanding,
    minimumRecoveryTarget: event.minimumRecoveryTarget,
    liquidationMode: event.liquidationMode,
    liquidationUrgency: event.liquidationUrgency,
    approvedLiquidator: input.approvedLiquidator,
    treasurySink: input.treasurySink,
    feeOverrideBps: input.feeOverrideBps,
    treasuryFeeSplitBps: input.treasuryFeeSplitBps,
    maxLiquidationSize,
    expiry: event.intentExpiry,
    nonce: event.nonce,
    targetChainId: event.targetChainId,
    sourceProgram: "lending_pool",
  };
}

export function deriveMinimumRecoveryTarget(params: {
  debtOutstanding: bigint;
  liquidationPenaltyBps: number;
  protocolFeeBps: number;
}): bigint {
  assertPositiveAmount("debtOutstanding", params.debtOutstanding);
  assertBps("liquidationPenaltyBps", params.liquidationPenaltyBps);
  assertBps("protocolFeeBps", params.protocolFeeBps);

  const retainedBps =
    BPS_DENOMINATOR -
    BigInt(params.liquidationPenaltyBps) -
    BigInt(params.protocolFeeBps);

  if (retainedBps <= 0n) {
    throw new Error("retained recovery bps must stay positive");
  }

  return (params.debtOutstanding * retainedBps) / BPS_DENOMINATOR;
}

export function buildDemoIntentReadyEvent(input: {
  pool: string;
  borrower: string;
  collateralMint: string;
  collateralAmount: bigint;
  debtOutstanding: bigint;
  liquidationMode?: LiquidationMode;
  liquidationUrgency?: LiquidationUrgency;
  nowUnixTs?: number;
}): SolanaLiquidationIntentReadyEvent {
  const nowUnixTs = input.nowUnixTs ?? Math.floor(Date.now() / 1000);
  const minimumRecoveryTarget = deriveMinimumRecoveryTarget({
    debtOutstanding: input.debtOutstanding,
    liquidationPenaltyBps: 300,
    protocolFeeBps: 50,
  });

  return {
    loanId: 1n,
    pool: input.pool,
    borrower: input.borrower,
    collateralMint: input.collateralMint,
    collateralAmount: input.collateralAmount,
    debtOutstanding: input.debtOutstanding,
    minimumRecoveryTarget,
    liquidationMode: input.liquidationMode ?? "IMMEDIATE",
    liquidationUrgency: input.liquidationUrgency ?? "HIGH",
    intentExpiry: nowUnixTs + DEFAULT_INTENT_TTL_SECS,
    nonce: 1n,
    targetChainId: DEMO_ASSET_PAIR.targetChainId,
  };
}
