import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { replay, type SimInput, MAX_FRAMES } from "@/lib/simulate";

type Body = {
  attemptId?: string;
  inputs?: unknown;
  claimedScore?: unknown;
};

// Seeds older than this are stale — prevents attackers from harvesting
// seeds and submitting solved runs hours/days later.
const ATTEMPT_TTL_MS = 30 * 60 * 1000;

// Minimum frame gap between consecutive flaps. 3 frames ≈ 50ms at 60Hz;
// humans tap at most ~10/sec (~6 frames). Anything tighter is a bot.
const MIN_FLAP_GAP_FRAMES = 3;

// Real-world network + scheduler slack allowed on top of pure gameplay time.
const WALL_CLOCK_SLACK_MS = 2000;

async function invalidate(id: string, inputs: SimInput[]) {
  await prisma.attempt.update({
    where: { id },
    data: {
      inputs: inputs as unknown as object,
      score: 0,
      valid: false,
      submittedAt: new Date(),
    },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof body.attemptId !== "string") {
    return NextResponse.json({ error: "Missing attemptId" }, { status: 400 });
  }
  if (!Array.isArray(body.inputs)) {
    return NextResponse.json({ error: "Missing inputs" }, { status: 400 });
  }

  // Validate shape of input log before running the sim.
  const inputs: SimInput[] = [];
  for (const raw of body.inputs as unknown[]) {
    if (
      !raw || typeof raw !== "object" ||
      typeof (raw as { f?: unknown }).f !== "number" ||
      (raw as { t?: unknown }).t !== "flap"
    ) {
      return NextResponse.json({ error: "Malformed input event" }, { status: 400 });
    }
    inputs.push({ f: (raw as { f: number }).f, t: "flap" });
  }
  if (inputs.length > MAX_FRAMES) {
    return NextResponse.json({ error: "Too many inputs" }, { status: 400 });
  }

  const attempt = await prisma.attempt.findUnique({ where: { id: body.attemptId } });
  if (!attempt) return NextResponse.json({ error: "Unknown attempt" }, { status: 404 });
  if (attempt.address !== address) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (attempt.submittedAt) return NextResponse.json({ error: "Already submitted" }, { status: 409 });

  const now = Date.now();
  const age = now - attempt.createdAt.getTime();

  if (age > ATTEMPT_TTL_MS) {
    await invalidate(attempt.id, inputs);
    return NextResponse.json({ error: "Attempt expired" }, { status: 410 });
  }

  const sortedInputs = [...inputs].sort((a, b) => a.f - b.f);
  for (let i = 1; i < sortedInputs.length; i++) {
    if (sortedInputs[i].f - sortedInputs[i - 1].f < MIN_FLAP_GAP_FRAMES) {
      await invalidate(attempt.id, inputs);
      return NextResponse.json({ error: "Impossible input cadence" }, { status: 400 });
    }
  }

  const seed = parseInt(attempt.seed, 16);
  const result = replay(seed, inputs);

  const gameplayFrames = result.deadAtFrame ?? result.framesRun;
  const minWallClockMs = (gameplayFrames / 60) * 1000 - WALL_CLOCK_SLACK_MS;
  if (age < minWallClockMs) {
    await invalidate(attempt.id, inputs);
    return NextResponse.json({ error: "Replay too fast for wall-clock" }, { status: 400 });
  }

  const claimedScore = Number.isInteger(body.claimedScore) ? (body.claimedScore as number) : null;
  const valid = claimedScore !== null && claimedScore === result.score;

  await prisma.attempt.update({
    where: { id: attempt.id },
    data: {
      inputs: inputs as unknown as object,
      claimedScore: claimedScore ?? undefined,
      score: result.score,
      valid,
      submittedAt: new Date(),
    },
  });

  return NextResponse.json({
    score: result.score,
    valid,
    deadAtFrame: result.deadAtFrame,
  });
}
