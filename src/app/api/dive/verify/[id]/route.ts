import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { datasetHash } from "@/lib/divePayouts";

// GET /api/dive/verify/:id
// Public — returns everything needed to reproduce the outcome for a
// settled round: seedHash (the pre-commit), the revealed seed, the
// user's salt, tier, chosen index, distance, bet and payout, plus the
// tier's dataset hash so a client can confirm it's looking at the same
// numbers the server used.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await prisma.diveRound.findUnique({ where: { id } });
  if (!r || !r.settledAt) {
    return NextResponse.json({ error: "Not found or unsettled" }, { status: 404 });
  }
  return NextResponse.json({
    roundId: r.id,
    address: r.address,
    seedHash: r.seedHash,
    seed: r.seed,
    userSalt: r.userSalt,
    tier: r.tier,
    outcomeIndex: r.outcomeIndex,
    distance: r.distance,
    betWei: r.betWei,
    payoutWei: r.payoutWei,
    datasetHash: r.tier ? `0x${datasetHash(r.tier as "low" | "mid" | "high").toString(16).padStart(8, "0")}` : null,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
  });
}
