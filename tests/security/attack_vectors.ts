import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";

const ROOT = process.cwd();
const conditionalDisbursePath = path.join(
  ROOT,
  "programs/lending_pool/src/instructions/conditional_disburse.rs",
);
const initializePoolPath = path.join(
  ROOT,
  "programs/lending_pool/src/instructions/initialize_pool.rs",
);
const safetyMiddlewarePath = path.join(
  ROOT,
  "wdk-service/src/safetyMiddleware.js",
);
const oracleStatePath = path.join(
  ROOT,
  "programs/credit_score_oracle/src/state.rs",
);
const recordLoanEventPath = path.join(
  ROOT,
  "programs/credit_score_oracle/src/instructions/record_loan_event.rs",
);
const oracleLibPath = path.join(
  ROOT,
  "programs/credit_score_oracle/src/lib.rs",
);

describe("SEC-02: Conditional Gate Bypass", () => {
  const source = fs.readFileSync(conditionalDisbursePath, "utf8");

  it("GATE-1: credit score expiry is enforced on-chain", () => {
    expect(source).to.include("require!(expires_at > now, LendError::InvalidScore);");
  });

  it("GATE-1: minimum risk tier is enforced on-chain", () => {
    expect(source).to.include("let starter_profile = principal <= STARTER_MAX_PRINCIPAL");
    expect(source).to.include("&& duration_days <= STARTER_MAX_DURATION_DAYS");
    expect(source).to.include("&& interest_rate_bps >= STARTER_MIN_RATE_BPS;");
    expect(source).to.include("require!(risk_tier >= 1 || starter_profile, LendError::ScoreTooLow);");
  });

  it("GATE-2: escrow lock is enforced by account constraints", () => {
    expect(source).to.include("constraint = escrow_state.status == EscrowStatus::Locked @ LendError::EscrowNotLocked");
    expect(source).to.include("constraint = escrow_state.borrower == borrower.key() @ LendError::InvalidScore");
  });

  it("GATE-2: collateral floor is enforced on-chain for the MVP pair", () => {
    expect(source).to.include("pool.collateral_price_usdt_6 > 0");
    expect(source).to.include("price_age >= 0 && price_age <= pool.max_price_age_secs");
    expect(source).to.include("let collateral_value = compute_collateral_value_from_price_usdt_6(");
    expect(source).to.include("let minimum_collateral_value = (principal as u128)");
    expect(source).to.include("(collateral_value as u128) >= minimum_collateral_value");
  });

  it("GATE-3: utilization cap is enforced before transfer", () => {
    expect(source).to.include("require!(new_util <= pool.max_utilization_bps, LendError::UtilizationExceeded);");
    expect(source).to.include("require!(principal <= available, LendError::InsufficientLiquidity);");
  });

  it("GATE-4: disbursement requires lending role and manage tier via CPI", () => {
    expect(source).to.include("AgentRole::Lending");
    expect(source).to.include("PermissionTier::Manage");
    expect(source).to.include("agent_permissions::cpi::check_permission_and_spend");
  });

  it("ALL GATES: no token transfer occurs before the checks", () => {
    const gate4Index = source.indexOf("agent_permissions::cpi::check_permission_and_spend");
    const transferIndex = source.indexOf("token::transfer(CpiContext::new_with_signer");
    expect(gate4Index).to.be.greaterThan(-1);
    expect(transferIndex).to.be.greaterThan(-1);
    expect(gate4Index).to.be.lessThan(transferIndex);
  });
});

describe("SEC-02B: Oracle Bootstrap Safety", () => {
  const source = fs.readFileSync(initializePoolPath, "utf8");

  it("initialize_pool starts with no seeded collateral price", () => {
    expect(source).to.include("p.collateral_price_usdt_6 = 0;");
    expect(source).to.include("p.collateral_price_updated_at = 0;");
    expect(source).to.not.include("DEFAULT_XAUT_PRICE_USDT_6");
  });
});

describe("SEC-03: Double Pull / Pause Safety Middleware", () => {
  const source = fs.readFileSync(safetyMiddlewarePath, "utf8");

  it("conditional_disburse is blocked while paused", () => {
    expect(source).to.match(/BLOCKED_WHEN_PAUSED[\s\S]*'conditional_disburse'/);
  });

  it("push_score_onchain is blocked while paused", () => {
    expect(source).to.match(/BLOCKED_WHEN_PAUSED[\s\S]*'push_score_onchain'/);
  });

  it("mark_default is not blocked during pause", () => {
    const blockedSet = source.match(/const BLOCKED_WHEN_PAUSED = new Set\(\[([\s\S]*?)\]\);/);
    expect(blockedSet?.[1] || "").to.not.include("'mark_default'");
  });

  it("daily spending limits are prevalidated before conditional disbursement", () => {
    expect(source).to.include("if (toolName === 'conditional_disburse' && params.principal)");
    expect(source).to.include("LIMIT_EXCEEDED");
  });
});

describe("SEC-04: Runtime Truthfulness", () => {
  const mcpSource = fs.readFileSync(
    path.join(ROOT, "wdk-service/src/mcpBridge.js"),
    "utf8",
  );
  const demoSource = fs.readFileSync(
    path.join(ROOT, "scripts/run-demo.ts"),
    "utf8",
  );

  it("program call builder labels instruction builds as unsubmitted", () => {
    expect(mcpSource).to.include("status: 'instruction_built'");
    expect(mcpSource).to.include("submitted: false");
    expect(mcpSource).to.include("confirmed: false");
  });

  it("demo script warns that narrated steps are not chain proof", () => {
    expect(demoSource).to.include("Most protocol lifecycle steps below remain narrated/demo checkpoints");
    expect(demoSource).to.include("Narrative checkpoint only. Use scripts/init-agents.ts for real registration.");
  });
});

describe("SEC-05: Credit History Write Isolation", () => {
  const oracleStateSource = fs.readFileSync(oracleStatePath, "utf8");
  const recordLoanEventSource = fs.readFileSync(recordLoanEventPath, "utf8");
  const oracleLibSource = fs.readFileSync(oracleLibPath, "utf8");

  it("OracleState keeps a dedicated history_authority separate from admin", () => {
    expect(oracleStateSource).to.include("pub history_authority: Pubkey");
  });

  it("record_loan_event requires history_authority, not generic oracle authority", () => {
    expect(recordLoanEventSource).to.include("oracle_state.history_authority == ctx.accounts.authority.key()");
    expect(recordLoanEventSource).not.to.include("pub oracle_authority");
  });

  it("admin can rotate history authority explicitly", () => {
    expect(oracleLibSource).to.include("pub fn set_history_authority");
  });
});
