// Server-side viem clients for the InkSquidGame contract. Multi-chain:
// Ink Sepolia, Ink mainnet, Soneium Minato, Soneium mainnet — whichever
// has an address env var set (see gameContract.ts).

import { createPublicClient, createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ink, inkSepolia, soneium, soneiumMinato } from "@/config/chains";
import { gameAddressForChain } from "./gameContract";

function chainForId(chainId: number): Chain | null {
  if (chainId === ink.id)           return ink;
  if (chainId === inkSepolia.id)    return inkSepolia;
  if (chainId === soneium.id)       return soneium;
  if (chainId === soneiumMinato.id) return soneiumMinato;
  return null;
}

export function gamePublicClientFor(chainId: number) {
  const chain = chainForId(chainId);
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  return createPublicClient({ chain, transport: http() });
}

/// Resolver key. Short-term single `SIGNER_PRIVATE_KEY` env; mainnet plan
/// is per-chain keys (SIGNER_PRIVATE_KEY_INK / _SONEIUM) + eventually KMS
/// (see security_gaps.md). The two-key lookup below is a forward-compat
/// hook — if a chain-specific key is set it wins.
export function gameResolverWalletFor(chainId: number) {
  const chain = chainForId(chainId);
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  const key =
       (chainId === ink.id           && process.env.SIGNER_PRIVATE_KEY_INK)
    || (chainId === soneium.id       && process.env.SIGNER_PRIVATE_KEY_SONEIUM)
    || (chainId === inkSepolia.id    && process.env.SIGNER_PRIVATE_KEY_INK_SEPOLIA)
    || (chainId === soneiumMinato.id && process.env.SIGNER_PRIVATE_KEY_MINATO)
    ||  process.env.SIGNER_PRIVATE_KEY;
  if (!key) throw new Error("SIGNER_PRIVATE_KEY not set");
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(normalized as `0x${string}`);
  return createWalletClient({ account, chain, transport: http() });
}

export function gameAddressFor(chainId: number): `0x${string}` {
  const a = gameAddressForChain(chainId);
  if (!a) throw new Error(`no InkSquidGame deployed on chain ${chainId}`);
  return a;
}
