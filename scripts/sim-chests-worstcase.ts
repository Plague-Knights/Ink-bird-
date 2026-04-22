// Variant of sim-chests-10k that runs 1000 independent Monte Carlos of
// 10k rounds each, to characterize the worst-case drawdown the pool
// must cover. Gives us a 99th-percentile pool-seed requirement.

const BANDS = [
  { weight: 0.08,  mult_th: 0    },
  { weight: 0.15,  mult_th: 700  },
  { weight: 0.30,  mult_th: 900  },
  { weight: 0.30,  mult_th: 1050 },
  { weight: 0.14,  mult_th: 1200 },
  { weight: 0.025, mult_th: 1800 },
  { weight: 0.005, mult_th: 5000 },
];

const CUM = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const b of BANDS) { acc += b.weight; out.push(acc); }
  return out;
})();

function rollIdx(rand: () => number) {
  const r = rand();
  for (let i = 0; i < CUM.length; i++) if (r < CUM[i]!) return i;
  return CUM.length - 1;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const TRIALS = 1000;
const N_PER_TRIAL = 10_000;
const BET_MIN = 1e-4;
const BET_MAX = 1e-2;
const BET_SPAN = BET_MAX - BET_MIN;

const drawdowns: number[] = [];
const finalHouse: number[] = [];
const rtpValues: number[] = [];

// A 2000-run "session" drawdown, for smaller-pool scenarios.
const sessionDrawdowns: number[] = [];

// Float math throughout — order-of-magnitude analysis, BigInt isn't
// needed at aggregate scale.
for (let t = 0; t < TRIALS; t++) {
  const rand = mulberry32(t * 0x9E3779B1);
  let house = 0;
  let peak = 0;
  let wagered = 0;
  let paidOut = 0;
  let maxDD = 0;
  let sessionPeak = 0;
  let maxSessionDD = 0;

  for (let i = 0; i < N_PER_TRIAL; i++) {
    const bet = BET_MIN + rand() * BET_SPAN;
    const mult_th = BANDS[rollIdx(rand)]!.mult_th;
    const payout = (bet * mult_th) / 1000;
    house += bet - payout;
    wagered += bet;
    paidOut += payout;
    if (house > peak) peak = house;
    const dd = peak - house;
    if (dd > maxDD) maxDD = dd;

    // Rolling 2000-run window reset.
    if (i % 2000 === 0) {
      sessionPeak = house;
    }
    if (house > sessionPeak) sessionPeak = house;
    const sessDD = sessionPeak - house;
    if (sessDD > maxSessionDD) maxSessionDD = sessDD;
  }
  drawdowns.push(maxDD);
  sessionDrawdowns.push(maxSessionDD);
  finalHouse.push(house);
  rtpValues.push(paidOut / wagered);
}

function pct(a: number[], p: number): number {
  const sorted = [...a].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}
function mean(a: number[]): number { return a.reduce((x, y) => x + y, 0) / a.length; }
function min(a: number[]): number { return a.reduce((x, y) => Math.min(x, y), Infinity); }
function max(a: number[]): number { return a.reduce((x, y) => Math.max(x, y), -Infinity); }

console.log("─".repeat(70));
console.log(`CHESTS WORST-CASE ANALYSIS  ·  ${TRIALS} trials × ${N_PER_TRIAL.toLocaleString()} rounds`);
console.log(`Bet uniform in [${BET_MIN}, ${BET_MAX}] ETH`);
console.log("─".repeat(70));

console.log();
console.log("Final house P/L across trials:");
console.log(`  mean     ${mean(finalHouse).toFixed(6)} ETH`);
console.log(`  min      ${min(finalHouse).toFixed(6)} ETH   (worst trial)`);
console.log(`  p1       ${pct(finalHouse, 0.01).toFixed(6)} ETH`);
console.log(`  p50      ${pct(finalHouse, 0.50).toFixed(6)} ETH`);
console.log(`  p99      ${pct(finalHouse, 0.99).toFixed(6)} ETH`);
console.log(`  max      ${max(finalHouse).toFixed(6)} ETH   (luckiest trial)`);

console.log();
console.log("Worst drawdown within a trial (peak → trough):");
console.log(`  mean     ${mean(drawdowns).toFixed(6)} ETH`);
console.log(`  p50      ${pct(drawdowns, 0.50).toFixed(6)} ETH`);
console.log(`  p95      ${pct(drawdowns, 0.95).toFixed(6)} ETH`);
console.log(`  p99      ${pct(drawdowns, 0.99).toFixed(6)} ETH  ← size pool to at least this`);
console.log(`  max      ${max(drawdowns).toFixed(6)} ETH`);

console.log();
console.log("Worst 2000-round rolling-window drawdown (short-session stress):");
console.log(`  p95      ${pct(sessionDrawdowns, 0.95).toFixed(6)} ETH`);
console.log(`  p99      ${pct(sessionDrawdowns, 0.99).toFixed(6)} ETH`);
console.log(`  max      ${max(sessionDrawdowns).toFixed(6)} ETH`);

console.log();
console.log("Realized RTP per trial:");
console.log(`  mean     ${(mean(rtpValues) * 100).toFixed(3)}%  (target 92.800%)`);
console.log(`  min      ${(min(rtpValues) * 100).toFixed(3)}%`);
console.log(`  max      ${(max(rtpValues) * 100).toFixed(3)}%`);

console.log();
const avgBet = (BET_MIN + BET_MAX) / 2;
const expectedWagered = avgBet * N_PER_TRIAL;
const expectedEdge = expectedWagered * (1 - 0.928);
console.log(`Expected wagered per trial:     ${expectedWagered.toFixed(6)} ETH`);
console.log(`Expected house edge per trial:  ${expectedEdge.toFixed(6)} ETH  (7.2% of wagered)`);
console.log("─".repeat(70));
