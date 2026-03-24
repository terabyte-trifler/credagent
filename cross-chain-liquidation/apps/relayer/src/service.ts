import { RelayerConfig } from "./config";
import { EvmClient } from "./evmClient";
import { Logger } from "./logger";
import {
  buildEvmLiquidationIntentPayload,
  SolanaLiquidationIntentReadyEvent,
  validateSolanaLiquidationIntentReadyEvent,
} from "./schema";
import { SolanaReader, SolanaReaderCursor } from "./solanaReader";
import {
  buildIntentKey,
  FileBackedIntentLifecycleStore,
  InMemoryIntentLifecycleStore,
  IntentLifecycleStore,
} from "./store";

export interface RelayerDependencies {
  config: RelayerConfig;
  logger: Logger;
  solanaReader: SolanaReader;
  evmClient: EvmClient;
  store?: IntentLifecycleStore;
  now?: () => number;
}

export interface RelayerRunResult {
  cursor: SolanaReaderCursor;
  processed: number;
  submitted: number;
  failed: number;
}

export class LiquidationRelayerService {
  private cursor: SolanaReaderCursor | undefined;
  private readonly store: IntentLifecycleStore;
  private readonly now: () => number;

  public constructor(private readonly deps: RelayerDependencies) {
    this.store =
      deps.store ??
      (deps.config.storePath
        ? new FileBackedIntentLifecycleStore(deps.config.storePath)
        : new InMemoryIntentLifecycleStore());
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  }

  public async runOnce(): Promise<RelayerRunResult> {
    const batch = await this.deps.solanaReader.readLiquidationIntents(
      this.cursor,
      this.deps.config.maxBatchSize,
    );
    this.cursor = batch.nextCursor;

    let submitted = 0;
    let failed = 0;

    for (const event of batch.events) {
      const processed = await this.processEvent(event);
      if (processed === "submitted") {
        submitted += 1;
      }
      if (processed === "failed") {
        failed += 1;
      }
    }

    return {
      cursor: batch.nextCursor,
      processed: batch.events.length,
      submitted,
      failed,
    };
  }

  private async processEvent(event: SolanaLiquidationIntentReadyEvent): Promise<"submitted" | "failed" | "skipped"> {
    const intentKey = buildIntentKey(event);
    const logger = this.deps.logger.child({
      loanId: event.loanId,
      nonce: event.nonce,
      borrower: event.borrower,
      intentKey,
    });

    if (this.store.has(intentKey)) {
      logger.debug("Skipping already processed liquidation intent");
      return "skipped";
    }

    const discoveredAt = new Date().toISOString();
    this.store.upsert({
      key: intentKey,
      loanId: event.loanId,
      borrower: event.borrower,
      status: "discovered",
      discoveredAt,
      lastUpdatedAt: discoveredAt,
      event,
    });

    try {
      validateSolanaLiquidationIntentReadyEvent(event, this.now());
      if (event.targetChainId !== this.deps.config.evmChainId) {
        throw new Error(
          `targetChainId mismatch: event=${event.targetChainId.toString()} config=${this.deps.config.evmChainId.toString()}`,
        );
      }

      const payload = buildEvmLiquidationIntentPayload({
        event,
        collateralToken: this.deps.config.collateralToken,
        approvedLiquidator: this.deps.config.approvedLiquidator,
        treasurySink: this.deps.config.treasurySink,
        feeOverrideBps: this.deps.config.feeOverrideBps,
        treasuryFeeSplitBps: this.deps.config.treasuryFeeSplitBps,
      });

      this.store.upsert({
        key: intentKey,
        loanId: event.loanId,
        borrower: event.borrower,
        status: "validated",
        discoveredAt,
        lastUpdatedAt: new Date().toISOString(),
        event,
        payload,
      });

      const receipt = await this.deps.evmClient.submitLiquidationIntent(payload);
      this.store.upsert({
        key: intentKey,
        loanId: event.loanId,
        borrower: event.borrower,
        status: this.deps.config.dryRun ? "dry_run" : "submitted",
        discoveredAt,
        lastUpdatedAt: receipt.submittedAt,
        event,
        payload,
        evmTransactionHash: receipt.transactionHash,
      });

      logger.info("Liquidation intent relayed", {
        targetChainId: payload.targetChainId,
        transactionHash: receipt.transactionHash,
        dryRun: this.deps.config.dryRun,
      });
      return "submitted";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "unknown relayer error";
      this.store.upsert({
        key: intentKey,
        loanId: event.loanId,
        borrower: event.borrower,
        status: "failed",
        discoveredAt,
        lastUpdatedAt: new Date().toISOString(),
        event,
        errorMessage,
      });
      logger.error("Failed to relay liquidation intent", { errorMessage });
      return "failed";
    }
  }
}
