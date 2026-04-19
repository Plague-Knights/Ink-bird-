import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { publicClient, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";
import { buildTree, type Row } from "@/lib/merkle";
import { distributeCurve, PLAYER_SHARE_BPS, REFERRAL_BPS, BPS_DENOM } from "@/lib/payouts";

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

  // --- Referral payouts ----------------------------------------------------
  // Scan AttemptsBought(player, value, attempts, weekId) logs for the week
  // to get authoritative per-player wei spend (the on-chain attemptsBought
  // mapping is cumulative, not per-week). Then credit 5% of each referred
  // player's spend to their pinned referrer.
  //
  // INK_SQUID_DEPLOY_BLOCK lets us skip scanning pre-deploy history on RPCs
  // that cap block range. Defaults to 0n — fine while the chain is young.
  const fromBlockEnv = process.env.INK_SQUID_DEPLOY_BLOCK;
  const fromBlock = fromBlockEnv ? BigInt(fromBlockEnv) : 0n;

  const logs = await publicClient.getContractEvents({
    address: activeContracts.arcade,
    abi: InkSquidArcadeAbi,
    eventName: "AttemptsBought",
    args: { weekId: BigInt(weekId) },
    fromBlock,
    toBlock: "latest",
  });

  const spend = new Map<string, bigint>();
  for (const log of logs) {
    const { player, value } = log.args as { player?: `0x${string}`; value?: bigint };
    if (!player || value === undefined) continue;
    const key = player.toLowerCase();
    spend.set(key, (spend.get(key) ?? 0n) + value);
  }

  const referred = Array.from(spend.keys());
  const referralRows =
    referred.length === 0
      ? []
      : await prisma.referral.findMany({ where: { referred: { in: referred } } });
  const refMap = new Map<string, string>();
  for (const r of referralRows) refMap.set(r.referred, r.referrer);

  const refPayouts = new Map<string, bigint>();
  for (const [player, wei] of spend) {
    const referrer = refMap.get(player);
    if (!referrer) continue;
    const cut = (wei * BigInt(REFERRAL_BPS)) / BigInt(BPS_DENOM);
    if (cut === 0n) continue;
    refPayouts.set(referrer, (refPayouts.get(referrer) ?? 0n) + cut);
  }
  const referralTotal = Array.from(refPayouts.values()).reduce((a, b) => a + b, 0n);

  // --- Placement payouts ---------------------------------------------------
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

  const playerShare = (pool * BigInt(PLAYER_SHARE_BPS)) / BigInt(BPS_DENOM);
  if (referralTotal > playerShare) {
    return NextResponse.json(
      {
        error: "Referral payouts exceed player share",
        playerShare: playerShare.toString(),
        referralTotal: referralTotal.toString(),
      },
      { status: 500 },
    );
  }
  const placementBudget = playerShare - referralTotal;
  const payouts = distributeCurve(placementBudget);

  // Merge placement + referral into a single amount per address — the
  // contract's claimedByWeek mapping keys by (weekId, player), so one
  // wallet must appear at most once in the merkle tree.
  const totals = new Map<`0x${string}`, bigint>();
  for (let i = 0; i < ranked.length && i < payouts.length; i++) {
    if (payouts[i] === 0n) continue;
    const addr = ranked[i].address.toLowerCase() as `0x${string}`;
    totals.set(addr, (totals.get(addr) ?? 0n) + payouts[i]);
  }
  for (const [referrer, amt] of refPayouts) {
    const addr = referrer.toLowerCase() as `0x${string}`;
    totals.set(addr, (totals.get(addr) ?? 0n) + amt);
  }

  const rows: Row[] = Array.from(totals.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([address, amount]) => ({ address, amount }));

  const tree = buildTree(rows);
  const totalPayout = rows.reduce((acc, r) => acc + r.amount, 0n);
  if (totalPayout > playerShare) {
    return NextResponse.json(
      { error: "Total payout exceeds player-share cap", totalPayout: totalPayout.toString(), cap: playerShare.toString() },
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
    referralPayout: referralTotal.toString(),
    referralRecipients: refPayouts.size,
    txHash: null,
  });
}
