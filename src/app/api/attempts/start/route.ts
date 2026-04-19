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

  const attempt = await prisma.attempt.create({
    data: {
      address,
      weekId,
      seed: seed.toString(16).padStart(8, "0"),
    },
  });

  return NextResponse.json({ attemptId: attempt.id, seed });
}
