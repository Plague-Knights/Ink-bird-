// Squid Cannon outcome dataset.
//
// Each entry is a sequence of events the squid plays out:
//   - blot: collectible ink blot with a bps multiplier (10000 = 1x bet)
//   - hazard: squid slams into a rock / anglerfish / net, run ends
//
// Payout = sum of blot values (bps) / 10000 * bet. Sequences always end
// with a hazard *except* rare "home run" rows that terminate on a blot
// (the squid breaks through the water and walks away with everything).
//
// Dataset is deterministic (mulberry32 seeded per-tier) and
// sum-normalized so the mean total multiplier over uniform index is
// exactly 9600 bps (= 0.96 × bet, 96% RTP).

export type CannonEvent =
  | { kind: "blot"; value: number } // value is in bps (100 = 0.01x)
  | { kind: "hazard" };

const DATASET_SIZE = 256;
const TARGET_MEAN_BPS = 9600;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// A "raw" sequence — blot values come out unscaled; we normalize after.
function generateRawSequence(rng: () => number): number[] {
  const roll = rng();
  // Outcome shape distribution:
  //  45% short: 0-1 blot then hazard (fast losses)
  //  30% medium: 2-4 blots then hazard
  //  18% long: 5-10 blots then hazard
  //   5% big: 10-18 blots then hazard (rare jackpot vibe)
  //   2% home run: 3-8 blots, no hazard (squid escapes)
  let nBlots: number;
  let tailValueBoost = 1;
  if (roll < 0.45) {
    nBlots = rng() < 0.5 ? 0 : 1;
  } else if (roll < 0.75) {
    nBlots = 2 + Math.floor(rng() * 3);
  } else if (roll < 0.93) {
    nBlots = 5 + Math.floor(rng() * 6);
    tailValueBoost = 1.2;
  } else if (roll < 0.98) {
    nBlots = 10 + Math.floor(rng() * 9);
    tailValueBoost = 1.6;
  } else {
    nBlots = 3 + Math.floor(rng() * 6);
    tailValueBoost = 2.5;
  }

  const values: number[] = [];
  for (let i = 0; i < nBlots; i++) {
    // Individual blot value: mostly small (0.1-0.5x), sometimes mid
    // (0.5-1.5x), rarely a bomb (2-6x). Final blot biased larger on
    // longer runs for satisfying crescendo.
    const v = rng();
    const isFinal = i === nBlots - 1;
    let base: number;
    if (v < 0.55) base = 100 + rng() * 400;
    else if (v < 0.88) base = 500 + rng() * 1000;
    else base = 2000 + rng() * 4000;
    if (isFinal && nBlots >= 5) base *= 1.4;
    values.push(base * tailValueBoost);
  }
  return values;
}

function normalizeDataset(raw: number[][]): number[][] {
  const sums = raw.map((r) => r.reduce((a, b) => a + b, 0));
  const totalSum = sums.reduce((a, b) => a + b, 0);
  const targetSum = DATASET_SIZE * TARGET_MEAN_BPS;
  const factor = targetSum / Math.max(1, totalSum);
  const scaled = raw.map((r) => r.map((v) => Math.round(v * factor)));
  // Fix rounding drift by adjusting the first blot of the first non-empty row
  let current = scaled.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0);
  let drift = targetSum - current;
  for (let i = 0; drift !== 0 && i < DATASET_SIZE * 2; i++) {
    const row = scaled[i % DATASET_SIZE];
    if (row.length === 0) continue;
    const step = drift > 0 ? 1 : -1;
    if (row[0] + step >= 0) {
      row[0] += step;
      drift -= step;
    }
  }
  return scaled;
}

function buildDataset(): CannonEvent[][] {
  const rng = mulberry32(0xb107a17c);
  const raw: number[][] = [];
  for (let i = 0; i < DATASET_SIZE; i++) raw.push(generateRawSequence(rng));
  const normalized = normalizeDataset(raw);

  // 2% of rows are "home runs" that end without a hazard. Recomputing
  // by total value puts the largest summed rows in that bucket so
  // the UI reads as "the bigger the run, the more likely it escapes".
  const sums = normalized.map((r, i) => ({ i, total: r.reduce((a, b) => a + b, 0) }));
  sums.sort((a, b) => b.total - a.total);
  const homeRunIndexes = new Set(sums.slice(0, Math.max(1, Math.round(DATASET_SIZE * 0.02))).map((s) => s.i));

  const dataset: CannonEvent[][] = [];
  for (let i = 0; i < DATASET_SIZE; i++) {
    const events: CannonEvent[] = normalized[i].map((v) => ({ kind: "blot" as const, value: v }));
    if (!homeRunIndexes.has(i)) events.push({ kind: "hazard" as const });
    dataset.push(events);
  }
  return Object.freeze(dataset.map((s) => Object.freeze(s))) as unknown as CannonEvent[][];
}

export const CANNON_DATASET: readonly (readonly CannonEvent[])[] = buildDataset();

export function totalMultiplierBps(events: readonly CannonEvent[]): number {
  let sum = 0;
  for (const e of events) if (e.kind === "blot") sum += e.value;
  return sum;
}

export function datasetHash(): number {
  // Cheap FNV-1a over the flattened event stream.
  let h = 0x811c9dc5;
  for (const seq of CANNON_DATASET) {
    h = Math.imul(h ^ seq.length, 0x01000193) >>> 0;
    for (const e of seq) {
      if (e.kind === "hazard") {
        h = Math.imul(h ^ 0xdeadbeef, 0x01000193) >>> 0;
      } else {
        h = Math.imul(h ^ e.value, 0x01000193) >>> 0;
      }
    }
  }
  return h >>> 0;
}

export function datasetMean(): number {
  let total = 0;
  for (const seq of CANNON_DATASET) total += totalMultiplierBps(seq);
  return total / CANNON_DATASET.length;
}

export const CANNON_DATASET_SIZE = DATASET_SIZE;
