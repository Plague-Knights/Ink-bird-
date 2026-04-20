import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashSeed, randomSeedHex } from "@/lib/dive";

// POST /api/dive/open
// Committed-seed-first step of the commit-reveal cycle. The server picks
// a random seed and returns only its keccak256 hash. The raw seed is
// kept server-side and will be revealed by /api/dive/play — we do this
// BEFORE the user's salt arrives so the server cannot pre-select a seed
// that grinds in its favor against a known salt. The round has no bet
// or tier yet; those are locked in /play.
export async function POST() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  const seed = randomSeedHex();
  const seedHash = hashSeed(seed);

  const round = await prisma.diveRound.create({
    data: {
      address,
      tier: "",        // set in /play
      betWei: "0",     // set in /play
      userSalt: "",    // set in /play
      seedHash,
      seed,
    },
  });

  return NextResponse.json({ roundId: round.id, seedHash: round.seedHash });
}
