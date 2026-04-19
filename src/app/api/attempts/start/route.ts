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

  // Check on-chain attempt balance against off-chain consumption.
  let bought = 0n;
  try {
    bought = (await publicClient.readContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "attemptsBought",
      args: [address],
    })) as bigint;
  } catch {
    return NextResponse.json({ error: "Unable to read attempt balance" }, { status: 502 });
  }

  const consumed = await prisma.attempt.count({ where: { address } });
  if (consumed >= Number(bought)) {
    return NextResponse.json({ error: "No attempts remaining" }, { status: 402 });
  }

  // Derive current week from chain time.
  let weekId = 0;
  try {
    weekId = Number(
      (await publicClient.readContract({
        address: activeContracts.arcade,
        abi: InkSquidArcadeAbi,
        functionName: "currentWeekId",
      })) as bigint,
    );
  } catch {
    // keep 0 as a fallback
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
