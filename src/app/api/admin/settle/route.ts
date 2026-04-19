import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@/lib/prisma";
import { publicClient, activeChain, activeContracts } from "@/lib/chain";
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
// Settlement is split into two phases so a failed on-chain tx can't leave
// users without claim proofs:
//   1. Build payouts + merkle tree, persist Settlement(txHash=null) +
//      ClaimProof rows in one DB transaction.
//   2. Broadcast settleWeek() and patch the stored txHash.
// Re-invoking this endpoint after step 1 succeeded but step 2 failed resumes
// from the stored root — the leaderboard is NOT re-queried, so any scores
// submitted in between can't shift the tree out from under already-written
// proofs.
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

  const settlerKey = process.env.SETTLER_PRIVATE_KEY;
  if (!settlerKey) {
    return NextResponse.json({ error: "SETTLER_PRIVATE_KEY not configured" }, { status: 500 });
  }

  const existing = await prisma.settlement.findUnique({ where: { weekId } });
  if (existing && existing.txHash) {
    return NextResponse.json({ error: "Already settled", weekId, txHash: existing.txHash }, { status: 409 });
  }

  let root: `0x${string}`;
  let totalPayout: bigint;
  let winners: number;

  if (existing) {
    // Resume path: DB was written, on-chain tx wasn't. Use stored root.
    root = existing.root as `0x${string}`;
    totalPayout = BigInt(existing.totalPayout);
    winners = await prisma.claimProof.count({ where: { weekId } });
  } else {
    // Fresh settlement: compute + persist before touching the chain.
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
    totalPayout = rows.reduce((acc, r) => acc + r.amount, 0n);
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

    root = tree.root;
    winners = rows.length;
  }

  // Broadcast on-chain. If this fails, the DB is already consistent and the
  // caller can re-invoke to resume at this step with the same root.
  const account = privateKeyToAccount(settlerKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });

  let txHash: `0x${string}`;
  try {
    txHash = await wallet.writeContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "settleWeek",
      args: [BigInt(weekId), root],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "settleWeek failed — DB persisted, rerun to retry", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  await prisma.settlement.update({
    where: { weekId },
    data: { txHash },
  });

  return NextResponse.json({
    weekId,
    root,
    totalPayout: totalPayout.toString(),
    winners,
    txHash,
  });
}

// Guard against a wei-parsing dep being tree-shaken out of the bundle.
void parseEther;
