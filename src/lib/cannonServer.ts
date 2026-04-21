// Server-side viem clients for the InkSquidCannon contract.
// Multi-chain aware: accepts a chainId and builds the right client.

import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { inkSepolia, soneiumMinato } from "@/config/chains";
import { cannonAddressForChain } from "./cannonContract";

function chainForId(chainId: number): Chain | null {
  if (chainId === inkSepolia.id) return inkSepolia;
  if (chainId === soneiumMinato.id) return soneiumMinato;
  return null;
}

export function cannonPublicClientFor(chainId: number) {
  const chain = chainForId(chainId);
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  return createPublicClient({ chain, transport: http() });
}

export function cannonResolverWalletFor(chainId: number) {
  const chain = chainForId(chainId);
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  const key = process.env.SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("SIGNER_PRIVATE_KEY not set");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  return createWalletClient({ account, chain, transport: http() });
}

export function cannonContractAddressFor(chainId: number): `0x${string}` {
  const a = cannonAddressForChain(chainId);
  if (!a) throw new Error(`no cannon contract deployed for chain ${chainId}`);
  return a;
}
