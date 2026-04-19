import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// POST /api/admin/settle/record
// Header: x-admin-secret: <ADMIN_SECRET>
// Body:   { weekId: number, txHash: "0x..." }
//
// Called by scripts/settle-week.ts after it broadcasts settleWeek() with the
// locally-held settler key. Idempotent when the submitted hash matches what
// is already stored; rejects a mismatched overwrite so a leaked admin secret
// can't silently swap the canonical tx pointer.
export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }
  if (!safeEq(req.headers.get("x-admin-secret") ?? "", adminSecret)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { weekId?: unknown; txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const weekId = Number(body.weekId);
  if (!Number.isInteger(weekId) || weekId < 0) {
    return NextResponse.json({ error: "Invalid weekId" }, { status: 400 });
  }
  if (typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) {
    return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
  }
  const txHash = body.txHash.toLowerCase() as `0x${string}`;

  const existing = await prisma.settlement.findUnique({ where: { weekId } });
  if (!existing) {
    return NextResponse.json({ error: "No settlement for week" }, { status: 404 });
  }
  if (existing.txHash && existing.txHash.toLowerCase() === txHash) {
    return NextResponse.json({ weekId, txHash, alreadyRecorded: true });
  }
  if (existing.txHash) {
    return NextResponse.json(
      { error: "Settlement already recorded with a different tx", existingTx: existing.txHash },
      { status: 409 },
    );
  }

  await prisma.settlement.update({
    where: { weekId },
    data: { txHash },
  });

  return NextResponse.json({ weekId, txHash });
}
