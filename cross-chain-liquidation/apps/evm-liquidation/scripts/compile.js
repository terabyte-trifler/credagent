const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");

const root = path.resolve(__dirname, "..");
const contractPath = path.join(root, "contracts", "LiquidationConfig.sol");
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "LiquidationConfig.sol": {
      content: source,
    },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    viaIR: true,
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatalErrors = output.errors.filter((entry) => entry.severity === "error");
  for (const entry of output.errors) {
    console.log(`${entry.severity.toUpperCase()}: ${entry.formattedMessage}`);
  }
  if (fatalErrors.length > 0) {
    process.exit(1);
  }
}

const contract = output.contracts["LiquidationConfig.sol"]["LiquidationConfig"];
const artifactsDir = path.join(root, "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactsDir, "LiquidationConfig.json"),
  JSON.stringify(
    {
      contractName: "LiquidationConfig",
      abi: contract.abi,
      bytecode: contract.evm.bytecode.object,
    },
    null,
    2,
  ),
);

console.log("Compiled LiquidationConfig");
