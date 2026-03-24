import { buildDemoSolanaIntentEvent } from "./fixtures";
import { buildEvmLiquidationIntentPayload } from "./schema";
import { deriveSignerAddress, signLiquidationIntent } from "./signer";

export function buildSignedDemoIntent(nowUnixTs: number) {
  const privateKeyHex = "0x59c6995e998f97a5a0044976f7d5d2f8d4ea0b4108ffbd05fbd7dd7f2d7bc5f3";
  const event = buildDemoSolanaIntentEvent(nowUnixTs);
  const payload = buildEvmLiquidationIntentPayload({
    event,
    collateralToken: "0x00000000000000000000000000000000000000CC",
    approvedLiquidator: "0x00000000000000000000000000000000000000AA",
    treasurySink: "0x00000000000000000000000000000000000000BB",
    feeOverrideBps: 30,
    treasuryFeeSplitBps: 50,
  });

  return signLiquidationIntent({
    payload,
    protocolSignerId: "protocol-signer-dev",
    protocolSignerAddress: deriveSignerAddress(privateKeyHex),
    privateKeyHex,
  });
}
