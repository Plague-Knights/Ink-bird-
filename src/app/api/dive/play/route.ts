import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { distanceFor, isHex32, isTier, outcomeIndexOf, payoutWei } from "@/lib/dive";

const MIN_BET_WEI = 1_000_000_000n;             // 1 gwei
const MAX_BET_WEI = 1_000_000_000_000_000_000n; // 1 ETH

// POST /api/dive/play
// Body: { roundId, userSalt: "0x…32b", tier, betWei: "<string>" }
// Resolves a previously committed round by burning the bet from the
// caller's DiveBalance, revealing the seed that was committed at /open,
// computing the outcome = dataset[tier][keccak256(seed || salt) mod N],
// crediting payout to DiveBalance, and returning the full reveal so the
// client can verify keccak256(seed) === the seedHash it saw at /open.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  let body: { roundId?: unknown; userSalt?: unknown; tier?: unknown; betWei?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof body.roundId !== "string") {
    return NextResponse.json({ error: "Invalid roundId" }, { status: 400 });
  }
  if (!isHex32(body.userSalt)) {
    return NextResponse.json({ error: "userSalt must be 0x-prefixed 32 bytes" }, { status: 400 });
  }
  if (!isTier(body.tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (typeof body.betWei !== "string" || !/^\d+$/.test(body.betWei)) {
    return NextResponse.json({ error: "Invalid betWei" }, { status: 400 });
  }
  const betWei = BigInt(body.betWei);
  if (betWei < MIN_BET_WEI || betWei > MAX_BET_WEI) {
    return NextResponse.json({ error: "betWei out of range" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const round = await tx.diveRound.findUnique({ where: { id: body.roundId as string } });
      if (!round) throw new Error("ROUND_NOT_FOUND");
      if (round.address !== address) throw new Error("ROUND_NOT_OWNED");
      if (round.settledAt) throw new Error("ROUND_ALREADY_SETTLED");
      if (round.userSalt) throw new Error("ROUND_ALREADY_PLAYED");
      if (!round.seed) throw new Error("ROUND_MISSING_SEED");

      const bal = await tx.diveBalance.findUnique({ where: { address } });
      const current = BigInt(bal?.wei ?? "0");
      if (current < betWei) throw new Error("INSUFFICIENT_BALANCE");

      const seedHex = round.seed as `0x${string}`;
      const saltHex = body.userSalt as `0x${string}`;
      const tier = body.tier as "low" | "mid" | "high";
      const index = outcomeIndexOf(seedHex, saltHex);
      const distance = distanceFor(tier, index);
      const payout = payoutWei(distance, betWei);

      const postBal = (current - betWei + payout).toString();
      await tx.diveBalance.upsert({
        where: { address },
        update: { wei: postBal },
        create: { address, wei: postBal },
      });
      const updated = await tx.diveRound.update({
        where: { id: round.id },
        data: {
          tier,
          betWei: betWei.toString(),
          userSalt: saltHex,
          outcomeIndex: index,
          distance,
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
      tier: result.round.tier,
      outcomeIndex: result.round.outcomeIndex,
      distance: result.round.distance,
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
      ROUND_ALREADY_PLAYED: 409,
      ROUND_MISSING_SEED: 500,
      INSUFFICIENT_BALANCE: 400,
    };
    const status = map[msg] ?? 500;
    if (status === 500) console.error("[dive/play] failure", e);
    return NextResponse.json({ error: msg }, { status });
  }
}
