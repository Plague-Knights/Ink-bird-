require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

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
