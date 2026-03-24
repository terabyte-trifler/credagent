import { SigningKey, Wallet, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { SignedEvmLiquidationIntent, EvmLiquidationIntentPayload } from "./schema";

export interface CanonicalPayloadRecord {
  [key: string]: string;
}

export function toCanonicalPayloadRecord(payload: EvmLiquidationIntentPayload): CanonicalPayloadRecord {
  return {
    amountToLiquidate: payload.amountToLiquidate.toString(),
    approvedLiquidator: getAddress(payload.approvedLiquidator).toLowerCase(),
    borrower: getAddress(payload.borrower).toLowerCase(),
    collateralMint: payload.collateralMint,
    collateralToken: getAddress(payload.collateralToken).toLowerCase(),
    debtOutstanding: payload.debtOutstanding.toString(),
    expiry: payload.expiry.toString(),
    feeOverrideBps: payload.feeOverrideBps.toString(),
    liquidationMode: payload.liquidationMode,
    liquidationUrgency: payload.liquidationUrgency,
    loanId: payload.loanId.toString(),
    maxLiquidationSize: payload.maxLiquidationSize.toString(),
    minimumRecoveryTarget: payload.minimumRecoveryTarget.toString(),
    nonce: payload.nonce.toString(),
    pool: payload.pool,
    sourceProgram: payload.sourceProgram,
    targetChainId: payload.targetChainId.toString(),
    treasuryFeeSplitBps: payload.treasuryFeeSplitBps.toString(),
    treasurySink: getAddress(payload.treasurySink).toLowerCase(),
  };
}

export function canonicalizePayload(payload: EvmLiquidationIntentPayload): string {
  const record = toCanonicalPayloadRecord(payload);
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function hashCanonicalPayload(canonicalPayload: string): string {
  return keccak256(toUtf8Bytes(canonicalPayload));
}

export function deriveSignerAddress(privateKeyHex: string): string {
  return new Wallet(privateKeyHex).address;
}

export function signPayloadHash(payloadHash: string, privateKeyHex: string): string {
  const signature = new SigningKey(privateKeyHex).sign(payloadHash);
  return signature.serialized;
}

export function signLiquidationIntent(input: {
  payload: EvmLiquidationIntentPayload;
  protocolSignerId: string;
  protocolSignerAddress: string;
  privateKeyHex: string;
}): SignedEvmLiquidationIntent {
  const canonicalPayload = canonicalizePayload(input.payload);
  const payloadHash = hashCanonicalPayload(canonicalPayload);
  const derivedAddress = deriveSignerAddress(input.privateKeyHex);
  if (derivedAddress.toLowerCase() !== input.protocolSignerAddress.toLowerCase()) {
    throw new Error(
      `protocol signer address mismatch: derived=${derivedAddress} configured=${input.protocolSignerAddress}`,
    );
  }
  const signature = signPayloadHash(payloadHash, input.privateKeyHex);

  return {
    payload: input.payload,
    canonicalPayload,
    payloadHash,
    protocolSignerId: input.protocolSignerId,
    protocolSignerAddress: derivedAddress,
    signature,
  };
}
