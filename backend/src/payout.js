/**
 * Payout curve for top-100. Returns bps (out of 10000) for each rank 1..100.
 * Matches the product spec:
 *   1st 25% · 2nd 15% · 3rd 10% · 4th-5th 6% each (12%) ·
 *   6th-10th 3% each (15%) · 11th-25th 0.6% each (9%) ·
 *   26th-100th 0.2% each (15%) -> sums to 100%.
 */
export function payoutBps() {
  const bps = new Array(101).fill(0); // index 1..100
  bps[1] = 2500;
  bps[2] = 1500;
  bps[3] = 1000;
  bps[4] = 600; bps[5] = 600;
  for (let r = 6; r <= 10; r++) bps[r] = 300;
  for (let r = 11; r <= 25; r++) bps[r] = 60;
  for (let r = 26; r <= 100; r++) bps[r] = 20;
  return bps;
}

export function distribute(pool, winners /* [{player, score}] sorted desc */) {
  const bps = payoutBps();
  const rewards = [];
  let assigned = 0n;
  const n = Math.min(winners.length, 100);
  for (let i = 0; i < n; i++) {
    const amount = (BigInt(pool) * BigInt(bps[i + 1])) / 10000n;
    if (amount > 0n) {
      rewards.push({ player: winners[i].player, amount });
      assigned += amount;
    }
  }
  // Any dust (from integer division) stays in pool and rolls over.
  return { rewards, assigned };
}
