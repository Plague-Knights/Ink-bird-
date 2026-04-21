import { NextRequest, NextResponse } from "next/server";
import { keccak256, toHex } from "viem";
import { chestsAddressForChain } from "@/lib/chestsContract";
import { rememberSeed } from "@/lib/chestRounds";
import { inkSepolia } from "@/config/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Client passes ?chain=<chainId>. Defaults to Ink Sepolia if omitted.
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chain") ?? inkSepolia.id);

  const contractAddress = chestsAddressForChain(chainId);
  if (!contractAddress) {
    return NextResponse.json({ error: `no chest contract for chain ${chainId}` }, { status: 400 });
  }

  // 32 random bytes = the seed the player will eventually unlock when
  // we call reveal(). We only ever ship the keccak hash to the client;
  // the seed itself stays server-side until the on-chain Played event
  // is observed.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const seed = toHex(buf);
  const seedHash = keccak256(seed);
  rememberSeed(seedHash, seed, chainId);

  return NextResponse.json({
    seedHash,
    chainId,
    contractAddress,
  });
}
