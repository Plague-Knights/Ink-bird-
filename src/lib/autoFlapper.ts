// Deterministic auto-flapper for the squid game.
//
// Given a seed, produces the full input log for a run. The bot:
//   - watches the next pipe ahead of the squid
//   - aims to fly through the gap with a small seeded altitude offset
//     (so every run looks slightly different)
//   - has a configurable "miss" rate — sometimes refuses to flap when
//     it should, which makes runs end naturally on a pipe without
//     having to fake it
//   - has a per-decision flap cooldown so it doesn't spam-flap into
//     the ceiling
//
// The bot uses its own PRNG keyed off the seed so its decisions are
// independent of the game's pipe-spawn PRNG. Same seed → same input
// log → same death frame, every time.

import {
  initialState, step, type SimInput, type Pipe, type Droplet,
  PIPE_GAP, PIPE_WIDTH, MAX_FRAMES,
} from "./simulate";

type AutoConfig = {
  // Probability per decision-cycle that the bot fumbles and skips a
  // flap it would have otherwise issued. Higher = more deaths.
  missRate: number;
  // Min/max frames between flaps; bot picks within this range each
  // time it commits to a flap.
  cooldownMin: number;
  cooldownMax: number;
  // How far ahead of itself the bot looks (pixels). Larger = smoother
  // flight; too small = late reaction = more deaths.
  lookAheadPx: number;
  // How aggressively to aim above the gap center to compensate for
  // gravity (pixels). Tuned alongside FLAP / GRAVITY in simulate.ts.
  aimAboveCenter: number;
  // Random altitude target offset added per decision (pixels, ±).
  aimJitter: number;
  // Hard cap on frames to simulate (safety vs runaway).
  maxFrames: number;
};

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  // Tuned via stats run: at 0.025 missRate and ~5min cap, 88% of
  // runs hit the cap — boring. At 0.06 the distribution flattens
  // out into something with real variance, so each run feels
  // distinct (some die fast, some get a real run, occasional epic).
  missRate: 0.15,
  cooldownMin: 8,
  cooldownMax: 13,
  lookAheadPx: 140,
  // Aim BELOW gap center: each flap launches the squid up by ~70px,
  // so triggering at target = gap_center + 28 makes the resulting
  // oscillation (peak ~gap_center - 40, trough ~gap_center + 28)
  // sit roughly centered in the gap rather than clipping the top.
  aimAboveCenter: -28,
  aimJitter: 12,
  maxFrames: 60 * 60 * 2, // 2 minutes — long enough for a memorable run, not all day
};

export type AutoPlan = {
  inputs: SimInput[];
  framesRun: number;
  deadAtFrame: number | null;
  pipesPassed: number;
  dropletsCollected: number;
};

// Mulberry32 — same PRNG style as simulate.ts but with an offset key
// so AI rolls don't collide with sim rolls.
function mulberry32(seed: number) {
  let t = (seed ^ 0xa53ce5d3) >>> 0;
  return function next(): number {
    t = (t + 0x6D2B79F5) | 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function planAutoFlapper(seed: number, cfg: Partial<AutoConfig> = {}): AutoPlan {
  const c = { ...DEFAULT_AUTO_CONFIG, ...cfg };
  const inputs: SimInput[] = [];
  const state = initialState(seed);
  const rand = mulberry32(seed);

  let cooldown = 0;
  let pipesPassed = 0;
  let dropletsCollected = 0;
  const seenPassed = new Set<Pipe>();
  const seenCollected = new Set<Droplet>();
  const budget = Math.min(c.maxFrames, MAX_FRAMES);

  while (!state.dead && state.frame < budget) {
    cooldown -= 1;

    if (cooldown <= 0) {
      // Find the next pipe whose right edge is still ahead of us
      // (or directly under us — the gap matters until we clear it).
      const x = state.bird.x;
      const nextPipe = state.pipes.find(p => p.x + PIPE_WIDTH > x - 12);

      if (nextPipe) {
        const gapCenterY = nextPipe.top + PIPE_GAP / 2;
        const jitter = (rand() - 0.5) * 2 * c.aimJitter;
        const targetY = gapCenterY - c.aimAboveCenter + jitter;
        const distToPipe = nextPipe.x - x;
        // Anticipation: only commit a flap if the pipe is within the
        // look-ahead window, OR we're falling fast enough that not
        // flapping now will overshoot.
        const shouldConsider =
          distToPipe <= c.lookAheadPx ||
          (state.bird.y > targetY && state.bird.vy > 1.5);

        if (shouldConsider && state.bird.y > targetY && state.bird.vy >= 0) {
          if (rand() > c.missRate) {
            inputs.push({ f: state.frame, t: "flap" });
            cooldown = c.cooldownMin + Math.floor(rand() * (c.cooldownMax - c.cooldownMin + 1));
          } else {
            // Fumble — short cooldown so we'll try again next decision.
            cooldown = 4;
          }
        }
      } else {
        // No pipe in sight (warming up). Hover near vertical center.
        if (state.bird.y > 280 && state.bird.vy >= 0) {
          inputs.push({ f: state.frame, t: "flap" });
          cooldown = c.cooldownMin;
        }
      }
    }

    step(state, inputs);

    // Count passes/collections as they happen — pipes and droplets
    // get garbage-collected off-screen, so a post-loop scan misses
    // anything that left the array.
    for (const p of state.pipes) {
      if (p.passed && !seenPassed.has(p)) {
        seenPassed.add(p);
        pipesPassed++;
      }
    }
    for (const d of state.droplets) {
      if (d.collected && !seenCollected.has(d)) {
        seenCollected.add(d);
        dropletsCollected++;
      }
    }
  }

  return {
    inputs,
    framesRun: state.frame,
    deadAtFrame: state.deadAtFrame,
    pipesPassed,
    dropletsCollected,
  };
}
