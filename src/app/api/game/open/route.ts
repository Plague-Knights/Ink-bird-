// Opens a new InkSquidGame round. Mints the server seed, returns its
// keccak hash. The client generates its own playerSeed client-side and
// passes BOTH to the contract's `play(serverSeedHash, playerSeed)`.
//
// Two-seed design matters: even if this route is compromised and the
// attacker can grind serverSeed choices offline, the roll still depends
// on the playerSeed the player picked locally — so the attacker can't
// pre-select jackpot rolls for arbitrary players.

import { NextRequest, NextResponse } from "next/server";
import { keccak256, toHex } from "viem";
import { gameAddressForChain } from "@/lib/gameContract";
import { rememberServerSeed } from "@/lib/gameRounds";
import { inkSepolia } from "@/config/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get("chain") ?? inkSepolia.id);

  const contractAddress = gameAddressForChain(chainId);
  if (!contractAddress) {
    return NextResponse.json(
      { error: `no InkSquidGame deployed on chain ${chainId}` },
      { status: 400 },
    );
  }

  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const serverSeed = toHex(buf);
  const serverSeedHash = keccak256(serverSeed);
  rememberServerSeed(serverSeedHash, serverSeed, chainId);

  return NextResponse.json({
    serverSeedHash,
    chainId,
    contractAddress,
  });
}
