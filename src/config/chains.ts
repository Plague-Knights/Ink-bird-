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
