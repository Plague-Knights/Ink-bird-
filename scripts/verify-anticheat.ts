// Verifies anti-cheat invariants without spinning up the server.
// Run: pnpm exec tsx scripts/verify-anticheat.ts
import { replay, type SimInput, MAX_FRAMES } from "../src/lib/simulate";

const MIN_FLAP_GAP_FRAMES = 3;
const WALL_CLOCK_SLACK_MS = 2000;
const ATTEMPT_TTL_MS = 30 * 60 * 1000;

type FakeAttempt = { createdAt: number; seed: number };

function checkSubmission(
  attempt: FakeAttempt,
  inputs: SimInput[],
  now: number,
): { ok: boolean; reason?: string; score?: number } {
  const age = now - attempt.createdAt;

  if (age > ATTEMPT_TTL_MS) return { ok: false, reason: "expired" };

  const sorted = [...inputs].sort((a, b) => a.f - b.f);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].f - sorted[i - 1].f < MIN_FLAP_GAP_FRAMES) {
      return { ok: false, reason: "cadence" };
    }
  }

  if (inputs.length > MAX_FRAMES) return { ok: false, reason: "too-many" };

  const result = replay(attempt.seed, inputs);
  const gameplayFrames = result.deadAtFrame ?? result.framesRun;
  const minWallClockMs = (gameplayFrames / 60) * 1000 - WALL_CLOCK_SLACK_MS;
  if (age < minWallClockMs) return { ok: false, reason: "too-fast" };

  return { ok: true, score: result.score };
}

let passed = 0;
let failed = 0;
function t(name: string, want: boolean, got: boolean, extra = "") {
  const ok = want === got;
  (ok ? (passed++, console.log(`  PASS  ${name} ${extra}`)) : (failed++, console.log(`  FAIL  ${name} want=${want} got=${got} ${extra}`)));
}

const seed = 0xdeadbeef;

// 1. Honest real-time play: bird dies at frame ~60 (no flaps), wall-clock 1s
{
  const now = Date.now();
  const attempt = { createdAt: now - 1500, seed };
  const result = checkSubmission(attempt, [], now);
  t("honest real-time play is accepted", true, result.ok, `reason=${result.reason}`);
}

// 2. Bot solver: 60s of gameplay submitted in 100ms
{
  const flaps: SimInput[] = [];
  for (let f = 10; f < 3600; f += 20) flaps.push({ f, t: "flap" });
  const now = Date.now();
  const attempt = { createdAt: now - 100, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("solver submitting 60s run in 100ms is rejected", false, result.ok, `reason=${result.reason}`);
}

// 3. Stale seed: created 1 hour ago
{
  const now = Date.now();
  const attempt = { createdAt: now - 61 * 60 * 1000, seed };
  const result = checkSubmission(attempt, [], now);
  t("attempt older than TTL is rejected", false, result.ok, `reason=${result.reason}`);
}

// 4. Superhuman cadence: flaps 1 frame apart
{
  const flaps: SimInput[] = [{ f: 10, t: "flap" }, { f: 11, t: "flap" }];
  const now = Date.now();
  const attempt = { createdAt: now - 10000, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("sub-3-frame flap gap is rejected", false, result.ok, `reason=${result.reason}`);
}

// 5. Human cadence: flaps 20 frames apart (slowish pace), over real wall-clock
{
  const flaps: SimInput[] = [];
  for (let f = 10; f < 600; f += 20) flaps.push({ f, t: "flap" });
  const now = Date.now();
  const attempt = { createdAt: now - 12000, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("human-paced play with matching wall-clock is accepted", true, result.ok, `reason=${result.reason} score=${result.score}`);
}

// 6. Bot trying just under MIN_FLAP_GAP_FRAMES boundary
{
  const flaps: SimInput[] = [{ f: 10, t: "flap" }, { f: 12, t: "flap" }];
  const now = Date.now();
  const attempt = { createdAt: now - 10000, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("2-frame gap (33ms) is rejected", false, result.ok, `reason=${result.reason}`);
}

// 7. Exactly 3-frame gap is allowed
{
  const flaps: SimInput[] = [{ f: 10, t: "flap" }, { f: 13, t: "flap" }];
  const now = Date.now();
  const attempt = { createdAt: now - 10000, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("exactly 3-frame gap (50ms) is accepted", true, result.ok, `reason=${result.reason}`);
}

// 8. Wall-clock slack: submitted 1.5s after a 1s run (network latency)
{
  const flaps: SimInput[] = [];
  for (let f = 10; f < 60; f += 20) flaps.push({ f, t: "flap" });
  const now = Date.now();
  const attempt = { createdAt: now - 1500, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("short run with normal network latency is accepted", true, result.ok, `reason=${result.reason}`);
}

// 9. Out-of-order inputs with valid gaps still work (order-insensitive)
{
  const flaps: SimInput[] = [{ f: 30, t: "flap" }, { f: 10, t: "flap" }, { f: 20, t: "flap" }];
  const now = Date.now();
  const attempt = { createdAt: now - 5000, seed };
  const result = checkSubmission(attempt, flaps, now);
  t("out-of-order valid flaps are accepted", true, result.ok, `reason=${result.reason}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
