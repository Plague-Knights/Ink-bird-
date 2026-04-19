// Weekly prize distribution for Ink Squid.
//
// The contract (InkSquidArcade.sol) doesn't hard-code a curve — it splits the
// pool 75% players / 25% treasury, then verifies claims against a Merkle root
// the backend posts. This file defines the payout curve the backend uses to
// build that root.
//
// Policy: heavy at top, long tail — top 20 finishers share 100% of the player
// share. Rank 1 takes 40% of the player share (= 30% of total weekly pool).

export const PLAYER_SHARE_BPS = 7500; // 75% of pool goes to players; rest to treasury
export const BPS_DENOM = 10_000;

// Off-chain referral cut: when a buyer was referred, this slice of their
// weekly pack spend is credited to the referrer as an extra merkle leaf.
// Comes out of the player share (same 75% pot that funds placements), so
// sum(placements) + sum(referrals) still fits under the on-chain cap.
export const REFERRAL_BPS = 500; // 5%

// Share of the PLAYER pool (not total pool) per rank, in basis points of
// PLAYER_SHARE_BPS. Must sum to 10000.
export const PAYOUT_CURVE_BPS: readonly number[] = [
  4000, // rank 1  — 40%
  1800, // rank 2  — 18%
  1100, // rank 3  — 11%
  700,  // rank 4  — 7%
  500,  // rank 5  — 5%
  400,  // rank 6  — 4%
  350,  // rank 7  — 3.5%
  300,  // rank 8  — 3%
  250,  // rank 9  — 2.5%
  200,  // rank 10 — 2%
  40, 40, 40, 40, 40, 40, 40, 40, 40, 40, // ranks 11–20, 0.4% each
];

if (PAYOUT_CURVE_BPS.reduce((a, b) => a + b, 0) !== BPS_DENOM) {
  throw new Error("payout curve must sum to 10000 bps");
}

/// Distributes an arbitrary wei budget across PAYOUT_CURVE_BPS. Rounding
/// dust lands on rank 1 so the returned array always sums to `budget`.
export function distributeCurve(budget: bigint): bigint[] {
  if (budget <= 0n) return PAYOUT_CURVE_BPS.map(() => 0n);
  const payouts = PAYOUT_CURVE_BPS.map(
    (bps) => (budget * BigInt(bps)) / BigInt(BPS_DENOM),
  );
  const distributed = payouts.reduce((a, b) => a + b, 0n);
  payouts[0] += budget - distributed;
  return payouts;
}

/// Given the full weekly pool in wei, returns per-rank payouts matching
/// PAYOUT_CURVE_BPS. Rank is 1-indexed in the returned array's implicit order.
/// Equivalent to distributing the 75% player share across the curve.
export function computePayouts(poolWei: bigint): bigint[] {
  const playerShare = (poolWei * BigInt(PLAYER_SHARE_BPS)) / BigInt(BPS_DENOM);
  return distributeCurve(playerShare);
}
