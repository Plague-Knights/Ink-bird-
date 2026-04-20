import { keccak256, toHex, concat } from "viem";
import { DIVE_DATASETS, type Tier } from "./divePayouts";

export const DIVE_TIERS: readonly Tier[] = ["low", "mid", "high"] as const;

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && (DIVE_TIERS as readonly string[]).includes(v);
}

export function hashSeed(seedHex: `0x${string}`): `0x${string}` {
  return keccak256(seedHex);
}

// outcomeIndex = uint32(keccak256(seed || salt)) mod 256.
// Both inputs are 32-byte hex strings so concat gives a 64-byte payload.
export function outcomeIndexOf(
  seedHex: `0x${string}`,
  saltHex: `0x${string}`,
): number {
  const digest = keccak256(concat([seedHex, saltHex]));
  // Take the low 4 bytes for the index; 2^32 is divisible into 256 evenly
  // so there's no modulo bias at the dataset size we use.
  const low4 = digest.slice(-8);
  return parseInt(low4, 16) % DIVE_DATASETS.low.length;
}

export function distanceFor(tier: Tier, index: number): number {
  const ds = DIVE_DATASETS[tier];
  return ds[index % ds.length];
}

// payout = distance / 100 * bet, floored to wei.
export function payoutWei(distance: number, betWei: bigint): bigint {
  return (betWei * BigInt(distance)) / 100n;
}

export function randomSeedHex(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

export function isHex32(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
