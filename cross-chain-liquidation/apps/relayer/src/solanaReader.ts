import { Logger } from "./logger";
import { SolanaLiquidationIntentReadyEvent } from "./schema";

export interface SolanaReaderCursor {
  slot?: number;
}

export interface SolanaReaderResult {
  events: SolanaLiquidationIntentReadyEvent[];
  nextCursor: SolanaReaderCursor;
}

export interface SolanaReader {
  readLiquidationIntents(cursor: SolanaReaderCursor | undefined, limit: number): Promise<SolanaReaderResult>;
}

export interface SolanaReaderConfig {
  rpcUrl: string;
  programId: string;
}

export class StaticSolanaReader implements SolanaReader {
  public constructor(private readonly events: SolanaLiquidationIntentReadyEvent[]) {}

  public async readLiquidationIntents(
    cursor: SolanaReaderCursor | undefined,
    limit: number,
  ): Promise<SolanaReaderResult> {
    const start = cursor?.slot ?? 0;
    const end = Math.min(start + limit, this.events.length);
    return {
      events: this.events.slice(start, end),
      nextCursor: { slot: end },
    };
  }
}

export class HttpSolanaReader implements SolanaReader {
  public constructor(
    private readonly config: SolanaReaderConfig,
    private readonly logger: Logger,
  ) {}

  public async readLiquidationIntents(
    cursor: SolanaReaderCursor | undefined,
    limit: number,
  ): Promise<SolanaReaderResult> {
    this.logger.debug("Polling Solana liquidation intents", {
      programId: this.config.programId,
      rpcUrl: this.config.rpcUrl,
      cursorSlot: cursor?.slot ?? 0,
      limit,
    });

    return {
      events: [],
      nextCursor: { slot: cursor?.slot ?? 0 },
    };
  }
}
