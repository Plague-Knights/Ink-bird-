import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// POST /api/dive/faucet
// Prototype-only: credit a fixed amount of mock wei to the caller's
// DiveBalance so they can play without real ETH. Rate-limited to a
// single faucet per 30s per address. This endpoint goes away when the
// on-chain contract replaces the DB-backed balance.
const FAUCET_WEI = 100_000_000_000_000_000n; // 0.1 ETH
const COOLDOWN_MS = 30_000;

const lastGrantByAddress = new Map<string, number>();

export async function POST() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  const now = Date.now();
  const last = lastGrantByAddress.get(address) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json(
      { error: "Cooldown active", retryAfterMs: COOLDOWN_MS - (now - last) },
      { status: 429 },
    );
  }
  lastGrantByAddress.set(address, now);

  const bal = await prisma.diveBalance.findUnique({ where: { address } });
  const next = (BigInt(bal?.wei ?? "0") + FAUCET_WEI).toString();
  await prisma.diveBalance.upsert({
    where: { address },
    update: { wei: next },
    create: { address, wei: next },
  });
  return NextResponse.json({ balanceWei: next, grantedWei: FAUCET_WEI.toString() });
}
