import { keccak256, concat } from "viem";

// Launch-mode payout curve. Unlike /cannon (RNG dataset lookup), /launch
// outcome depends on player skill — how many pipes they clear. The house
// edge is baked into the curve shape: most players land in the
// low-break-even range, a mid-skill player clears enough pipes to
// clearly profit, and there's a cap so a pro who parks on the game
// forever doesn't strip infinite value.
//
// Calibration (illustrative, tune after measuring real play):
//   0 pipes    -> 0x     (miss on launch, dead bet)
//   5 pipes    -> 0.3x   (limped start, small consolation)
//  10 pipes    -> 0.8x   (close to break-even)
//  20 pipes    -> 1.6x   (small profit)
//  40 pipes    -> 3.0x   (solid skill)
//  80 pipes    -> 5.0x   (pro run)
// 150+ pipes   -> 7.0x   (hard cap — prevents tenure-based extraction)
//
// Piecewise-linear interpolation between anchor points. Floors and
// caps are enforced in payoutWei.

const CURVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [5, 0.3],
  [10, 0.8],
  [20, 1.6],
  [40, 3.0],
  [80, 5.0],
  [150, 7.0],
];
const MAX_MULT = 7.0;

export function scoreToMultiplier(score: number): number {
  if (score <= 0) return 0;
  if (score >= CURVE[CURVE.length - 1][0]) return MAX_MULT;
  for (let i = 1; i < CURVE.length; i++) {
    const [sA, mA] = CURVE[i - 1];
    const [sB, mB] = CURVE[i];
    if (score <= sB) {
      const t = (score - sA) / (sB - sA);
      return mA + t * (mB - mA);
    }
  }
  return MAX_MULT;
}

// payout = score-multiplier * bet, floored to wei. Integer bigint math
// by scaling the multiplier to bps (10000 = 1.0x) so we don't lose
// precision on wei.
export function launchPayoutWei(score: number, betWei: bigint): bigint {
  const mult = scoreToMultiplier(score);
  const bps = BigInt(Math.floor(mult * 10000));
  return (betWei * bps) / 10000n;
}

// Derive the numeric sim seed for the flappy PRNG from the
// committed-then-revealed byte seed and the player's salt. This binds
// the exact obstacle layout to the commitment — the server can't swap
// seeds after seeing the salt, and the player can reproduce it from
// the reveal.
//
// Returns a uint32 (0..2^32-1). simulate.ts's Mulberry32 seeds are 32-
// bit, so we take the low 4 bytes of keccak256(seed || salt).
export function simSeedFrom(
  seedHex: `0x${string}`,
  saltHex: `0x${string}`,
): number {
  const digest = keccak256(concat([seedHex, saltHex]));
  const low4 = digest.slice(-8);
  // parseInt is safe here because 0xFFFFFFFF < Number.MAX_SAFE_INTEGER.
  return parseInt(low4, 16) >>> 0;
}
