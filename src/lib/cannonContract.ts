// InkSquidCannon contract addresses (per-chain) + ABI shared between
// server reveal routes and the wagmi-driven cannon game UI.
//
// Continuous distance = multiplier: `distanceBp` is basis points where
// 10_000 = 1.00×, 50_000 = 5.00×. Payout = bet × distanceBp / 10_000.
// 93% RTP, 5× cap, 7-band probability curve (same shape as chests but
// with within-band jitter so the number feels continuous).

import { ink, inkSepolia, soneiumMinato } from "@/config/chains";
import type { Chain } from "viem";

const INK_SEPOLIA_CANNON    = (process.env.NEXT_PUBLIC_CANNON_ADDRESS        ?? "") as `0x${string}`;
const SONEIUM_MINATO_CANNON = (process.env.NEXT_PUBLIC_CANNON_ADDRESS_MINATO ?? "") as `0x${string}`;

export function cannonAddressForChain(chainId: number | undefined): `0x${string}` | null {
  if (chainId === inkSepolia.id && INK_SEPOLIA_CANNON) return INK_SEPOLIA_CANNON;
  if (chainId === soneiumMinato.id && SONEIUM_MINATO_CANNON) return SONEIUM_MINATO_CANNON;
  return null;
}

export function explorerForCannonChain(chainId: number | undefined): string {
  if (chainId === soneiumMinato.id) return "https://soneium-minato.blockscout.com";
  if (chainId === ink.id) return "https://explorer.inkonchain.com";
  return "https://explorer-sepolia.inkonchain.com";
}

const serverNetwork = process.env.NEXT_PUBLIC_CANNON_CHAIN ?? process.env.NEXT_PUBLIC_CHEST_CHAIN ?? "ink_sepolia";
export const CANNON_NETWORK: Chain =
  serverNetwork === "soneium_minato" ? soneiumMinato : inkSepolia;
export const CANNON_ADDRESS: `0x${string}` =
  serverNetwork === "soneium_minato" ? SONEIUM_MINATO_CANNON : INK_SEPOLIA_CANNON;

// distanceBp is uint32 — 10_000 = 1.00×, 50_000 = 5.00×.
export const DISTANCE_SCALE = 10_000;
export const MAX_DISTANCE_BP = 50_000;

export const CANNON_ABI = [
  {
    type: "function", name: "minBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "maxBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "fire", stateMutability: "payable",
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
      { indexed: true,  name: "roundId",    type: "uint256" },
      { indexed: true,  name: "player",     type: "address" },
      { indexed: false, name: "betWei",     type: "uint256" },
      { indexed: false, name: "distanceBp", type: "uint32"  },
      { indexed: false, name: "payoutWei",  type: "uint256" },
    ],
  },
] as const;

/// Convert a rolled distanceBp into the visual distance in meters.
/// 10_000 bp = 100m, 50_000 bp = 500m. Purely cosmetic — payout math
/// uses distanceBp directly on-chain.
export function distanceBpToMeters(distanceBp: number): number {
  return Math.round(distanceBp / 100);
}

/// Convert distanceBp to its display multiplier (e.g. 13750 → 1.38×).
export function distanceBpToMultiplier(distanceBp: number): number {
  return distanceBp / DISTANCE_SCALE;
}
