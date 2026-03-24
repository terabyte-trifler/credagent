import fs from "node:fs";
import path from "node:path";
import { EvmLiquidationIntentPayload, SignedEvmLiquidationIntent, SolanaLiquidationIntentReadyEvent } from "./schema";

export type IntentLifecycleStatus =
  | "discovered"
  | "validated"
  | "submitted"
  | "dry_run"
  | "failed";

export interface IntentLifecycleRecord {
  key: string;
  loanId: bigint;
  pool?: string;
  borrower: string;
  status: IntentLifecycleStatus;
  discoveredAt: string;
  lastUpdatedAt: string;
  event?: SolanaLiquidationIntentReadyEvent;
  payload?: EvmLiquidationIntentPayload;
  signedIntent?: SignedEvmLiquidationIntent;
  evmTransactionHash?: string;
  errorMessage?: string;
}

export interface IntentLifecycleStore {
  upsert(record: IntentLifecycleRecord): void;
  get(key: string): IntentLifecycleRecord | undefined;
  has(key: string): boolean;
  list(): IntentLifecycleRecord[];
  getHighestNonce(scopeKey: string): bigint | undefined;
  setHighestNonce(scopeKey: string, nonce: bigint): void;
}

export class InMemoryIntentLifecycleStore implements IntentLifecycleStore {
  private readonly records = new Map<string, IntentLifecycleRecord>();
  private readonly nonceWatermarks = new Map<string, bigint>();

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

  public getHighestNonce(scopeKey: string): bigint | undefined {
    return this.nonceWatermarks.get(scopeKey);
  }

  public setHighestNonce(scopeKey: string, nonce: bigint): void {
    const current = this.nonceWatermarks.get(scopeKey);
    if (current === undefined || nonce > current) {
      this.nonceWatermarks.set(scopeKey, nonce);
    }
  }
}

interface SerializedIntentLifecycleRecord {
  key: string;
  loanId: string;
  pool?: string;
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
    pool: string;
    borrower: string;
    collateralMint: string;
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
  signedIntent?: {
    canonicalPayload: string;
    payloadHash: string;
    protocolSignerId: string;
    protocolSignerAddress: string;
    signature: string;
  };
  evmTransactionHash?: string;
  errorMessage?: string;
}

interface SerializedStoreSnapshot {
  records: SerializedIntentLifecycleRecord[];
  nonceWatermarks: Record<string, string>;
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
    pool: payload.pool,
    borrower: payload.borrower,
    collateralMint: payload.collateralMint,
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
    pool: payload.pool,
    borrower: payload.borrower,
    collateralMint: payload.collateralMint,
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
    pool: record.pool,
    borrower: record.borrower,
    status: record.status,
    discoveredAt: record.discoveredAt,
    lastUpdatedAt: record.lastUpdatedAt,
    event: record.event ? serializeEvent(record.event) : undefined,
    payload: record.payload ? serializePayload(record.payload) : undefined,
    signedIntent: record.signedIntent
      ? {
          canonicalPayload: record.signedIntent.canonicalPayload,
          payloadHash: record.signedIntent.payloadHash,
          protocolSignerId: record.signedIntent.protocolSignerId,
          protocolSignerAddress: record.signedIntent.protocolSignerAddress,
          signature: record.signedIntent.signature,
        }
      : undefined,
    evmTransactionHash: record.evmTransactionHash,
    errorMessage: record.errorMessage,
  };
}

function deserializeRecord(record: SerializedIntentLifecycleRecord): IntentLifecycleRecord {
  return {
    key: record.key,
    loanId: BigInt(record.loanId),
    pool: record.pool,
    borrower: record.borrower,
    status: record.status,
    discoveredAt: record.discoveredAt,
    lastUpdatedAt: record.lastUpdatedAt,
    event: deserializeEvent(record.event),
    payload: deserializePayload(record.payload),
    signedIntent:
      record.signedIntent && deserializePayload(record.payload)
        ? {
            payload: deserializePayload(record.payload)!,
            canonicalPayload: record.signedIntent.canonicalPayload,
            payloadHash: record.signedIntent.payloadHash,
            protocolSignerId: record.signedIntent.protocolSignerId,
            protocolSignerAddress: record.signedIntent.protocolSignerAddress,
            signature: record.signedIntent.signature,
          }
        : undefined,
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

  public getHighestNonce(scopeKey: string): bigint | undefined {
    return this.memory.getHighestNonce(scopeKey);
  }

  public setHighestNonce(scopeKey: string, nonce: bigint): void {
    this.memory.setHighestNonce(scopeKey, nonce);
    this.persist();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as SerializedStoreSnapshot | SerializedIntentLifecycleRecord[];
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    for (const record of records) {
      this.memory.upsert(deserializeRecord(record));
    }
    if (!Array.isArray(parsed)) {
      for (const [scopeKey, nonce] of Object.entries(parsed.nonceWatermarks)) {
        this.memory.setHighestNonce(scopeKey, BigInt(nonce));
      }
    }
  }

  private persist(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const snapshot: SerializedStoreSnapshot = {
      records: this.memory.list().map(serializeRecord),
      nonceWatermarks: {},
    };
    const watermarks: Record<string, string> = {};
    for (const record of this.memory.list()) {
      if (record.event) {
        const scopeKey = buildNonceScopeKey(record.event);
        const nonce = this.memory.getHighestNonce(scopeKey);
        if (nonce !== undefined) {
          watermarks[scopeKey] = nonce.toString();
        }
      }
    }
    snapshot.nonceWatermarks = watermarks;
    fs.writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2));
  }
}

export function buildNonceScopeKey(
  event: Pick<SolanaLiquidationIntentReadyEvent, "loanId" | "pool" | "targetChainId">,
): string {
  return [
    event.targetChainId.toString(),
    event.pool,
    event.loanId.toString(),
  ].join(":");
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
