declare const process:
  | {
      env: Record<string, string | undefined>;
      exitCode?: number;
    }
  | undefined;

import { loadRelayerConfig } from "./config";
import { DryRunEvmClient, HttpEvmClient } from "./evmClient";
import { buildDemoSolanaIntentEvent } from "./fixtures";
import { createLogger } from "./logger";
import { LiquidationRelayerService } from "./service";
import { HttpSolanaReader, StaticSolanaReader } from "./solanaReader";

export * from "./config";
export * from "./evmClient";
export * from "./logger";
export * from "./schema";
export * from "./service";
export * from "./signer";
export * from "./solanaReader";
export * from "./store";

export function createRelayerServiceForEnv(env: Record<string, string | undefined>) {
  const config = loadRelayerConfig(env);
  const logger = createLogger({
    service: config.serviceName,
    environment: config.environment,
  });

  const solanaReader =
    config.environment === "test"
      ? new StaticSolanaReader([buildDemoSolanaIntentEvent(Math.floor(Date.now() / 1000))])
      : new HttpSolanaReader(
          {
            rpcUrl: config.solanaRpcUrl,
            programId: config.solanaProgramId,
          },
          logger.child({ component: "solana-reader" }),
        );

  const evmClient = config.dryRun
    ? new DryRunEvmClient(logger.child({ component: "evm-client", mode: "dry-run" }))
    : new HttpEvmClient(
        {
          rpcUrl: config.evmRpcUrl,
          chainId: config.evmChainId,
          configContract: config.evmConfigContract,
          signerPrivateKey: config.protocolSignerPrivateKey,
        },
        logger.child({ component: "evm-client", mode: "submit" }),
      );

  return new LiquidationRelayerService({
    config,
    logger: logger.child({ component: "relayer" }),
    solanaReader,
    evmClient,
  });
}

export async function main(): Promise<void> {
  const env = process?.env ?? {};
  const service = createRelayerServiceForEnv(env);
  const logger = createLogger({ service: "cross-chain-liquidation-relayer" });

  const result = await service.runOnce();
  logger.info("Relayer tick completed", {
    processed: result.processed,
    submitted: result.submitted,
    failed: result.failed,
    cursorSlot: result.cursor.slot ?? 0,
  });
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  void main().catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : "unknown relayer bootstrap error";
    createLogger({ service: "cross-chain-liquidation-relayer" }).error("Relayer bootstrap failed", {
      errorMessage,
    });
    if (process) {
      process.exitCode = 1;
    }
  });
}
