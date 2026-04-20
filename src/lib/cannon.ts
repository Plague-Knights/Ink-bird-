import { keccak256, concat } from "viem";
import {
  CANNON_DATASET,
  CANNON_DATASET_SIZE,
  totalMultiplierBps,
  type CannonEvent,
} from "./cannonPayouts";

// outcomeIndex = uint32(keccak256(seed || salt)) mod CANNON_DATASET_SIZE.
// Identical construction to /dive — safe against modulo bias at 256
// (2^32 % 256 === 0) and re-computable by anyone who holds seed + salt.
export function cannonOutcomeIndexOf(
  seedHex: `0x${string}`,
  saltHex: `0x${string}`,
): number {
  const digest = keccak256(concat([seedHex, saltHex]));
  const low4 = digest.slice(-8);
  return parseInt(low4, 16) % CANNON_DATASET_SIZE;
}

export function cannonEventsFor(index: number): readonly CannonEvent[] {
  return CANNON_DATASET[index % CANNON_DATASET_SIZE];
}

// payout = sum(blot bps) / 10000 * bet, floored to wei.
export function cannonPayoutWei(totalBps: number, betWei: bigint): bigint {
  return (betWei * BigInt(totalBps)) / 10000n;
}

export { totalMultiplierBps };
