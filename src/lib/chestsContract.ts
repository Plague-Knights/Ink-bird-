// InkSquidChests contract addresses (per-chain) + ABI shared between
// server routes, the reveal worker, and the wagmi-driven /chests page.
//
// v2 — Moonsheep-style variable-bet game with a fixed 92.8% RTP curve.
// No weekly pool, no rebate, no chest cap. Player picks a bet within
// [minBet, maxBet]; contract rolls a single multiplier from the seed
// and pays bet × multiplier atomically.

import { ink, inkSepolia, soneiumMinato } from "@/config/chains";
import type { Chain } from "viem";

const INK_SEPOLIA_CHESTS    = (process.env.NEXT_PUBLIC_CHESTS_ADDRESS        ?? "") as `0x${string}`;
const SONEIUM_MINATO_CHESTS = (process.env.NEXT_PUBLIC_CHESTS_ADDRESS_MINATO ?? "") as `0x${string}`;

export function chestsAddressForChain(chainId: number | undefined): `0x${string}` | null {
  if (chainId === inkSepolia.id && INK_SEPOLIA_CHESTS) return INK_SEPOLIA_CHESTS;
  if (chainId === soneiumMinato.id && SONEIUM_MINATO_CHESTS) return SONEIUM_MINATO_CHESTS;
  return null;
}

export function explorerForChain(chainId: number | undefined): string {
  if (chainId === soneiumMinato.id) return "https://soneium-minato.blockscout.com";
  if (chainId === ink.id) return "https://explorer.inkonchain.com";
  return "https://explorer-sepolia.inkonchain.com";
}

// Back-compat exports used by server routes (which pick chain via env).
const serverNetwork = process.env.NEXT_PUBLIC_CHEST_CHAIN ?? "ink_sepolia";
export const CHEST_NETWORK: Chain =
  serverNetwork === "soneium_minato" ? soneiumMinato : inkSepolia;
export const CHESTS_ADDRESS: `0x${string}` =
  serverNetwork === "soneium_minato" ? SONEIUM_MINATO_CHESTS : INK_SEPOLIA_CHESTS;

// v2 ABI — variable-bet, single-multiplier-per-play game.
export const CHESTS_ABI = [
  {
    type: "function", name: "minBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "maxBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "play", stateMutability: "payable",
    inputs: [{ name: "seedHash", type: "bytes32" }],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    type: "function", name: "reveal", stateMutability: "nonpayable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "seed",    type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "event", name: "Played", inputs: [
      { indexed: true,  name: "roundId",  type: "uint256" },
      { indexed: true,  name: "player",   type: "address" },
      { indexed: false, name: "seedHash", type: "bytes32" },
      { indexed: false, name: "betWei",   type: "uint256" },
    ],
  },
  {
    type: "event", name: "Resolved", inputs: [
      { indexed: true,  name: "roundId",              type: "uint256" },
      { indexed: true,  name: "player",               type: "address" },
      { indexed: false, name: "betWei",               type: "uint256" },
      { indexed: false, name: "multiplierThousandths",type: "uint16" },
      { indexed: false, name: "payoutWei",            type: "uint256" },
    ],
  },
] as const;
