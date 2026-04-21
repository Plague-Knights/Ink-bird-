// Opens a new cannon round: mints a random 32-byte seed, keeps the
// pre-image server-side, and returns its keccak hash for the player to
// commit on-chain. Mirrors /api/chest/open — same commit-reveal flow,
// different underlying contract.

import { NextRequest, NextResponse } from "next/server";
import { keccak256, toHex } from "viem";
import { cannonAddressForChain } from "@/lib/cannonContract";
import { rememberSeed } from "@/lib/chestRounds";
import { inkSepolia } from "@/config/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chain") ?? inkSepolia.id);

  const contractAddress = cannonAddressForChain(chainId);
  if (!contractAddress) {
    return NextResponse.json({ error: `no cannon contract for chain ${chainId}` }, { status: 400 });
  }

  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const seed = toHex(buf);
  const seedHash = keccak256(seed);
  rememberSeed(seedHash, seed, chainId);

  return NextResponse.json({ seedHash, chainId, contractAddress });
}
