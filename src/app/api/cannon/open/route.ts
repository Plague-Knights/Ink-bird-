import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashSeed, randomSeedHex } from "@/lib/dive";

// POST /api/cannon/open
// Same commit-first pattern as /api/dive/open. Server generates the
// seed, publishes only its keccak256 hash, and holds the raw seed
// until /api/cannon/play reveals it. Bet and salt are locked at play
// time so the server cannot grind seeds after seeing the user's salt.
export async function POST() {
  const session = await getSession();
  if (!session.address) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  const seed = randomSeedHex();
  const seedHash = hashSeed(seed);

  const round = await prisma.cannonRound.create({
    data: {
      address,
      betWei: "0",
      userSalt: "",
      seedHash,
      seed,
    },
  });

  return NextResponse.json({ roundId: round.id, seedHash: round.seedHash });
}
