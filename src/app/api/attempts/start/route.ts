import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { publicClient, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";

export async function POST() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase() as `0x${string}`;

  // Three independent reads — fire in parallel. Saves ~2 RPC roundtrips
  // vs. the previous sequential await chain.
  const [boughtResult, consumedResult, weekIdResult] = await Promise.allSettled([
    publicClient.readContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "attemptsBought",
      args: [address],
    }) as Promise<bigint>,
    prisma.attempt.count({ where: { address } }),
    publicClient.readContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "currentWeekId",
    }) as Promise<bigint>,
  ]);

  if (boughtResult.status === "rejected") {
    return NextResponse.json({ error: "Unable to read attempt balance" }, { status: 502 });
  }
  if (consumedResult.status === "rejected") {
    return NextResponse.json({ error: "DB read failed" }, { status: 500 });
  }

  const bought = boughtResult.value;
  const consumed = consumedResult.value;
  const weekId = weekIdResult.status === "fulfilled" ? Number(weekIdResult.value) : 0;

  if (consumed >= Number(bought)) {
    return NextResponse.json({ error: "No attempts remaining" }, { status: 402 });
  }

  // Server-generated 32-bit seed. Fits in a single Mulberry32 state word.
  const seed = Math.floor(Math.random() * 0xffffffff);

  // Serializable txn closes the TOCTOU hole: two concurrent starts cannot
  // both pass the consumed < bought check — Postgres aborts one with a
  // serialization failure, which we surface as a 409 so the client retries.
  // Also burns any outstanding unsubmitted attempt so seeds can't be farmed
  // in parallel for offline solving.
  let attempt;
  try {
    attempt = await prisma.$transaction(async (tx) => {
      const consumedNow = await tx.attempt.count({ where: { address } });
      if (consumedNow >= Number(bought)) {
        throw new Error("NO_ATTEMPTS");
      }
      await tx.attempt.updateMany({
        where: { address, submittedAt: null },
        data: { valid: false, submittedAt: new Date() },
      });
      return tx.attempt.create({
        data: {
          address,
          weekId,
          seed: seed.toString(16).padStart(8, "0"),
        },
      });
    }, { isolationLevel: "Serializable" });
  } catch (e) {
    if (e instanceof Error && e.message === "NO_ATTEMPTS") {
      return NextResponse.json({ error: "No attempts remaining" }, { status: 402 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("could not serialize") || msg.includes("40001")) {
      return NextResponse.json({ error: "Concurrent start, retry" }, { status: 409 });
    }
    console.error("[attempts/start] txn failure", e);
    return NextResponse.json({ error: "Start failed" }, { status: 500 });
  }

  return NextResponse.json({ attemptId: attempt.id, seed });
}
