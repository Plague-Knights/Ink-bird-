// Squid Dive payout datasets.
//
// Each tier is 256 integer distances. At settlement the server picks
// index = uint32(keccak256(seed || salt)) mod 256, then
// payout = distance / 100 * bet.
//
// Datasets are generated deterministically here and sum-normalized so
// the average distance over a uniform index is exactly 96 (96% RTP).
// The shape governs variance: "low" is tight around the mean, "high"
// has many zeros and a long tail.

const DATASET_SIZE = 256;
const TARGET_MEAN = 96; // * bet / 100 = payout, so mean payout = 0.96 * bet

export type Tier = "low" | "mid" | "high";

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

function buildRaw(tier: Tier): number[] {
  // Tier-specific seed keeps datasets reproducible across builds and
  // across dev/prod so verification works the same everywhere.
  const seedFor = { low: 1, mid: 2, high: 3 } as const;
  const rng = mulberry32(seedFor[tier]);
  const raw: number[] = [];
  for (let i = 0; i < DATASET_SIZE; i++) {
    raw.push(sample(tier, rng));
  }
  return raw;
}

function sample(tier: Tier, rng: () => number): number {
  const r = rng();
  if (tier === "low") {
    // Small loss band, tight win band. Mean before normalization ≈ 110.
    if (r < 0.2) return Math.floor(rng() * 40); //  0 – 40
    if (r < 0.75) return 60 + Math.floor(rng() * 80); // 60 – 140
    if (r < 0.95) return 140 + Math.floor(rng() * 80); // 140 – 220
    return 220 + Math.floor(rng() * 120); // 220 – 340
  }
  if (tier === "mid") {
    // Bigger loss rate, bigger tail.
    if (r < 0.4) return Math.floor(rng() * 60); //   0 – 60
    if (r < 0.75) return 60 + Math.floor(rng() * 140); //  60 – 200
    if (r < 0.92) return 200 + Math.floor(rng() * 200); // 200 – 400
    return 400 + Math.floor(rng() * 400); // 400 – 800
  }
  // high
  if (r < 0.6) return Math.floor(rng() * 40); //    0 – 40
  if (r < 0.85) return 40 + Math.floor(rng() * 160); //  40 – 200
  if (r < 0.97) return 200 + Math.floor(rng() * 400); //  200 – 600
  return 600 + Math.floor(rng() * 1400); // 600 – 2000
}

// Scale the raw dataset so its mean is exactly TARGET_MEAN.
// Scaling happens via rational multiplier + dust adjustment on the
// first entries so integer rounding doesn't drift the mean off.
function normalize(raw: number[]): number[] {
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const targetSum = DATASET_SIZE * TARGET_MEAN;
  const scaled = raw.map((v) => Math.round((v * targetSum) / rawSum));
  let drift = targetSum - scaled.reduce((a, b) => a + b, 0);
  let i = 0;
  while (drift !== 0 && i < DATASET_SIZE) {
    const step = drift > 0 ? 1 : -1;
    if (scaled[i] + step >= 0) {
      scaled[i] += step;
      drift -= step;
    }
    i++;
  }
  return scaled;
}

function freeze(arr: number[]): readonly number[] {
  return Object.freeze(arr) as readonly number[];
}

export const DIVE_DATASETS: Readonly<Record<Tier, readonly number[]>> = Object.freeze({
  low: freeze(normalize(buildRaw("low"))),
  mid: freeze(normalize(buildRaw("mid"))),
  high: freeze(normalize(buildRaw("high"))),
});

export function datasetHash(tier: Tier): number {
  // Cheap FNV-1a over the dataset values so clients/tests can confirm
  // they're looking at the same numbers the server used.
  let h = 0x811c9dc5;
  for (const v of DIVE_DATASETS[tier]) {
    h ^= v;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function meanOf(tier: Tier): number {
  const d = DIVE_DATASETS[tier];
  const sum = d.reduce((a, b) => a + b, 0);
  return sum / d.length;
}
