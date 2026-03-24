import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";

const ROOT = process.cwd();
const releasePath = path.join(
  ROOT,
  "programs/lending_pool/src/instructions/release_collateral.rs",
);
const liquidatePath = path.join(
  ROOT,
  "programs/lending_pool/src/instructions/liquidate_escrow.rs",
);

describe("SEC-01: Escrow Unauthorized Access", () => {
  const releaseSource = fs.readFileSync(releasePath, "utf8");
  const liquidateSource = fs.readFileSync(liquidatePath, "utf8");

  it("ATK-1: release requires loan status Repaid", () => {
    expect(releaseSource).to.include("constraint = loan.status == LoanStatus::Repaid @ LendError::LoanNotFullyRepaid");
  });

  it("ATK-2: release requires escrow to remain Locked", () => {
    expect(releaseSource).to.include("constraint = escrow_state.status == EscrowStatus::Locked @ LendError::EscrowFinalized");
  });

  it("ATK-3: release binds the escrow to the borrower", () => {
    expect(releaseSource).to.include("constraint = escrow_state.borrower == borrower.key()");
    expect(releaseSource).to.include("constraint = loan.escrow == escrow_state.key()");
  });

  it("ATK-4: release transfers with PDA signer, not caller authority", () => {
    expect(releaseSource).to.include("authority: ctx.accounts.escrow_state.to_account_info()");
    expect(releaseSource).to.include("CpiContext::new_with_signer");
  });

  it("ATK-5: liquidation requires loan status Defaulted", () => {
    expect(liquidateSource).to.include("constraint = loan.status == LoanStatus::Defaulted @ LendError::NotActive");
  });

  it("ATK-6: liquidation also uses PDA signer and finalizes escrow state", () => {
    expect(liquidateSource).to.include("authority: ctx.accounts.escrow_state.to_account_info()");
    expect(liquidateSource).to.include("e.status = EscrowStatus::Liquidated;");
  });

  it("ATK-7: liquidation recipient must be protocol-controlled and mint-matched", () => {
    expect(liquidateSource).to.include("constraint = loan.pool == pool_state.key()");
    expect(liquidateSource).to.include("constraint = liquidation_recipient.mint == escrow_state.collateral_mint @ LendError::MintMismatch");
    expect(liquidateSource).to.include("constraint = liquidation_recipient.owner == pool_state.authority @ LendError::UnauthorizedAgent");
  });
});
