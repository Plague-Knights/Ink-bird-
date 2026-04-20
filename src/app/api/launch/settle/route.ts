import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { replay, type SimInput } from "@/lib/simulate";
import { launchPayoutWei } from "@/lib/launch";

const MAX_INPUT_BYTES = 1_000_000; // mirror the main game's body cap
const MIN_FLAP_GAP = 3; // frames; matches anti-bot floor in /api/replay/submit

// POST /api/launch/settle
// Body: { roundId, inputs: [{f, t:"flap"}, ...], claimedScore }
// Settles a launch round: server re-runs simulate.replay with the bound
// sim seed, enforces the same anti-cheat floors as the main skill game
// (flap cadence, wall-clock floor), and on a valid run credits the
// distance-based payout to DiveBalance. claimedScore is echo-only —
// the server's recomputed score is authoritative.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_INPUT_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  let body: { roundId?: unknown; inputs?: unknown; claimedScore?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.roundId !== "string") {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }
  if (!Array.isArray(body.inputs)) {
    return NextResponse.json({ error: "Invalid inputs" }, { status: 400 });
  }

  // Normalize + validate the input log shape.
  const inputs: SimInput[] = [];
  let lastFrame = -1;
  for (const raw of body.inputs as unknown[]) {
    if (!raw || typeof raw !== "object") return NextResponse.json({ error: "Invalid input entry" }, { status: 400 });
    const f = (raw as { f?: unknown }).f;
    const t = (raw as { t?: unknown }).t;
    if (t !== "flap") return NextResponse.json({ error: "Invalid input type" }, { status: 400 });
    if (!Number.isInteger(f) || (f as number) < 0) return NextResponse.json({ error: "Invalid frame" }, { status: 400 });
    if ((f as number) - lastFrame < MIN_FLAP_GAP) {
      return NextResponse.json({ error: "Flap cadence too tight" }, { status: 400 });
    }
    lastFrame = f as number;
    inputs.push({ f: f as number, t: "flap" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const round = await tx.launchRound.findUnique({ where: { id: body.roundId as string } });
      if (!round) throw new Error("ROUND_NOT_FOUND");
      if (round.address !== address) throw new Error("ROUND_NOT_OWNED");
      if (round.settledAt) throw new Error("ROUND_ALREADY_SETTLED");
      if (round.simSeed === null || round.simSeed === undefined) throw new Error("ROUND_MISSING_SEED");

      // Wall-clock floor — the run must have taken at least the number
      // of seconds the simulated gameplay would have needed in real
      // time. Mirrors the existing skill-game anti-bot check.
      const simSeconds = lastFrame / 60;
      const wallSeconds = (Date.now() - round.createdAt.getTime()) / 1000;
      if (wallSeconds + 2 < simSeconds) {
        throw new Error("WALLCLOCK_TOO_FAST");
      }

      const simSeed = Number(round.simSeed);
      const { score, framesRun } = replay(simSeed, inputs);
      const betWei = BigInt(round.betWei);
      const payout = launchPayoutWei(score, betWei);

      const bal = await tx.diveBalance.findUnique({ where: { address } });
      const current = BigInt(bal?.wei ?? "0");
      const postBal = (current + payout).toString();
      await tx.diveBalance.upsert({
        where: { address },
        update: { wei: postBal },
        create: { address, wei: postBal },
      });
      const updated = await tx.launchRound.update({
        where: { id: round.id },
        data: {
          score,
          framesRun,
          payoutWei: payout.toString(),
          settledAt: new Date(),
        },
      });
      return { round: updated, balanceWei: postBal };
    });

    return NextResponse.json({
      roundId: result.round.id,
      seedHash: result.round.seedHash,
      seed: result.round.seed,
      userSalt: result.round.userSalt,
      score: result.round.score,
      framesRun: result.round.framesRun,
      betWei: result.round.betWei,
      payoutWei: result.round.payoutWei,
      balanceWei: result.balanceWei,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    const map: Record<string, number> = {
      ROUND_NOT_FOUND: 404,
      ROUND_NOT_OWNED: 403,
      ROUND_ALREADY_SETTLED: 409,
      ROUND_MISSING_SEED: 500,
      WALLCLOCK_TOO_FAST: 400,
    };
    const status = map[msg] ?? 500;
    if (status === 500) console.error("[launch/settle] failure", e);
    return NextResponse.json({ error: msg }, { status });
  }
}
