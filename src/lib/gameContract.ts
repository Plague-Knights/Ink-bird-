// InkSquidGame — unified chests+cannon contract (see
// contracts/src/InkSquidGame.sol). Player-seed commit-reveal, 92.8% RTP
// curve, 1h claimTimeout refund path, Ownable2Step owner (mainnet owner
// will be a Safe multisig — see repo memory safe_ownership_plan.md).
//
// Per-chain address env vars (all optional; missing = not deployed on
// that chain yet):
//   NEXT_PUBLIC_GAME_ADDRESS            (Ink Sepolia)
//   NEXT_PUBLIC_GAME_ADDRESS_INK        (Ink mainnet)
//   NEXT_PUBLIC_GAME_ADDRESS_MINATO     (Soneium Minato)
//   NEXT_PUBLIC_GAME_ADDRESS_SONEIUM    (Soneium mainnet)

import { ink, inkSepolia, soneium, soneiumMinato } from "@/config/chains";
import type { Chain } from "viem";

const INK_SEPOLIA_GAME    = (process.env.NEXT_PUBLIC_GAME_ADDRESS         ?? "") as `0x${string}`;
const INK_MAINNET_GAME    = (process.env.NEXT_PUBLIC_GAME_ADDRESS_INK     ?? "") as `0x${string}`;
const SONEIUM_MINATO_GAME = (process.env.NEXT_PUBLIC_GAME_ADDRESS_MINATO  ?? "") as `0x${string}`;
const SONEIUM_GAME        = (process.env.NEXT_PUBLIC_GAME_ADDRESS_SONEIUM ?? "") as `0x${string}`;

export function gameAddressForChain(chainId: number | undefined): `0x${string}` | null {
  if (chainId === inkSepolia.id    && INK_SEPOLIA_GAME)    return INK_SEPOLIA_GAME;
  if (chainId === ink.id           && INK_MAINNET_GAME)    return INK_MAINNET_GAME;
  if (chainId === soneiumMinato.id && SONEIUM_MINATO_GAME) return SONEIUM_MINATO_GAME;
  if (chainId === soneium.id       && SONEIUM_GAME)        return SONEIUM_GAME;
  return null;
}

export function explorerForGameChain(chainId: number | undefined): string {
  if (chainId === ink.id)           return "https://explorer.inkonchain.com";
  if (chainId === soneium.id)       return "https://soneium.blockscout.com";
  if (chainId === soneiumMinato.id) return "https://soneium-minato.blockscout.com";
  return "https://explorer-sepolia.inkonchain.com";
}

/// List of chains where the unified game contract has been deployed.
/// Used by RainbowKit to populate the wallet chain switcher and by the
/// campaign endpoint to decide where to scan.
export function supportedGameChains(): Chain[] {
  const out: Chain[] = [];
  if (INK_MAINNET_GAME)    out.push(ink);
  if (SONEIUM_GAME)        out.push(soneium);
  if (INK_SEPOLIA_GAME)    out.push(inkSepolia);
  if (SONEIUM_MINATO_GAME) out.push(soneiumMinato);
  return out;
}

/// Every chain where the game contract MIGHT be deployed — the wallet
/// chain switcher needs to offer them even if env isn't filled yet so
/// the user can switch before we detect the deploy.
export function allGameChains(): Chain[] {
  return [ink, soneium, inkSepolia, soneiumMinato];
}

// ABI — mirrors contracts/src/InkSquidGame.sol. Matches chestsContract.ts
// inline-ABI pattern.
export const GAME_ABI = [
  {
    type: "function", name: "minBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "maxBet", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "resolver", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "owner", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "pendingOwner", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "inFlightBetsWei", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "REVEAL_TIMEOUT", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "play", stateMutability: "payable",
    inputs: [
      { name: "serverSeedHash", type: "bytes32" },
      { name: "playerSeed",     type: "bytes32" },
    ],
    outputs: [{ name: "roundId", type: "uint256" }],
  },
  {
    type: "function", name: "reveal", stateMutability: "nonpayable",
    inputs: [
      { name: "roundId",    type: "uint256" },
      { name: "serverSeed", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "claimTimeout", stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function", name: "acceptOwnership", stateMutability: "nonpayable",
    inputs: [], outputs: [],
  },
  {
    type: "event", name: "Played", inputs: [
      { indexed: true,  name: "roundId",        type: "uint256" },
      { indexed: true,  name: "player",         type: "address" },
      { indexed: false, name: "serverSeedHash", type: "bytes32" },
      { indexed: false, name: "playerSeed",     type: "bytes32" },
      { indexed: false, name: "betWei",         type: "uint256" },
    ],
  },
  {
    type: "event", name: "Resolved", inputs: [
      { indexed: true,  name: "roundId",                type: "uint256" },
      { indexed: true,  name: "player",                 type: "address" },
      { indexed: false, name: "betWei",                 type: "uint256" },
      { indexed: false, name: "multiplierThousandths",  type: "uint16"  },
      { indexed: false, name: "payoutWei",              type: "uint256" },
      { indexed: false, name: "roll",                   type: "bytes32" },
    ],
  },
  {
    type: "event", name: "Refunded", inputs: [
      { indexed: true,  name: "roundId", type: "uint256" },
      { indexed: true,  name: "player",  type: "address" },
      { indexed: false, name: "betWei",  type: "uint256" },
    ],
  },
] as const;
