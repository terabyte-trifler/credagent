import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  type InterfaceAbi,
  JsonRpcProvider,
  Wallet,
} from "ethers";
import { HttpEvmClient } from "./evmClient";
import { buildDemoSolanaIntentEvent } from "./fixtures";
import { createLogger } from "./logger";
import { type SolanaLiquidationIntentReadyEvent } from "./schema";
import { LiquidationRelayerService } from "./service";
import { StaticSolanaReader } from "./solanaReader";
import { InMemoryIntentLifecycleStore } from "./store";

const ANVIL_PORT = 9645;
const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const ANVIL_CHAIN_ID = 31337n;
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const LIQUIDATOR_PRIVATE_KEY = "0x8b3a350cf5c34c9194ca3a545d0b49e6d4b720adf0e7d887f6c4edb6f8d2f8e4";
const UNAUTHORIZED_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f09453852df9c0b02c4f3d5f6a5a6a9b7e8d5f3c";

type DemoScenarioResult = {
  name: string;
  expectedFailure: boolean;
  passed: boolean;
  detail: string;
};

type HardeningSummary = {
  anvilRpcUrl: string;
  configAddress: string;
  hookAddress: string;
  scenarios: DemoScenarioResult[];
  outputPath: string;
};

type DemoDeployment = {
  provider: JsonRpcProvider;
  deployer: Wallet;
  liquidator: Wallet;
  unauthorizedLiquidator: Wallet;
  collateralToken: Contract;
  proceedsToken: Contract;
  poolManager: Contract;
  config: Contract;
  hook: Contract;
  treasurySink: string;
  recoverySink: string;
};

type RevertLike = {
  data?: string;
  info?: {
    error?: {
      data?: string;
    };
  };
};

function artifact(contractName: string): { abi: InterfaceAbi; bytecode: string } {
  const filePath = path.resolve(
    __dirname,
    "../../evm-liquidation/artifacts",
    `${contractName}.json`,
  );
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as { abi: InterfaceAbi; bytecode: string };
}

async function waitForRpc(provider: JsonRpcProvider): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Anvil RPC did not become ready in time");
}

async function waitForReceipt(provider: JsonRpcProvider, transactionHash: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (receipt) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`receipt not found for transaction ${transactionHash}`);
}

function startAnvil(): ChildProcess {
  return spawn(
    "/Users/terabyte_trifler/.foundry/bin/anvil",
    ["--port", ANVIL_PORT.toString(), "--chain-id", ANVIL_CHAIN_ID.toString(), "--mnemonic", ANVIL_MNEMONIC],
    { stdio: "ignore" },
  );
}

async function deployContract(
  signer: Wallet,
  contractName: string,
  args: unknown[] = [],
  nonce?: number,
): Promise<Contract> {
  const { abi, bytecode } = artifact(contractName);
  const factory = new ContractFactory(abi, bytecode, signer);
  const deployArgs = nonce === undefined ? args : [...args, { nonce }];
  const contract = (await factory.deploy(...deployArgs)) as unknown as Contract;
  await contract.waitForDeployment();
  return contract;
}

function buildDemoEvent(overrides?: Partial<SolanaLiquidationIntentReadyEvent>): SolanaLiquidationIntentReadyEvent {
  const now = Math.floor(Date.now() / 1000);
  const base = buildDemoSolanaIntentEvent(now);
  return {
    ...base,
    pool: "SolanaPoolHardening111111111111111111111111111",
    borrower: "BorrowerSolanaPubkeyHardening11111111111111111",
    nonce: 11n,
    targetChainId: ANVIL_CHAIN_ID,
    ...overrides,
  };
}

async function setupDeployment(): Promise<DemoDeployment> {
  const provider = new JsonRpcProvider(ANVIL_RPC_URL, Number(ANVIL_CHAIN_ID));
  await waitForRpc(provider);

  const deployer = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
  const liquidator = new Wallet(LIQUIDATOR_PRIVATE_KEY, provider);
  const unauthorizedLiquidator = new Wallet(UNAUTHORIZED_PRIVATE_KEY, provider);
  let deployerNonce = await provider.getTransactionCount(deployer.address);

  const treasurySink = Wallet.createRandom().address;
  const recoverySink = Wallet.createRandom().address;

  const collateralToken = await deployContract(deployer, "MockERC20", ["Wrapped XAUT", "WXAUT", 6], deployerNonce++);
  const proceedsToken = await deployContract(deployer, "MockERC20", ["Tether USD", "USDT", 6], deployerNonce++);
  const poolManager = await deployContract(deployer, "MockPoolManager", [], deployerNonce++);
  const config = await deployContract(
    deployer,
    "LiquidationConfig",
    [ANVIL_CHAIN_ID, deployer.address, deployer.address],
    deployerNonce++,
  );
  const hook = await deployContract(
    deployer,
    "LiquidationUniV4Hook",
    [await config.getAddress(), await proceedsToken.getAddress(), await poolManager.getAddress()],
    deployerNonce++,
  );

  await (await poolManager.setAuthorizedHook(await hook.getAddress(), true, { nonce: deployerNonce++ })).wait();
  await (await proceedsToken.mint(await poolManager.getAddress(), 50_000_000_000n, { nonce: deployerNonce++ })).wait();

  return {
    provider,
    deployer,
    liquidator,
    unauthorizedLiquidator,
    collateralToken,
    proceedsToken,
    poolManager,
    config,
    hook,
    treasurySink,
    recoverySink,
  };
}

async function activateIntent(
  deployment: DemoDeployment,
  event: SolanaLiquidationIntentReadyEvent,
  approvedLiquidator: string,
): Promise<string> {
  const logger = createLogger({ service: "day10-hardening-relayer" });
  const store = new InMemoryIntentLifecycleStore();
  const relayer = new LiquidationRelayerService({
    config: {
      serviceName: "day10-hardening-relayer",
      environment: "test",
      storePath: ".relayer/day10-hardening.json",
      solanaRpcUrl: "http://127.0.0.1:8899",
      solanaProgramId: "Demo111111111111111111111111111111111111111",
      evmRpcUrl: ANVIL_RPC_URL,
      evmChainId: ANVIL_CHAIN_ID,
      evmConfigContract: await deployment.config.getAddress(),
      protocolSignerId: "day10-protocol-signer",
      protocolSignerAddress: deployment.deployer.address,
      protocolSignerPrivateKey: DEPLOYER_PRIVATE_KEY,
      approvedLiquidator,
      treasurySink: deployment.treasurySink,
      recoverySink: deployment.recoverySink,
      collateralToken: await deployment.collateralToken.getAddress(),
      feeOverrideBps: 75,
      treasuryFeeSplitBps: 500,
      pollIntervalMs: 1000,
      maxBatchSize: 10,
      dryRun: false,
    },
    logger,
    solanaReader: new StaticSolanaReader([event]),
    evmClient: new HttpEvmClient(
      {
        rpcUrl: ANVIL_RPC_URL,
        chainId: ANVIL_CHAIN_ID,
        configContract: await deployment.config.getAddress(),
        signerPrivateKey: DEPLOYER_PRIVATE_KEY,
      },
      logger.child({ component: "evm-client" }),
    ),
    store,
  });

  const result = await relayer.runOnce();
  if (result.submitted !== 1) {
    throw new Error(`expected 1 submitted intent, got ${result.submitted}`);
  }
  const lifecycle = store.list().find((record) => record.status === "submitted");
  if (!lifecycle?.evmTransactionHash) {
    throw new Error("missing submitted EVM transaction hash");
  }
  await waitForReceipt(deployment.provider, lifecycle.evmTransactionHash);
  return deployment.config.computeIntentKey(event.targetChainId, event.pool, event.loanId, event.nonce);
}

function buildPoolKey(deployment: DemoDeployment): {
  currency0: string;
  currency1: string;
  hooks: string;
  poolManager: string;
} {
  return {
    currency0: deployment.collateralToken.target as string,
    currency1: deployment.proceedsToken.target as string,
    hooks: deployment.hook.target as string,
    poolManager: deployment.poolManager.target as string,
  };
}

function decodeCustomError(contract: Contract, error: unknown): string {
  const revertData =
    (error as RevertLike | undefined)?.data ??
    (error as RevertLike | undefined)?.info?.error?.data;

  if (typeof revertData === "string") {
    try {
      const parsed = contract.interface.parseError(revertData);
      if (parsed) {
        return parsed.name;
      }
    } catch {
      return revertData;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

async function previewSwapExpectingFailure(
  deployment: DemoDeployment,
  intentKey: string,
  sender: string,
  sellAmount: bigint,
): Promise<string> {
  try {
    const previewData = deployment.hook.interface.encodeFunctionData("previewLiquidationSwap", [
      intentKey,
      sender,
      sellAmount,
    ]);
    await deployment.deployer.call({
      to: await deployment.hook.getAddress(),
      data: previewData,
    });
  } catch (error) {
    return decodeCustomError(deployment.hook, error);
  }

  throw new Error("expected swap to revert");
}

async function main(): Promise<void> {
  const anvil = startAnvil();

  try {
    const deployment = await setupDeployment();
    const scenarios: DemoScenarioResult[] = [];

    {
      const event = buildDemoEvent({ loanId: 301n, nonce: 21n, intentExpiry: Math.floor(Date.now() / 1000) + 3600 });
      const intentKey = await activateIntent(deployment, event, deployment.liquidator.address);
      const detail = await previewSwapExpectingFailure(
        deployment,
        intentKey,
        deployment.unauthorizedLiquidator.address,
        event.collateralAmount,
      );
      scenarios.push({
        name: "unauthorized-liquidator",
        expectedFailure: true,
        passed: detail.includes("UnauthorizedLiquidator"),
        detail,
      });
    }

    {
      const expiry = Math.floor(Date.now() / 1000) + 5;
      const event = buildDemoEvent({ loanId: 302n, nonce: 22n, intentExpiry: expiry });
      const intentKey = await activateIntent(deployment, event, deployment.liquidator.address);
      await deployment.provider.send("evm_increaseTime", [10]);
      await deployment.provider.send("evm_mine", []);
      const detail = await previewSwapExpectingFailure(
        deployment,
        intentKey,
        deployment.liquidator.address,
        event.collateralAmount,
      );
      scenarios.push({
        name: "expired-intent",
        expectedFailure: true,
        passed: detail.includes("LiquidationInactive"),
        detail,
      });
    }

    {
      const event = buildDemoEvent({
        loanId: 303n,
        nonce: 23n,
        collateralAmount: 2_500_000_000n,
        intentExpiry: Math.floor(Date.now() / 1000) + 3600,
      });
      const intentKey = await activateIntent(deployment, event, deployment.liquidator.address);
      const detail = await previewSwapExpectingFailure(
        deployment,
        intentKey,
        deployment.liquidator.address,
        event.collateralAmount + 1n,
      );
      scenarios.push({
        name: "sell-cap-overflow",
        expectedFailure: true,
        passed: detail.includes("SellAmountExceeded"),
        detail,
      });
    }

    const outputPath = path.resolve(__dirname, "../../../scripts/demo/day10-hardening-output.json");
    const summary: HardeningSummary = {
      anvilRpcUrl: ANVIL_RPC_URL,
      configAddress: await deployment.config.getAddress(),
      hookAddress: await deployment.hook.getAddress(),
      scenarios,
      outputPath,
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));

    if (scenarios.some((scenario) => !scenario.passed)) {
      throw new Error("one or more hardening scenarios did not fail as expected");
    }
  } finally {
    anvil.kill("SIGTERM");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
