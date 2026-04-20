import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET /api/referral/stats — returns { count } for the signed-in wallet.
// Used by ReferralPanel to show how many people the user has referred.
// Pending wei earnings aren't computed here; that requires an
// AttemptsBought log scan and is deferred until that data is indexed.
export async function GET() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const count = await prisma.referral.count({
    where: { referrer: session.address.toLowerCase() },
  });
  return NextResponse.json({ count });
}
