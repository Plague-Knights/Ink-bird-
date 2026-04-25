import { defineChain } from "viem";

export const ink = defineChain({
  id: 57073,
  name: "INK",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-gel.inkonchain.com"] },
  },
  blockExplorers: {
    default: { name: "INK Explorer", url: "https://explorer.inkonchain.com" },
  },
});

export const inkSepolia = defineChain({
  id: 763373,
  name: "INK Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-gel-sepolia.inkonchain.com"] },
  },
  blockExplorers: {
    default: {
      name: "INK Sepolia Explorer",
      url: "https://explorer-sepolia.inkonchain.com",
    },
  },
  testnet: true,
});

// Soneium Minato testnet — supported alongside Ink Sepolia for the
// chest game so players can try whichever testnet they already have
// gas on. Chain id 1946.
export const soneiumMinato = defineChain({
  id: 1946,
  name: "Soneium Minato",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.minato.soneium.org"] },
  },
  blockExplorers: {
    default: { name: "Soneium Minato Blockscout", url: "https://soneium-minato.blockscout.com" },
  },
  testnet: true,
});

// Soneium mainnet (chainId 1868) — mainnet target for the unified
// InkSquidGame contract alongside Ink mainnet.
export const soneium = defineChain({
  id: 1868,
  name: "Soneium",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.soneium.org"] },
  },
  blockExplorers: {
    default: { name: "Soneium Blockscout", url: "https://soneium.blockscout.com" },
  },
});
