// High-volume Monte Carlo for the InkSquidGame contract. Same 7-band
// 92.8% RTP curve as the deployed contract — this script stands in for
// what `_rollMultiplier` does on-chain. 500k rounds with uniformly
// random bets in [0.0001, 0.01] ETH gives tight enough statistics that
// the jackpot band (0.5% weight → ~2500 hits) stabilizes and the RTP
// converges to within ~0.1% of target.
//
// Output tells you:
//   - The realized distribution vs target (sanity check the curve).
//   - Total wagered / paid / house P/L over the whole run.
//   - Peak house balance + worst drawdown (how much float the contract
//     needs to seed so it never under-pays during the worst variance).
//   - Running house P/L at 10k / 50k / 100k / 250k / 500k marks so you
//     can see how fast variance smooths into expected edge.
//   - Distribution of per-1000-round house P/L so you can see the
//     swing a single unlucky hour could cause.
//   - Ruin risk: fraction of 1000-round windows where the house would
//     have finished negative.
//
// Usage: pnpm exec tsx scripts/sim-game-500k.ts [seed]

const BANDS = [
  { label: "BUST",       weight: 0.08,  mult_th: 0    },
  { label: "0.7x",       weight: 0.15,  mult_th: 700  },
  { label: "0.9x",       weight: 0.30,  mult_th: 900  },
  { label: "1.05x",      weight: 0.30,  mult_th: 1050 },
  { label: "1.2x",       weight: 0.14,  mult_th: 1200 },
  { label: "1.8x",       weight: 0.025, mult_th: 1800 },
  { label: "5x JACKPOT", weight: 0.005, mult_th: 5000 },
];

const weightSum = BANDS.reduce((a, b) => a + b.weight, 0);
if (Math.abs(weightSum - 1) > 1e-9) {
  throw new Error(`Band weights sum to ${weightSum}, expected 1`);
}

const CUM = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const b of BANDS) { acc += b.weight; out.push(acc); }
  return out;
})();

function rollBand(rand: () => number) {
  const r = rand();
  for (let i = 0; i < CUM.length; i++) {
    if (r < CUM[i]!) return BANDS[i]!;
  }
  return BANDS[BANDS.length - 1]!;
}

// Mulberry32 — reproducible given a seed.
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = parseInt(process.argv[2] ?? String(Date.now() & 0xffffffff), 10);
const rand = mulberry32(SEED);

const N = 500_000;
const BET_MIN_WEI = 100_000_000_000_000n;       // 0.0001 ETH
const BET_MAX_WEI = 10_000_000_000_000_000n;    // 0.01 ETH
const BET_SPAN_WEI = BET_MAX_WEI - BET_MIN_WEI;

let totalWageredWei = 0n;
let totalPayoutWei = 0n;
let houseRunningWei = 0n;
let worstDrawdown = 0n;
let peakHouseWei = 0n;
let troughHouseWei = 0n;

const tally = new Map<string, number>();
for (const b of BANDS) tally.set(b.label, 0);

let longestLossStreak = 0;
let currentLossStreak = 0;

// Per-1000-round house P/L — each element is net house profit for
// that window of 1000 rounds. Used to compute the distribution of
// short-horizon outcomes (variance per hour-ish of play).
const windowPnl: bigint[] = [];
let currentWindowStart = 0n;
let currentWindowEnd: bigint;

// Snapshot markers for running P/L.
const snapshots: Array<{ round: number; house: bigint }> = [];
const snapshotRounds = new Set([10_000, 50_000, 100_000, 250_000, 500_000]);

// Biggest single-round payout seen.
let biggestPayoutWei = 0n;

for (let i = 0; i < N; i++) {
  const fracBet = rand();
  const betWei = BET_MIN_WEI + BigInt(Math.floor(fracBet * Number(BET_SPAN_WEI)));
  const band = rollBand(rand);
  const payoutWei = (betWei * BigInt(band.mult_th)) / 1000n;
  const netWei = betWei - payoutWei;

  totalWageredWei += betWei;
  totalPayoutWei += payoutWei;
  houseRunningWei += netWei;

  if (payoutWei > biggestPayoutWei) biggestPayoutWei = payoutWei;
  if (houseRunningWei > peakHouseWei) peakHouseWei = houseRunningWei;
  if (houseRunningWei < troughHouseWei) troughHouseWei = houseRunningWei;
  const drawdown = peakHouseWei - houseRunningWei;
  if (drawdown > worstDrawdown) worstDrawdown = drawdown;

  tally.set(band.label, (tally.get(band.label) ?? 0) + 1);

  if (netWei < 0n) {
    currentLossStreak++;
    if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
  } else {
    currentLossStreak = 0;
  }

  // Close the 1000-round window.
  if ((i + 1) % 1000 === 0) {
    currentWindowEnd = houseRunningWei;
    windowPnl.push(currentWindowEnd - currentWindowStart);
    currentWindowStart = currentWindowEnd;
  }

  if (snapshotRounds.has(i + 1)) {
    snapshots.push({ round: i + 1, house: houseRunningWei });
  }
}

function fmt(wei: bigint, decimals = 6): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 1_000_000_000_000_000_000n;
  const frac = abs % 1_000_000_000_000_000_000n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  return `${neg ? "-" : ""}${whole.toString()}.${fracStr}`;
}

const actualRTP = Number(totalPayoutWei * 10_000_000_000n / totalWageredWei) / 1e10;
const houseEdge = 1 - actualRTP;

// Sort the 1000-round P/L series so we can pull percentiles.
windowPnl.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const percentile = (p: number) => windowPnl[Math.floor(windowPnl.length * p)]!;
const negativeWindows = windowPnl.filter(x => x < 0n).length;

console.log("─".repeat(72));
console.log(`INKSQUIDGAME 500K MONTE CARLO  (seed ${SEED})`);
console.log("─".repeat(72));
console.log(`Rounds:                 ${N.toLocaleString()}`);
console.log(`Bet range:              0.0001 ETH → 0.01 ETH (uniform)`);
console.log(`Expected total wager:   ${fmt((BET_MIN_WEI + BET_MAX_WEI) / 2n * BigInt(N))} ETH (mean × N)`);
console.log();
console.log("Outcome distribution (expected vs actual):");
for (const b of BANDS) {
  const count = tally.get(b.label) ?? 0;
  const actual = count / N;
  const dev = (actual - b.weight) * 100;
  console.log(
    `  ${b.label.padEnd(14)} target ${(b.weight * 100).toFixed(2).padStart(6)}%  actual ${(actual * 100).toFixed(3).padStart(7)}%  Δ${(dev >= 0 ? "+" : "") + dev.toFixed(3).padStart(6)}%   (n=${count.toLocaleString()})`
  );
}
console.log();
console.log(`Total wagered:          ${fmt(totalWageredWei)} ETH`);
console.log(`Total paid out:         ${fmt(totalPayoutWei)} ETH`);
console.log(`Net to house:           ${fmt(houseRunningWei)} ETH`);
console.log(`Biggest single payout:  ${fmt(biggestPayoutWei)} ETH  (5× of a max-bet jackpot = 0.05 ETH ceiling)`);
console.log();
console.log(`Target RTP:             92.800%`);
console.log(`Actual RTP:             ${(actualRTP * 100).toFixed(3)}%`);
console.log(`Target house edge:      7.200%`);
console.log(`Actual house edge:      ${(houseEdge * 100).toFixed(3)}%`);
console.log();
console.log("Running house P/L snapshots (shows how fast variance smooths out):");
for (const s of snapshots) {
  console.log(`  after ${s.round.toString().padStart(7).padEnd(7)} rounds:  ${fmt(s.house)} ETH`);
}
console.log();
console.log("Pool sizing — how deep the float must be to absorb variance:");
console.log(`  Peak house balance:   ${fmt(peakHouseWei)} ETH`);
console.log(`  Trough house balance: ${fmt(troughHouseWei)} ETH`);
console.log(`  Worst drawdown:       ${fmt(worstDrawdown)} ETH  (max peak-to-trough swing)`);
console.log(`  Longest losing streak ${longestLossStreak} rounds`);
console.log();
console.log(`Per-1000-round house P/L distribution (${windowPnl.length.toLocaleString()} windows):`);
console.log(`  mean:              ${fmt(windowPnl.reduce((a, b) => a + b, 0n) / BigInt(windowPnl.length))} ETH`);
console.log(`  median  (p50):     ${fmt(percentile(0.5))} ETH`);
console.log(`  worst   (min):     ${fmt(windowPnl[0]!)} ETH`);
console.log(`  p01  (1st pct):    ${fmt(percentile(0.01))} ETH`);
console.log(`  p05  (5th pct):    ${fmt(percentile(0.05))} ETH`);
console.log(`  p95 (95th pct):    ${fmt(percentile(0.95))} ETH`);
console.log(`  p99 (99th pct):    ${fmt(percentile(0.99))} ETH`);
console.log(`  best    (max):     ${fmt(windowPnl[windowPnl.length - 1]!)} ETH`);
console.log();
console.log(`  windows where house lost money: ${negativeWindows} / ${windowPnl.length}  (${(negativeWindows / windowPnl.length * 100).toFixed(2)}%)`);
console.log("─".repeat(72));
console.log(
  "Interpretation:\n" +
  "  - Actual RTP should be within ~0.1% of 92.8% at this sample size.\n" +
  "  - Worst drawdown tells you the MINIMUM float the contract must hold\n" +
  "    on top of the 5×maxBet jackpot reserve. Double it for safety margin.\n" +
  "  - Percentile P/L per 1000 rounds shows the hour-by-hour swing a player\n" +
  "    or operator might experience; the tails are where people complain.\n" +
  "  - `windows where house lost money` tells you short-term variance —\n" +
  "    with a 7.2% edge, some hours still net negative; that's expected."
);
