import { DEMO_ASSET_PAIR } from "./schema";

export interface RelayerConfig {
  serviceName: string;
  environment: "development" | "staging" | "production" | "test";
  storePath: string;
  solanaRpcUrl: string;
  solanaProgramId: string;
  evmRpcUrl: string;
  evmChainId: bigint;
  evmConfigContract: string;
  protocolSignerId: string;
  protocolSignerAddress: string;
  protocolSignerPrivateKey: string;
  approvedLiquidator: string;
  treasurySink: string;
  collateralToken: string;
  feeOverrideBps: number;
  treasuryFeeSplitBps: number;
  pollIntervalMs: number;
  maxBatchSize: number;
  dryRun: boolean;
}

export interface EnvSource {
  [key: string]: string | undefined;
}

function required(env: EnvSource, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required relayer config: ${key}`);
  }
  return value;
}

function parseInteger(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for ${key}: ${value}`);
  }
  return parsed;
}

function requiredSecret(env: EnvSource, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required secret relayer config: ${key}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function parseEnvironment(value: string | undefined): RelayerConfig["environment"] {
  switch (value) {
    case "development":
    case "staging":
    case "production":
    case "test":
      return value;
    default:
      return "development";
  }
}

export function loadRelayerConfig(env: EnvSource): RelayerConfig {
  const protocolSignerPrivateKey = requiredSecret(env, "PROTOCOL_SIGNER_PRIVATE_KEY");
  const protocolSignerAddress = required(env, "PROTOCOL_SIGNER_ADDRESS");
  return {
    serviceName: env.RELAYER_SERVICE_NAME ?? "cross-chain-liquidation-relayer",
    environment: parseEnvironment(env.NODE_ENV),
    storePath: env.RELAYER_STORE_PATH ?? ".relayer/intents.json",
    solanaRpcUrl: required(env, "SOLANA_RPC_URL", "http://127.0.0.1:8899"),
    solanaProgramId: required(env, "SOLANA_PROGRAM_ID", "8tTaDNjoukk18eAZmxBrB9bo35i4yAAKTpQ3MqZiAoid"),
    evmRpcUrl: required(env, "EVM_RPC_URL", "http://127.0.0.1:8545"),
    evmChainId: BigInt(env.EVM_CHAIN_ID ?? DEMO_ASSET_PAIR.targetChainId.toString()),
    evmConfigContract: required(env, "EVM_CONFIG_CONTRACT", "0x0000000000000000000000000000000000000001"),
    protocolSignerId: required(env, "PROTOCOL_SIGNER_ID", "protocol-signer-dev"),
    protocolSignerAddress,
    protocolSignerPrivateKey,
    approvedLiquidator: required(env, "APPROVED_LIQUIDATOR", "0x00000000000000000000000000000000000000AA"),
    treasurySink: required(env, "TREASURY_SINK", "0x00000000000000000000000000000000000000BB"),
    collateralToken: required(env, "COLLATERAL_TOKEN", "0x00000000000000000000000000000000000000CC"),
    feeOverrideBps: parseInteger(env.FEE_OVERRIDE_BPS ?? "30", "FEE_OVERRIDE_BPS"),
    treasuryFeeSplitBps: parseInteger(env.TREASURY_FEE_SPLIT_BPS ?? "50", "TREASURY_FEE_SPLIT_BPS"),
    pollIntervalMs: parseInteger(env.POLL_INTERVAL_MS ?? "5000", "POLL_INTERVAL_MS"),
    maxBatchSize: parseInteger(env.MAX_BATCH_SIZE ?? "25", "MAX_BATCH_SIZE"),
    dryRun: parseBoolean(env.RELAYER_DRY_RUN, true),
  };
}
