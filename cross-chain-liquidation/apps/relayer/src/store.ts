import fs from "node:fs";
import path from "node:path";
import { EvmLiquidationIntentPayload, SolanaLiquidationIntentReadyEvent } from "./schema";

export type IntentLifecycleStatus =
  | "discovered"
  | "validated"
  | "submitted"
  | "dry_run"
  | "failed";

export interface IntentLifecycleRecord {
  key: string;
  loanId: bigint;
  borrower: string;
  status: IntentLifecycleStatus;
  discoveredAt: string;
  lastUpdatedAt: string;
  event?: SolanaLiquidationIntentReadyEvent;
  payload?: EvmLiquidationIntentPayload;
  evmTransactionHash?: string;
  errorMessage?: string;
}

export interface IntentLifecycleStore {
  upsert(record: IntentLifecycleRecord): void;
  get(key: string): IntentLifecycleRecord | undefined;
  has(key: string): boolean;
  list(): IntentLifecycleRecord[];
}

export class InMemoryIntentLifecycleStore implements IntentLifecycleStore {
  private readonly records = new Map<string, IntentLifecycleRecord>();

  public upsert(record: IntentLifecycleRecord): void {
    this.records.set(record.key, record);
  }

  public get(key: string): IntentLifecycleRecord | undefined {
    return this.records.get(key);
  }

  public has(key: string): boolean {
    return this.records.has(key);
  }

  public list(): IntentLifecycleRecord[] {
    return [...this.records.values()];
  }
}

interface SerializedIntentLifecycleRecord {
  key: string;
  loanId: string;
  borrower: string;
  status: IntentLifecycleStatus;
  discoveredAt: string;
  lastUpdatedAt: string;
  event?: {
    loanId: string;
    pool: string;
    borrower: string;
    collateralMint: string;
    collateralAmount: string;
    debtOutstanding: string;
    minimumRecoveryTarget: string;
    liquidationMode: SolanaLiquidationIntentReadyEvent["liquidationMode"];
    liquidationUrgency: SolanaLiquidationIntentReadyEvent["liquidationUrgency"];
    intentExpiry: number;
    nonce: string;
    targetChainId: string;
  };
  payload?: {
    loanId: string;
    borrower: string;
    collateralToken: string;
    amountToLiquidate: string;
    debtOutstanding: string;
    minimumRecoveryTarget: string;
    liquidationMode: EvmLiquidationIntentPayload["liquidationMode"];
    liquidationUrgency: EvmLiquidationIntentPayload["liquidationUrgency"];
    approvedLiquidator: string;
    treasurySink: string;
    feeOverrideBps: number;
    treasuryFeeSplitBps: number;
    maxLiquidationSize: string;
    expiry: number;
    nonce: string;
    targetChainId: string;
    sourceProgram: "lending_pool";
  };
  evmTransactionHash?: string;
  errorMessage?: string;
}

function serializeEvent(event: SolanaLiquidationIntentReadyEvent): SerializedIntentLifecycleRecord["event"] {
  return {
    loanId: event.loanId.toString(),
    pool: event.pool,
    borrower: event.borrower,
    collateralMint: event.collateralMint,
    collateralAmount: event.collateralAmount.toString(),
    debtOutstanding: event.debtOutstanding.toString(),
    minimumRecoveryTarget: event.minimumRecoveryTarget.toString(),
    liquidationMode: event.liquidationMode,
    liquidationUrgency: event.liquidationUrgency,
    intentExpiry: event.intentExpiry,
    nonce: event.nonce.toString(),
    targetChainId: event.targetChainId.toString(),
  };
}

function deserializeEvent(
  event: SerializedIntentLifecycleRecord["event"],
): SolanaLiquidationIntentReadyEvent | undefined {
  if (!event) {
    return undefined;
  }
  return {
    loanId: BigInt(event.loanId),
    pool: event.pool,
    borrower: event.borrower,
    collateralMint: event.collateralMint,
    collateralAmount: BigInt(event.collateralAmount),
    debtOutstanding: BigInt(event.debtOutstanding),
    minimumRecoveryTarget: BigInt(event.minimumRecoveryTarget),
    liquidationMode: event.liquidationMode,
    liquidationUrgency: event.liquidationUrgency,
    intentExpiry: event.intentExpiry,
    nonce: BigInt(event.nonce),
    targetChainId: BigInt(event.targetChainId),
  };
}

function serializePayload(payload: EvmLiquidationIntentPayload): SerializedIntentLifecycleRecord["payload"] {
  return {
    loanId: payload.loanId.toString(),
    borrower: payload.borrower,
    collateralToken: payload.collateralToken,
    amountToLiquidate: payload.amountToLiquidate.toString(),
    debtOutstanding: payload.debtOutstanding.toString(),
    minimumRecoveryTarget: payload.minimumRecoveryTarget.toString(),
    liquidationMode: payload.liquidationMode,
    liquidationUrgency: payload.liquidationUrgency,
    approvedLiquidator: payload.approvedLiquidator,
    treasurySink: payload.treasurySink,
    feeOverrideBps: payload.feeOverrideBps,
    treasuryFeeSplitBps: payload.treasuryFeeSplitBps,
    maxLiquidationSize: payload.maxLiquidationSize.toString(),
    expiry: payload.expiry,
    nonce: payload.nonce.toString(),
    targetChainId: payload.targetChainId.toString(),
    sourceProgram: payload.sourceProgram,
  };
}

function deserializePayload(
  payload: SerializedIntentLifecycleRecord["payload"],
): EvmLiquidationIntentPayload | undefined {
  if (!payload) {
    return undefined;
  }
  return {
    loanId: BigInt(payload.loanId),
    borrower: payload.borrower,
    collateralToken: payload.collateralToken,
    amountToLiquidate: BigInt(payload.amountToLiquidate),
    debtOutstanding: BigInt(payload.debtOutstanding),
    minimumRecoveryTarget: BigInt(payload.minimumRecoveryTarget),
    liquidationMode: payload.liquidationMode,
    liquidationUrgency: payload.liquidationUrgency,
    approvedLiquidator: payload.approvedLiquidator,
    treasurySink: payload.treasurySink,
    feeOverrideBps: payload.feeOverrideBps,
    treasuryFeeSplitBps: payload.treasuryFeeSplitBps,
    maxLiquidationSize: BigInt(payload.maxLiquidationSize),
    expiry: payload.expiry,
    nonce: BigInt(payload.nonce),
    targetChainId: BigInt(payload.targetChainId),
    sourceProgram: payload.sourceProgram,
  };
}

function serializeRecord(record: IntentLifecycleRecord): SerializedIntentLifecycleRecord {
  return {
    key: record.key,
    loanId: record.loanId.toString(),
    borrower: record.borrower,
    status: record.status,
    discoveredAt: record.discoveredAt,
    lastUpdatedAt: record.lastUpdatedAt,
    event: record.event ? serializeEvent(record.event) : undefined,
    payload: record.payload ? serializePayload(record.payload) : undefined,
    evmTransactionHash: record.evmTransactionHash,
    errorMessage: record.errorMessage,
  };
}

function deserializeRecord(record: SerializedIntentLifecycleRecord): IntentLifecycleRecord {
  return {
    key: record.key,
    loanId: BigInt(record.loanId),
    borrower: record.borrower,
    status: record.status,
    discoveredAt: record.discoveredAt,
    lastUpdatedAt: record.lastUpdatedAt,
    event: deserializeEvent(record.event),
    payload: deserializePayload(record.payload),
    evmTransactionHash: record.evmTransactionHash,
    errorMessage: record.errorMessage,
  };
}

export class FileBackedIntentLifecycleStore implements IntentLifecycleStore {
  private readonly memory = new InMemoryIntentLifecycleStore();

  public constructor(private readonly filePath: string) {
    this.loadFromDisk();
  }

  public upsert(record: IntentLifecycleRecord): void {
    this.memory.upsert(record);
    this.persist();
  }

  public get(key: string): IntentLifecycleRecord | undefined {
    return this.memory.get(key);
  }

  public has(key: string): boolean {
    return this.memory.has(key);
  }

  public list(): IntentLifecycleRecord[] {
    return this.memory.list();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as SerializedIntentLifecycleRecord[];
    for (const record of parsed) {
      this.memory.upsert(deserializeRecord(record));
    }
  }

  private persist(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const serialized = this.memory.list().map(serializeRecord);
    fs.writeFileSync(this.filePath, JSON.stringify(serialized, null, 2));
  }
}

export function buildIntentKey(
  event: Pick<SolanaLiquidationIntentReadyEvent, "loanId" | "nonce" | "pool" | "targetChainId">,
): string {
  return [
    event.targetChainId.toString(),
    event.pool,
    event.loanId.toString(),
    event.nonce.toString(),
  ].join(":");
}
