import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/launch/verify/:id — public audit trail.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await prisma.launchRound.findUnique({ where: { id } });
  if (!r || !r.settledAt) {
    return NextResponse.json({ error: "Not found or unsettled" }, { status: 404 });
  }
  return NextResponse.json({
    roundId: r.id,
    address: r.address,
    seedHash: r.seedHash,
    seed: r.seed,
    userSalt: r.userSalt,
    simSeed: r.simSeed?.toString(),
    score: r.score,
    framesRun: r.framesRun,
    betWei: r.betWei,
    payoutWei: r.payoutWei,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
  });
}
