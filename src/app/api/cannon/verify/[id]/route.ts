import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { datasetHash } from "@/lib/cannonPayouts";

// GET /api/cannon/verify/:id
// Public audit trail. Returns the committed seedHash, revealed seed,
// user salt, outcomeIndex, full event sequence, and dataset hash so a
// third party can re-derive keccak256(seed||salt) mod N and confirm it
// matches the published event list.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await prisma.cannonRound.findUnique({ where: { id } });
  if (!r || !r.settledAt) {
    return NextResponse.json({ error: "Not found or unsettled" }, { status: 404 });
  }
  return NextResponse.json({
    roundId: r.id,
    address: r.address,
    seedHash: r.seedHash,
    seed: r.seed,
    userSalt: r.userSalt,
    outcomeIndex: r.outcomeIndex,
    events: r.eventSeq,
    totalMultiplierBps: r.totalMultiplierBps,
    betWei: r.betWei,
    payoutWei: r.payoutWei,
    datasetHash: `0x${datasetHash().toString(16).padStart(8, "0")}`,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
  });
}
