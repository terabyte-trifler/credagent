import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { Logger } from "./logger";
import { SignedEvmLiquidationIntent } from "./schema";

export interface EvmSubmissionReceipt {
  transactionHash: string;
  submittedAt: string;
}

export interface EvmClient {
  submitLiquidationIntent(intent: SignedEvmLiquidationIntent): Promise<EvmSubmissionReceipt>;
}

export interface EvmClientConfig {
  rpcUrl: string;
  chainId: bigint;
  configContract: string;
  signerPrivateKey: string;
}

const LIQUIDATION_CONFIG_ABI = [
  "function submitLiquidationIntent((uint256 loanId,string pool,string borrowerId,string collateralMint,address collateralToken,uint256 amountToLiquidate,uint256 debtOutstanding,uint256 minimumRecoveryTarget,string liquidationMode,string liquidationUrgency,address approvedLiquidator,address treasurySink,uint16 feeOverrideBps,uint16 treasuryFeeSplitBps,uint256 maxLiquidationSize,uint256 expiry,uint256 nonce,uint256 targetChainId,string sourceProgram) payload,string canonicalPayload,bytes32 payloadHash,string protocolSignerId,address protocolSignerAddress,bytes signature) returns (bytes32)",
] as const;

export class DryRunEvmClient implements EvmClient {
  public constructor(private readonly logger: Logger) {}

  public async submitLiquidationIntent(intent: SignedEvmLiquidationIntent): Promise<EvmSubmissionReceipt> {
    const transactionHash = `dryrun-${intent.payloadHash.slice(0, 24)}`;
    this.logger.info("Dry-run EVM submission", {
      loanId: intent.payload.loanId,
      nonce: intent.payload.nonce,
      payloadHash: intent.payloadHash,
      signer: intent.protocolSignerId,
      signerAddress: intent.protocolSignerAddress,
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

  public async submitLiquidationIntent(intent: SignedEvmLiquidationIntent): Promise<EvmSubmissionReceipt> {
    this.logger.info("Submitting liquidation intent to EVM config contract", {
      rpcUrl: this.config.rpcUrl,
      chainId: this.config.chainId,
      configContract: this.config.configContract,
      loanId: intent.payload.loanId,
      nonce: intent.payload.nonce,
      payloadHash: intent.payloadHash,
      signer: intent.protocolSignerId,
      signerAddress: intent.protocolSignerAddress,
    });

    const provider = new JsonRpcProvider(this.config.rpcUrl, Number(this.config.chainId));
    const wallet = new Wallet(this.config.signerPrivateKey, provider);
    const contract = new Contract(this.config.configContract, LIQUIDATION_CONFIG_ABI, wallet);
    const tx = await contract.submitLiquidationIntent(
      {
        loanId: intent.payload.loanId,
        pool: intent.payload.pool,
        borrowerId: intent.payload.borrowerId,
        collateralMint: intent.payload.collateralMint,
        collateralToken: intent.payload.collateralToken,
        amountToLiquidate: intent.payload.amountToLiquidate,
        debtOutstanding: intent.payload.debtOutstanding,
        minimumRecoveryTarget: intent.payload.minimumRecoveryTarget,
        liquidationMode: intent.payload.liquidationMode,
        liquidationUrgency: intent.payload.liquidationUrgency,
        approvedLiquidator: intent.payload.approvedLiquidator,
        treasurySink: intent.payload.treasurySink,
        feeOverrideBps: intent.payload.feeOverrideBps,
        treasuryFeeSplitBps: intent.payload.treasuryFeeSplitBps,
        maxLiquidationSize: intent.payload.maxLiquidationSize,
        expiry: intent.payload.expiry,
        nonce: intent.payload.nonce,
        targetChainId: intent.payload.targetChainId,
        sourceProgram: intent.payload.sourceProgram,
      },
      intent.canonicalPayload,
      intent.payloadHash,
      intent.protocolSignerId,
      intent.protocolSignerAddress,
      intent.signature,
    );
    if (!tx.hash) {
      throw new Error("EVM submission returned no transaction hash");
    }
    return {
      transactionHash: tx.hash,
      submittedAt: new Date().toISOString(),
    };
  }
}
