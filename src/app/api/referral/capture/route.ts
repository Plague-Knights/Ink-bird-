import { NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { getSession } from "@/lib/session";

// POST /api/referral/capture. Body: { referrer: "0x..." }
// Pins the referrer into the session so it can be bound to the wallet
// once the user completes SIWE. No-ops if the user is already signed
// in (the referrer column is locked at bind time, not here).
export async function POST(req: Request) {
  let referrer: string;
  try {
    const body = await req.json();
    referrer = body.referrer;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (typeof referrer !== "string" || !isAddress(referrer)) {
    return NextResponse.json({ error: "Invalid referrer" }, { status: 400 });
  }

  const session = await getSession();
  if (session.address && session.address.toLowerCase() === referrer.toLowerCase()) {
    return NextResponse.json({ ok: true, ignored: "self" });
  }
  session.pendingReferrer = getAddress(referrer) as `0x${string}`;
  await session.save();
  return NextResponse.json({ ok: true });
}
