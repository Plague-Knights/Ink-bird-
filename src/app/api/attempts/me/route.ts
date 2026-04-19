import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { publicClient, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";

export async function GET() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const address = session.address.toLowerCase() as `0x${string}`;

  let bought = 0n;
  try {
    bought = (await publicClient.readContract({
      address: activeContracts.arcade,
      abi: InkSquidArcadeAbi,
      functionName: "attemptsBought",
      args: [address],
    })) as bigint;
  } catch {
    // Contract not deployed yet or RPC issue — treat as zero.
  }

  const consumed = await prisma.attempt.count({
    where: { address },
  });

  const remaining = Number(bought) - consumed;
  return NextResponse.json({
    address,
    bought: Number(bought),
    consumed,
    remaining: Math.max(0, remaining),
  });
}
