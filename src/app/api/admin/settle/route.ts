import { NextResponse } from "next/server";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "@/lib/prisma";
import { publicClient, activeChain, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";
import { buildTree, type Row } from "@/lib/merkle";
import { computePayouts, PLAYER_SHARE_BPS } from "@/lib/payouts";

// POST /api/admin/settle?week=<weekId>
// Header: x-admin-secret: <ADMIN_SECRET>
//
// Runs the full weekly settlement: reads DB leaderboard for weekId, applies
// the payout curve, builds the Merkle tree, writes ClaimProof rows, posts
// settleWeek() on-chain using SETTLER_PRIVATE_KEY, writes Settlement row.
export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("x-admin-secret") !== adminSecret) {
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

  // Refuse to re-settle.
  const already = await prisma.settlement.findUnique({ where: { weekId } });
  if (already) {
    return NextResponse.json({ error: "Already settled", weekId }, { status: 409 });
  }

  // Read on-chain pool for the week — basis for payout amounts.
  const weekTuple = (await publicClient.readContract({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "weeks_",
    args: [BigInt(weekId)],
  })) as readonly [bigint, bigint, bigint, bigint, `0x${string}`];
  const pool = weekTuple[0];

  // Pull ranked leaderboard from DB.
  const ranked = await prisma.$queryRaw<
    { address: string; score: number }[]
  >`
    SELECT address, MAX(score) AS score
    FROM "Attempt"
    WHERE "weekId" = ${weekId} AND valid = true AND score IS NOT NULL AND score > 0
    GROUP BY address
    ORDER BY score DESC
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

  // Sanity: total must not exceed 75% of pool.
  const cap = (pool * BigInt(PLAYER_SHARE_BPS)) / 10000n;
  if (totalPayout > cap) {
    return NextResponse.json(
      { error: "Total payout exceeds player-share cap", totalPayout: totalPayout.toString(), cap: cap.toString() },
      { status: 500 },
    );
  }

  // Post on-chain.
  const account = privateKeyToAccount(settlerKey as `0x${string}`);
  const wallet = createWalletClient({ account, chain: activeChain, transport: http() });

  let txHash: `0x${string}` | null = null;
  try {
    txHash = await wallet.writeContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "settleWeek",
      args: [BigInt(weekId), tree.root],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "settleWeek failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Persist settlement + per-address proofs.
  await prisma.$transaction([
    prisma.settlement.create({
      data: {
        weekId,
        root: tree.root,
        totalPayout: totalPayout.toString(),
        txHash,
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
    txHash,
  });
}

// Guard against a wei-parsing dep being tree-shaken out of the bundle.
void parseEther;
