// Monte Carlo for the chests RTP curve. Mirrors the documented 7-band
// distribution from ChestsGame.tsx so this stands in for what the
// contract rolls on-chain. Runs 10k rounds with uniformly random bets
// in [0.0001, 0.01] ETH and reports house P/L + worst drawdown.
//
// Payout model: payout = bet * (multiplierThousandths / 1000).
// The pool seeds payouts — wagers come in, payouts go out, net P/L
// accrues to the house.
//
// Usage: pnpm exec tsx scripts/sim-chests-10k.ts [seed]

const BANDS = [
  { label: "BUST",       weight: 0.08,  mult_th: 0    },
  { label: "0.7x",       weight: 0.15,  mult_th: 700  },
  { label: "0.9x",       weight: 0.30,  mult_th: 900  },
  { label: "1.05x",      weight: 0.30,  mult_th: 1050 },
  { label: "1.2x",       weight: 0.14,  mult_th: 1200 },
  { label: "1.8x",       weight: 0.025, mult_th: 1800 },
  { label: "5x JACKPOT", weight: 0.005, mult_th: 5000 },
];

// Sanity — weights should sum to 1.
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

// Mulberry32 so the sim is reproducible given a seed.
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

const N = 10_000;
const BET_MIN_WEI = 100_000_000_000_000n;       // 0.0001 ETH
const BET_MAX_WEI = 10_000_000_000_000_000n;    // 0.01 ETH
const BET_SPAN_WEI = BET_MAX_WEI - BET_MIN_WEI;

let totalWageredWei = 0n;
let totalPayoutWei = 0n;
let houseRunningWei = 0n; // net to house = wager - payout, running sum
let worstDrawdown = 0n;   // most negative value houseRunningWei reaches
let peakHouseWei = 0n;

// Distribution tally — how many of each outcome landed.
const tally = new Map<string, number>();
for (const b of BANDS) tally.set(b.label, 0);

// Per-bet streak tracking — longest losing streak from the house's POV
// (i.e., longest streak of payouts > bets hitting the pool).
let longestLossStreak = 0;
let currentLossStreak = 0;

for (let i = 0; i < N; i++) {
  // Bet uniform in [0.0001, 0.01] ETH. Float math is fine since the
  // P/L aggregation stays in BigInt to avoid accumulation drift.
  const fracBet = rand();
  const betWei = BET_MIN_WEI + BigInt(Math.floor(fracBet * Number(BET_SPAN_WEI)));
  const band = rollBand(rand);
  const payoutWei = (betWei * BigInt(band.mult_th)) / 1000n;
  const netWei = betWei - payoutWei;

  totalWageredWei += betWei;
  totalPayoutWei += payoutWei;
  houseRunningWei += netWei;
  if (houseRunningWei > peakHouseWei) peakHouseWei = houseRunningWei;
  const drawdown = peakHouseWei - houseRunningWei;
  if (drawdown > worstDrawdown) worstDrawdown = drawdown;

  tally.set(band.label, (tally.get(band.label) ?? 0) + 1);

  if (netWei < 0n) {
    currentLossStreak++;
    if (currentLossStreak > longestLossStreak) longestLossStreak = currentLossStreak;
  } else {
    currentLossStreak = 0;
  }
}

function fmt(wei: bigint): string {
  // 18 decimals. Format to 6 decimal ETH.
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 1_000_000_000_000_000_000n;
  const frac = abs % 1_000_000_000_000_000_000n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  return `${neg ? "-" : ""}${whole.toString()}.${fracStr}`;
}

const actualRTP = Number(totalPayoutWei * 10_000_000_000n / totalWageredWei) / 1e10;
const houseEdge = 1 - actualRTP;

console.log("─".repeat(64));
console.log(`CHESTS 10K MONTE CARLO  (seed ${SEED})`);
console.log("─".repeat(64));
console.log(`Rounds:                 ${N.toLocaleString()}`);
console.log(`Bet range:              0.0001 ETH → 0.01 ETH (uniform)`);
console.log();
console.log("Outcome distribution (expected vs. actual):");
for (const b of BANDS) {
  const actual = (tally.get(b.label) ?? 0) / N;
  const dev = (actual - b.weight) * 100;
  console.log(
    `  ${b.label.padEnd(14)} target ${(b.weight * 100).toFixed(2).padStart(6)}%  actual ${(actual * 100).toFixed(2).padStart(6)}%  Δ${(dev >= 0 ? "+" : "") + dev.toFixed(2)}%`
  );
}
console.log();
console.log(`Total wagered:          ${fmt(totalWageredWei)} ETH`);
console.log(`Total paid out:         ${fmt(totalPayoutWei)} ETH`);
console.log(`Net to house:           ${fmt(houseRunningWei)} ETH`);
console.log(`Peak house balance:     ${fmt(peakHouseWei)} ETH`);
console.log(`Worst drawdown:         ${fmt(worstDrawdown)} ETH`);
console.log();
console.log(`Target RTP:             92.80%`);
console.log(`Actual RTP:             ${(actualRTP * 100).toFixed(3)}%`);
console.log(`Target house edge:      7.20%`);
console.log(`Actual house edge:      ${(houseEdge * 100).toFixed(3)}%`);
console.log();
console.log(`Longest losing streak:  ${longestLossStreak} rounds`);
console.log("─".repeat(64));
console.log(
  "Pool seeding note: the worst drawdown is how deep the pool must be\n" +
  "to cover the biggest negative swing before house P/L recovers."
);
