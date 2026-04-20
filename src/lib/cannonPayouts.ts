// Squid Cannon outcome dataset.
//
// Each entry is a sequence of events the squid plays out IN ORDER:
//   - blot: collectible ink blot with a bps multiplier (10000 = 1x bet)
//   - hazard: squid hits a rock / spike / anglerfish, flight ends here
//
// Payout = sum of blot bps collected BEFORE the first hazard.
// If the first event is a hazard, payout is 0.
// If there is no hazard, payout is the sum of all blot values.
//
// This lets us model Moonsheep's "sometimes it just dies on a rock"
// moments. About 65% of sequences hit a hazard somewhere mid-flight
// and zero out whatever was collected; the other 35% are clean runs
// that keep everything.
//
// Dataset is deterministic (mulberry32 seeded) and scaled so the
// mean payout over uniform index is exactly TARGET_MEAN_BPS (96% RTP).

export type CannonEvent =
  | { kind: "blot"; value: number } // value is in bps (100 = 0.01x)
  | { kind: "hazard" };

const DATASET_SIZE = 256;
const TARGET_MEAN_BPS = 9600;
// Fraction of sequences that contain a hazard anywhere in the event
// list. Hazard placement is biased earlier so short deaths dominate
// for dramatic losses, matching Moonsheep pacing.
const HAZARD_SEQUENCE_FRACTION = 0.65;

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

function rollBlotValue(rng: () => number, isFinal: boolean, longRun: boolean): number {
  // Individual blot value in raw units. Normalization at the end
  // rescales. Mostly small, occasional mid, rarely a bomb. Final blot
  // on long clean runs gets a crescendo boost for satisfying big wins.
  const v = rng();
  let base: number;
  if (v < 0.55) base = 100 + rng() * 400;
  else if (v < 0.88) base = 500 + rng() * 1000;
  else base = 2000 + rng() * 4000;
  if (isFinal && longRun) base *= 1.5;
  return base;
}

type RawSequence = { blotsBeforeHazard: number[]; hazardAt: number | null; totalBlots: number };

function generateRawSequence(rng: () => number): RawSequence {
  const hasHazard = rng() < HAZARD_SEQUENCE_FRACTION;

  // Runway length — total number of blot positions along the arc.
  const shapeRoll = rng();
  let totalBlots: number;
  if (shapeRoll < 0.4) totalBlots = 1 + Math.floor(rng() * 3);        // short 1-3
  else if (shapeRoll < 0.78) totalBlots = 3 + Math.floor(rng() * 5);  // mid 3-7
  else if (shapeRoll < 0.95) totalBlots = 7 + Math.floor(rng() * 7);  // long 7-13
  else totalBlots = 13 + Math.floor(rng() * 9);                        // epic 13-21

  // Hazard position — biased to fire earlier so losses dominate
  // dramatically. Uniform^2 distribution over 0..totalBlots (0 = hazard
  // fires before any blot; totalBlots = hazard after all blots, clean).
  let hazardAt: number | null = null;
  if (hasHazard) {
    const u = rng();
    hazardAt = Math.floor(u * u * (totalBlots + 1));
    if (hazardAt > totalBlots) hazardAt = totalBlots;
  }

  const collectableCount = hazardAt === null ? totalBlots : hazardAt;
  const longRun = collectableCount >= 5 && hazardAt === null;

  const values: number[] = [];
  for (let i = 0; i < collectableCount; i++) {
    const isFinal = i === collectableCount - 1;
    values.push(rollBlotValue(rng, isFinal, longRun));
  }

  return { blotsBeforeHazard: values, hazardAt, totalBlots };
}

function normalizeDataset(raw: RawSequence[]): RawSequence[] {
  // Each sequence's payout is sum of its blots. Scale all values so
  // the mean over the whole dataset lands on TARGET_MEAN_BPS.
  const sums = raw.map((r) => r.blotsBeforeHazard.reduce((a, b) => a + b, 0));
  const totalSum = sums.reduce((a, b) => a + b, 0);
  const targetSum = DATASET_SIZE * TARGET_MEAN_BPS;
  const factor = targetSum / Math.max(1, totalSum);
  const scaled = raw.map((r) => ({
    ...r,
    blotsBeforeHazard: r.blotsBeforeHazard.map((v) => Math.round(v * factor)),
  }));
  // Fix rounding drift so the mean is exactly the target.
  let current = scaled.reduce((a, r) => a + r.blotsBeforeHazard.reduce((x, y) => x + y, 0), 0);
  let drift = targetSum - current;
  for (let i = 0; drift !== 0 && i < DATASET_SIZE * 4; i++) {
    const row = scaled[i % DATASET_SIZE];
    if (row.blotsBeforeHazard.length === 0) continue;
    const step = drift > 0 ? 1 : -1;
    if (row.blotsBeforeHazard[0] + step >= 0) {
      row.blotsBeforeHazard[0] += step;
      drift -= step;
    }
  }
  return scaled;
}

function buildDataset(): CannonEvent[][] {
  const rng = mulberry32(0xb107a17c);
  const raw: RawSequence[] = [];
  for (let i = 0; i < DATASET_SIZE; i++) raw.push(generateRawSequence(rng));
  const normalized = normalizeDataset(raw);

  const dataset: CannonEvent[][] = [];
  for (const seq of normalized) {
    const events: CannonEvent[] = [];
    const totalBlots = seq.totalBlots;
    const hazardAt = seq.hazardAt;

    // Build the full event stream: blots at positions 0..hazardAt-1 are
    // the ones the player collects, positions hazardAt..totalBlots-1
    // are "ghost" blots the player never reaches because the hazard
    // intervened. We still emit the ghost blots (with dummy value 0)
    // so rendering has a complete path to lay out visually.
    let collectedIdx = 0;
    const collectablePayouts = seq.blotsBeforeHazard;
    for (let i = 0; i < totalBlots; i++) {
      if (hazardAt !== null && i === hazardAt) {
        events.push({ kind: "hazard" });
        // Remaining positions are ghosts (zero-value blots, won't add
        // to payout since hazard already fired — but kept so the
        // visual trajectory still feels full).
        for (let j = i; j < totalBlots; j++) {
          events.push({ kind: "blot", value: 0 });
        }
        break;
      }
      events.push({ kind: "blot", value: collectablePayouts[collectedIdx++] });
    }
    // No hazard inserted mid-sequence: either hazard at end or no hazard.
    if (hazardAt === totalBlots) {
      events.push({ kind: "hazard" });
    }

    dataset.push(events);
  }
  return Object.freeze(dataset.map((s) => Object.freeze(s))) as unknown as CannonEvent[][];
}

export const CANNON_DATASET: readonly (readonly CannonEvent[])[] = buildDataset();

// Payout of a sequence: sum of blot values BEFORE the first hazard.
// Matches server-side settlement logic — don't credit anything past
// the first hazard event.
export function totalMultiplierBps(events: readonly CannonEvent[]): number {
  let sum = 0;
  for (const e of events) {
    if (e.kind === "hazard") return sum;
    sum += e.value;
  }
  return sum;
}

// Position of the hazard in the event list (or null if the sequence
// ends without hitting one). Clients use this to know where to stop
// the squid's physics — the flight ends at the hazard's trajectory t.
export function hazardIndex(events: readonly CannonEvent[]): number | null {
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind === "hazard") return i;
  }
  return null;
}

export function datasetHash(): number {
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
