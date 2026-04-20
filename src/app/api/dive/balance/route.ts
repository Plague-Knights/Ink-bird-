import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// GET /api/dive/balance — returns caller's mock dive balance.
export async function GET() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();
  const bal = await prisma.diveBalance.findUnique({ where: { address } });
  return NextResponse.json({ address, balanceWei: bal?.wei ?? "0" });
}
