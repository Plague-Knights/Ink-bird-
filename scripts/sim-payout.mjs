// Quick Monte Carlo for the proposed 92% RTP chest game curve.
// Rolls N plays at a fixed buy-in, tallies collected vs paid out.

const BUYIN = 0.01; // ETH per play
const RUNS = [100, 10000, 100000];

// Distribution proposed in Discord:
//   8%  → 0×
//   15% → 0.7×
//   30% → 0.9×
//   30% → 1.05×
//   14% → 1.2×
//   2.5% → 1.8×
//   0.5% → 5.0×
const CURVE = [
  { p: 0.080, mult: 0 },
  { p: 0.150, mult: 0.7 },
  { p: 0.300, mult: 0.9 },
  { p: 0.300, mult: 1.05 },
  { p: 0.140, mult: 1.2 },
  { p: 0.025, mult: 1.8 },
  { p: 0.005, mult: 5.0 },
];

// Deterministic seed so two runs side-by-side are comparable.
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rollMultiplier(rng) {
  const r = rng();
  let acc = 0;
  for (const row of CURVE) {
    acc += row.p;
    if (r < acc) return row.mult;
  }
  return CURVE[CURVE.length - 1].mult;
}

function simulate(n, label, seed) {
  const rng = mulberry32(seed);
  let collected = 0;
  let paid = 0;
  const hits = Object.fromEntries(CURVE.map(c => [c.mult, 0]));
  let busts = 0, wins = 0;

  for (let i = 0; i < n; i++) {
    const m = rollMultiplier(rng);
    collected += BUYIN;
    paid += BUYIN * m;
    hits[m] = (hits[m] || 0) + 1;
    if (m === 0) busts++;
    else if (m >= 1.0) wins++;
  }

  const net = collected - paid;
  const rtp = paid / collected;

  console.log(`\n=== ${label} (${n.toLocaleString()} plays @ ${BUYIN} ETH) ===`);
  console.log(`collected:   ${collected.toFixed(4)} ETH`);
  console.log(`paid out:    ${paid.toFixed(4)} ETH`);
  console.log(`net (house): ${net.toFixed(4)} ETH  (${(net / collected * 100).toFixed(2)}% edge)`);
  console.log(`RTP:         ${(rtp * 100).toFixed(2)}%  (target 92.8%)`);
  console.log(`busts:       ${busts} (${(busts / n * 100).toFixed(1)}%)`);
  console.log(`≥1× wins:    ${wins} (${(wins / n * 100).toFixed(1)}%)`);
  console.log(`distribution:`);
  for (const c of CURVE) {
    const actual = hits[c.mult] / n;
    console.log(`  ${c.mult.toFixed(2).padStart(5)}×: ${hits[c.mult].toString().padStart(6)}  ${(actual * 100).toFixed(2)}%  (target ${(c.p * 100).toFixed(1)}%)`);
  }
}

// Working capital: worst-case bankroll needed so the pool never runs dry.
// At any given moment, we need enough to cover the single largest
// payout: 5× buy-in. Over N plays, cumulative drawdown is ~RTP × N +
// variance. Let's also measure the largest running shortfall.
function simulateWorstDrawdown(n, label, seed) {
  const rng = mulberry32(seed);
  let balance = 0;
  let minBalance = 0;
  for (let i = 0; i < n; i++) {
    balance += BUYIN;                // buy-in comes in
    balance -= BUYIN * rollMultiplier(rng); // payout goes out
    if (balance < minBalance) minBalance = balance;
  }
  console.log(`\n--- worst running drawdown in ${label} (${n.toLocaleString()} plays) ---`);
  console.log(`final house balance: ${balance.toFixed(4)} ETH`);
  console.log(`worst running shortfall: ${Math.abs(minBalance).toFixed(4)} ETH  (= ${(Math.abs(minBalance) / BUYIN).toFixed(1)}× a single buy-in)`);
  console.log(`→ minimum seed float needed: ${Math.max(0, Math.abs(minBalance)).toFixed(4)} ETH`);
}

for (const n of RUNS) {
  simulate(n, `${n.toLocaleString()} plays`, n * 31);
  simulateWorstDrawdown(n, `${n.toLocaleString()} plays`, n * 31);
}
