import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const inkMainnet = defineChain({
  id: 57073,
  name: "Ink",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.INK_MAINNET_RPC || "https://rpc-gel.inkonchain.com"] },
  },
});

export const ARCADE_ABI = [
  {
    type: "event",
    name: "EntryPurchased",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "weekId", type: "uint256", indexed: true },
      { name: "credits", type: "uint256", indexed: false },
      { name: "poolAmount", type: "uint256", indexed: false },
      { name: "treasuryAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "settleWeek",
    stateMutability: "nonpayable",
    inputs: [
      { name: "weekId", type: "uint256" },
      { name: "root", type: "bytes32" },
      { name: "totalPayout", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "currentWeekId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "weekPool",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "weekSettledAt",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "weekRoot",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
];

export function publicClient() {
  return createPublicClient({ chain: inkMainnet, transport: http() });
}

export function operatorClient() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error("OPERATOR_PRIVATE_KEY not set");
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: inkMainnet, transport: http() });
}

export function arcadeAddress() {
  const a = process.env.ARCADE_ADDRESS;
  if (!a) throw new Error("ARCADE_ADDRESS not set");
  return a;
}
