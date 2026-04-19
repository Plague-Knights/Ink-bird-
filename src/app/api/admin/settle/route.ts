import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { publicClient, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";
import { buildTree, type Row } from "@/lib/merkle";
import { computePayouts, PLAYER_SHARE_BPS } from "@/lib/payouts";

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// POST /api/admin/settle?week=<weekId>
// Header: x-admin-secret: <ADMIN_SECRET>
//
// DB-only phase of settlement. Computes payouts + merkle tree and persists
// Settlement(txHash=null) + ClaimProof rows. Does NOT broadcast on-chain —
// the settler key is never present on the web server. The admin runs
// scripts/settle-week.ts locally to broadcast settleWeek() with the stored
// root, then calls /api/admin/settle/record to save the tx hash.
//
// Re-invoking after this endpoint succeeded returns the already-computed
// root so nothing shifts under already-written proofs if the leaderboard
// changes between attempts.
export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }
  if (!safeEq(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  if (!weekParam) {
    return NextResponse.json({ error: "Missing week param" }, { status: 400 });
  }
  const weekId = Number(weekParam);
  if (!Number.isInteger(weekId) || weekId < 0) {
    return NextResponse.json({ error: "Invalid week" }, { status: 400 });
  }

  const existing = await prisma.settlement.findUnique({ where: { weekId } });
  if (existing && existing.txHash) {
    return NextResponse.json({ error: "Already settled", weekId, txHash: existing.txHash }, { status: 409 });
  }

  if (existing) {
    const winners = await prisma.claimProof.count({ where: { weekId } });
    return NextResponse.json({
      weekId,
      root: existing.root,
      totalPayout: existing.totalPayout,
      winners,
      txHash: null,
      resumed: true,
    });
  }

  const weekTuple = (await publicClient.readContract({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "weeks_",
    args: [BigInt(weekId)],
  })) as readonly [bigint, bigint, bigint, bigint, `0x${string}`];
  const pool = weekTuple[0];

  // Tiebreaker: earliest submission among an address's valid attempts wins
  // rank, then address alphabetically. Eliminates Postgres-dependent order.
  const ranked = await prisma.$queryRaw<
    { address: string; score: number; submittedAt: Date }[]
  >`
    WITH best AS (
      SELECT DISTINCT ON (address)
        address, score, "submittedAt"
      FROM "Attempt"
      WHERE "weekId" = ${weekId}
        AND valid = true
        AND score IS NOT NULL
        AND score > 0
      ORDER BY address, score DESC, "submittedAt" ASC
    )
    SELECT address, score, "submittedAt"
    FROM best
    ORDER BY score DESC, "submittedAt" ASC, address ASC
    LIMIT 20
  `;

  const payouts = computePayouts(pool);
  const rows: Row[] = [];
  for (let i = 0; i < ranked.length && i < payouts.length; i++) {
    if (payouts[i] === 0n) continue;
    rows.push({
      address: ranked[i].address.toLowerCase() as `0x${string}`,
      amount: payouts[i],
    });
  }

  const tree = buildTree(rows);
  const totalPayout = rows.reduce((acc, r) => acc + r.amount, 0n);
  const cap = (pool * BigInt(PLAYER_SHARE_BPS)) / 10000n;
  if (totalPayout > cap) {
    return NextResponse.json(
      { error: "Total payout exceeds player-share cap", totalPayout: totalPayout.toString(), cap: cap.toString() },
      { status: 500 },
    );
  }

  await prisma.$transaction([
    prisma.settlement.create({
      data: {
        weekId,
        root: tree.root,
        totalPayout: totalPayout.toString(),
        txHash: null,
      },
    }),
    prisma.claimProof.createMany({
      data: rows.map((r, i) => ({
        weekId,
        address: r.address,
        amount: r.amount.toString(),
        proof: tree.proofs[i],
      })),
    }),
  ]);

  return NextResponse.json({
    weekId,
    root: tree.root,
    totalPayout: totalPayout.toString(),
    winners: rows.length,
    txHash: null,
  });
}
