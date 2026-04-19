// Pure, deterministic game simulation. Runs identically on client (for UI)
// and server (for replay validation). Only gameplay-affecting randomness
// (pipe positions, droplet offsets) uses the seeded PRNG — cosmetic bits
// (particles, bubbles) are NOT simulated here; the rendering layer can use
// Math.random() for those since they don't affect scoring.
//
// Tick model: fixed 60 Hz. Client accumulator calls step() N times per
// frame; server replays N = finalFrame times in a single tight loop.

export const W = 480;
export const H = 640;
export const GRAVITY = 0.28;
export const FLAP = -6.2;
export const TERMINAL_VY = 7.5;
export const PIPE_GAP = 175;
export const PIPE_WIDTH = 64;
export const PIPE_SPEED = 1.6;
export const PIPE_SPACING = 240;
export const GROUND_H = 72;

export type Pipe = { x: number; top: number; passed: boolean };
export type Droplet = { x: number; y: number; r: number; collected: boolean };
export type Bird = { x: number; y: number; vy: number; r: number };
export type FlapInput = { f: number; t: "flap" };
export type SimInput = FlapInput;

export type SimState = {
  seed: number;
  rngState: number;
  frame: number;
  bird: Bird;
  pipes: Pipe[];
  droplets: Droplet[];
  score: number;
  dead: boolean;
  deadAtFrame: number | null;
};

// Mulberry32: single-uint32 state, good distribution, trivial to port.
function nextRng(state: number): { value: number; state: number } {
  let t = (state + 0x6D2B79F5) | 0;
  const nextState = t | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: nextState };
}

function rngRange(state: number, a: number, b: number): { value: number; state: number } {
  const r = nextRng(state);
  return { value: a + r.value * (b - a), state: r.state };
}

export function initialState(seed: number): SimState {
  const state: SimState = {
    seed,
    rngState: seed | 0,
    frame: 0,
    bird: { x: W * 0.28, y: H * 0.45, vy: FLAP, r: 16 },
    pipes: [],
    droplets: [],
    score: 0,
    dead: false,
    deadAtFrame: null,
  };
  // Three initial pipes at the same offsets the original game used.
  spawnPipe(state, W + 60);
  spawnPipe(state, W + 60 + PIPE_SPACING);
  spawnPipe(state, W + 60 + PIPE_SPACING * 2);
  return state;
}

function spawnPipe(state: SimState, x: number) {
  const margin = 60;
  const minTop = margin;
  const maxTop = H - GROUND_H - PIPE_GAP - margin;
  const r1 = nextRng(state.rngState);
  state.rngState = r1.state;
  const top = minTop + r1.value * (maxTop - minTop);
  const r2 = rngRange(state.rngState, -15, 15);
  state.rngState = r2.state;
  state.pipes.push({ x, top, passed: false });
  state.droplets.push({
    x: x + PIPE_WIDTH / 2,
    y: top + PIPE_GAP / 2 + r2.value,
    r: 10,
    collected: false,
  });
}

/// Advance one 60 Hz tick. `inputs` is the full input log; `step` will
/// apply any whose `f === state.frame`. Returns the same `state` reference
/// mutated in place, for efficiency.
export function step(state: SimState, inputs: readonly SimInput[]): SimState {
  if (state.dead) {
    // After death, still advance physics for a couple frames so the
    // client-side render doesn't freeze. Score is locked.
    state.bird.vy = Math.min(TERMINAL_VY, state.bird.vy + GRAVITY);
    state.bird.y += state.bird.vy;
    if (state.bird.y + state.bird.r >= H - GROUND_H) {
      state.bird.y = H - GROUND_H - state.bird.r;
      state.bird.vy = 0;
    }
    state.frame++;
    return state;
  }

  // Apply inputs for this exact frame.
  for (const input of inputs) {
    if (input.f === state.frame && input.t === "flap") {
      state.bird.vy = FLAP;
    }
  }

  // Physics.
  state.bird.vy = Math.min(TERMINAL_VY, state.bird.vy + GRAVITY);
  state.bird.y += state.bird.vy;

  for (const p of state.pipes) p.x -= PIPE_SPEED;
  for (const d of state.droplets) d.x -= PIPE_SPEED;

  // Garbage-collect off-screen pipes/droplets.
  while (state.pipes.length && state.pipes[0].x + PIPE_WIDTH < -20) state.pipes.shift();
  while (state.droplets.length && state.droplets[0].x < -20) state.droplets.shift();

  // Spawn next pipe to keep the chain going.
  const last = state.pipes[state.pipes.length - 1];
  if (last && last.x < W - PIPE_SPACING) {
    spawnPipe(state, last.x + PIPE_SPACING);
  }

  // Pipe-pass tracking (stats only).
  for (const p of state.pipes) {
    if (!p.passed && p.x + PIPE_WIDTH < state.bird.x - state.bird.r) {
      p.passed = true;
    }
  }

  // Droplet collection == scoring.
  for (const d of state.droplets) {
    if (d.collected) continue;
    const dx = d.x - state.bird.x;
    const dy = d.y - state.bird.y;
    if (dx * dx + dy * dy < (d.r + state.bird.r) * (d.r + state.bird.r)) {
      d.collected = true;
      state.score += 1;
    }
  }

  // Death checks.
  if (state.bird.y + state.bird.r >= H - GROUND_H) {
    state.bird.y = H - GROUND_H - state.bird.r;
    state.dead = true;
    state.deadAtFrame = state.frame;
  } else if (state.bird.y - state.bird.r <= 0) {
    state.bird.y = state.bird.r;
    state.bird.vy = 0;
  }

  if (!state.dead) {
    for (const p of state.pipes) {
      if (
        state.bird.x + state.bird.r > p.x &&
        state.bird.x - state.bird.r < p.x + PIPE_WIDTH
      ) {
        if (
          state.bird.y - state.bird.r < p.top ||
          state.bird.y + state.bird.r > p.top + PIPE_GAP
        ) {
          state.dead = true;
          state.deadAtFrame = state.frame;
          break;
        }
      }
    }
  }

  state.frame++;
  return state;
}

/// Replay the full input log from an initial state. Server-side validator.
/// Caps at MAX_FRAMES to bound CPU. Returns final score + deadAtFrame.
export const MAX_FRAMES = 60 * 60 * 10; // 10 minutes of gameplay

export function replay(seed: number, inputs: readonly SimInput[]): {
  score: number;
  deadAtFrame: number | null;
  framesRun: number;
} {
  const sorted = [...inputs].sort((a, b) => a.f - b.f);
  // Reject malformed input: non-integer frames or out of bounds.
  for (const i of sorted) {
    if (!Number.isInteger(i.f) || i.f < 0 || i.f >= MAX_FRAMES) {
      return { score: 0, deadAtFrame: 0, framesRun: 0 };
    }
  }

  const state = initialState(seed);
  const lastInputFrame = sorted.length ? sorted[sorted.length - 1].f : 0;
  // Run until the bird dies or we exceed the last input + a short buffer
  // (after last flap, bird falls; simulate until death or buffer).
  const budget = Math.min(MAX_FRAMES, lastInputFrame + 60 * 30); // +30s buffer
  while (!state.dead && state.frame < budget) {
    step(state, sorted);
  }
  return { score: state.score, deadAtFrame: state.deadAtFrame, framesRun: state.frame };
}
