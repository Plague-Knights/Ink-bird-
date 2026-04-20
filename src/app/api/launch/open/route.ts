import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashSeed, isHex32, randomSeedHex } from "@/lib/dive";
import { simSeedFrom } from "@/lib/launch";

const MIN_BET_WEI = 1_000_000_000n;
const MAX_BET_WEI = 1_000_000_000_000_000_000n;

// POST /api/launch/open
// Body: { userSalt: "0x...32b", betWei: "<string>" }
// Unlike /dive and /cannon which split open and play into two calls,
// /launch does the whole commit+charge in one step because the client
// needs the numeric sim seed to start the game immediately. We still
// get the fairness guarantee: the salt is bound into the sim seed, the
// server commits the hash server-side and reveals it on /settle, and
// the outcome (distance achieved) is pure player skill on top of a
// map pinned at this moment.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  let body: { userSalt?: unknown; betWei?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!isHex32(body.userSalt)) {
    return NextResponse.json({ error: "userSalt must be 0x-prefixed 32 bytes" }, { status: 400 });
  }
  if (typeof body.betWei !== "string" || !/^\d+$/.test(body.betWei)) {
    return NextResponse.json({ error: "Invalid betWei" }, { status: 400 });
  }
  const betWei = BigInt(body.betWei);
  if (betWei < MIN_BET_WEI || betWei > MAX_BET_WEI) {
    return NextResponse.json({ error: "betWei out of range" }, { status: 400 });
  }

  const seed = randomSeedHex();
  const seedHash = hashSeed(seed);
  const saltHex = body.userSalt as `0x${string}`;
  const simSeed = simSeedFrom(seed, saltHex);

  try {
    const round = await prisma.$transaction(async (tx) => {
      const bal = await tx.diveBalance.findUnique({ where: { address } });
      const current = BigInt(bal?.wei ?? "0");
      if (current < betWei) throw new Error("INSUFFICIENT_BALANCE");
      const next = (current - betWei).toString();
      await tx.diveBalance.upsert({
        where: { address },
        update: { wei: next },
        create: { address, wei: next },
      });
      return tx.launchRound.create({
        data: {
          address,
          betWei: betWei.toString(),
          userSalt: saltHex,
          seedHash,
          seed,
          simSeed: BigInt(simSeed),
        },
      });
    });

    return NextResponse.json({
      roundId: round.id,
      seedHash: round.seedHash,
      simSeed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    if (msg === "INSUFFICIENT_BALANCE") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[launch/open] failure", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
