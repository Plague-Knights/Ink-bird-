import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicClient, activeContracts } from "@/lib/chain";
import { InkSquidArcadeAbi } from "@/config/abis/InkSquidArcade";

// Leaderboard for the current on-chain week. Returns top 20 valid attempts
// (ranked by highest single-run score per address).
export async function GET() {
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
    // Contract not deployed — fall through with weekId=0; returns empty board.
  }

  // Tiebreaker matches admin/settle exactly so the displayed leaderboard
  // reflects the same ranking used for payouts: best score per address,
  // ties broken by earliest submission, then by address.
  const rows = await prisma.$queryRaw<
    { address: string; score: number }[]
  >`
    WITH best AS (
      SELECT DISTINCT ON (address)
        address, score, "submittedAt"
      FROM "Attempt"
      WHERE "weekId" = ${weekId}
        AND valid = true
        AND score IS NOT NULL
      ORDER BY address, score DESC, "submittedAt" ASC
    )
    SELECT address, score
    FROM best
    ORDER BY score DESC, "submittedAt" ASC, address ASC
    LIMIT 20
  `;

  return NextResponse.json({
    weekId,
    scores: rows.map((r) => ({
      address: r.address,
      score: Number(r.score),
    })),
  });
}
