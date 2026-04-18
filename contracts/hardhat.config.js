require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const path = require("node:path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the locally-installed solc (node_modules/solc/soljson.js) instead of
// fetching it from binaries.soliditylang.org. Lets tests run in sandboxed
// or offline environments.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, _hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  }
  return runSuper(args);
});

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    inkMainnet: {
      url: process.env.INK_MAINNET_RPC || "https://rpc-gel.inkonchain.com",
      chainId: 57073,
      accounts,
    },
    inkSepolia: {
      url: process.env.INK_SEPOLIA_RPC || "https://rpc-gel-sepolia.inkonchain.com",
      chainId: 763373,
      accounts,
    },
  },
};
