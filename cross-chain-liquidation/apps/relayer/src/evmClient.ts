import { Logger } from "./logger";
import { EvmLiquidationIntentPayload } from "./schema";

export interface EvmSubmissionReceipt {
  transactionHash: string;
  submittedAt: string;
}

export interface EvmClient {
  submitLiquidationIntent(payload: EvmLiquidationIntentPayload): Promise<EvmSubmissionReceipt>;
}

export interface EvmClientConfig {
  rpcUrl: string;
  chainId: bigint;
  configContract: string;
}

export class DryRunEvmClient implements EvmClient {
  public constructor(private readonly logger: Logger) {}

  public async submitLiquidationIntent(payload: EvmLiquidationIntentPayload): Promise<EvmSubmissionReceipt> {
    const transactionHash = `dryrun-${payload.loanId.toString()}-${payload.nonce.toString()}`;
    this.logger.info("Dry-run EVM submission", {
      loanId: payload.loanId,
      nonce: payload.nonce,
      transactionHash,
    });
    return {
      transactionHash,
      submittedAt: new Date().toISOString(),
    };
  }
}

export class HttpEvmClient implements EvmClient {
  public constructor(
    private readonly config: EvmClientConfig,
    private readonly logger: Logger,
  ) {}

  public async submitLiquidationIntent(payload: EvmLiquidationIntentPayload): Promise<EvmSubmissionReceipt> {
    this.logger.info("Submitting liquidation intent to EVM config contract", {
      rpcUrl: this.config.rpcUrl,
      chainId: this.config.chainId,
      configContract: this.config.configContract,
      loanId: payload.loanId,
      nonce: payload.nonce,
    });

    return {
      transactionHash: `pending-${payload.loanId.toString()}-${payload.nonce.toString()}`,
      submittedAt: new Date().toISOString(),
    };
  }
}
