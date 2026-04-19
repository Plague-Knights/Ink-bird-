import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/claim-proof?week=<weekId>&address=<0x...>
// Returns { amount, proof[] } for use with arcade.claim(). Public endpoint —
// proofs are not secret; on-chain the contract verifies them anyway.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const week = url.searchParams.get("week");
  const addressParam = url.searchParams.get("address");

  if (!week || !addressParam) {
    return NextResponse.json({ error: "Missing week or address" }, { status: 400 });
  }
  const weekId = Number(week);
  if (!Number.isInteger(weekId) || weekId < 0) {
    return NextResponse.json({ error: "Invalid week" }, { status: 400 });
  }
  const address = addressParam.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const row = await prisma.claimProof.findUnique({
    where: { weekId_address: { weekId, address } },
  });
  if (!row) return NextResponse.json({ error: "No claim" }, { status: 404 });

  return NextResponse.json({
    weekId,
    address,
    amount: row.amount,
    proof: row.proof,
  });
}
