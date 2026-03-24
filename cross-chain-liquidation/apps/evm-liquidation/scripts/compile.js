const fs = require("node:fs");
const path = require("node:path");
const solc = require("solc");

const root = path.resolve(__dirname, "..");
const contractsDir = path.join(root, "contracts");
const sources = Object.fromEntries(
  fs
    .readdirSync(contractsDir)
    .filter((file) => file.endsWith(".sol"))
    .map((file) => [file, { content: fs.readFileSync(path.join(contractsDir, file), "utf8") }]),
);

const input = {
  language: "Solidity",
  sources,
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

const artifactsDir = path.join(root, "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });
for (const [sourceName, contracts] of Object.entries(output.contracts)) {
  for (const [contractName, contract] of Object.entries(contracts)) {
    fs.writeFileSync(
      path.join(artifactsDir, `${contractName}.json`),
      JSON.stringify(
        {
          contractName,
          sourceName,
          abi: contract.abi,
          bytecode: contract.evm.bytecode.object,
        },
        null,
        2,
      ),
    );
  }
}

console.log(`Compiled ${Object.keys(output.contracts).length} Solidity source files`);
