// Polling endpoint for an InkSquidGame round. Mirrors /api/chest/round
// but uses the new ABI. Returns one of:
//   waiting     — Played tx not yet seen on-chain (client keeps polling)
//   revealing   — Played seen, we've fired reveal, waiting for Resolved
//   resolved    — Resolved seen, payload includes multiplier + payout + roll
//   stuck       — server lost the seed pre-image (process restart etc);
//                 player can recover via the on-chain claimTimeout after 1h
//
// On claimTimeout-refunded rounds the Resolved event is NOT emitted
// (the contract emits Refunded instead); we surface that so the UI can
// show "refunded" rather than hanging on a ghost round.

import { NextRequest, NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { GAME_ABI } from "@/lib/gameContract";
import { gamePublicClientFor, gameResolverWalletFor, gameAddressFor } from "@/lib/gameServer";
import { recallServerSeed, forgetServerSeed } from "@/lib/gameRounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYED_EVENT = parseAbiItem(
  "event Played(uint256 indexed roundId, address indexed player, bytes32 serverSeedHash, bytes32 playerSeed, uint256 betWei)"
);
const RESOLVED_EVENT = parseAbiItem(
  "event Resolved(uint256 indexed roundId, address indexed player, uint256 betWei, uint16 multiplierThousandths, uint256 payoutWei, bytes32 roll)"
);
const REFUNDED_EVENT = parseAbiItem(
  "event Refunded(uint256 indexed roundId, address indexed player, uint256 betWei)"
);

const inFlightReveals = new Set<string>();

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ seedHash: string }> },
) {
  const { seedHash } = await ctx.params;
  if (!/^0x[a-fA-F0-9]{64}$/.test(seedHash)) {
    return NextResponse.json({ error: "bad seedHash" }, { status: 400 });
  }

  const url = new URL(req.url);
  const entry = recallServerSeed(seedHash);
  const chainId = Number(url.searchParams.get("chain") ?? entry?.chainId ?? 763373);

  let address: `0x${string}`;
  try { address = gameAddressFor(chainId); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const client = gamePublicClientFor(chainId);
  const head = await client.getBlockNumber();
  const fromBlock = head > 1000n ? head - 1000n : 0n;

  const playedLogs = await client.getLogs({
    address,
    event: PLAYED_EVENT,
    fromBlock,
    toBlock: head,
  });
  const targetHash = seedHash.toLowerCase();
  const played = playedLogs.find(l => (l.args.serverSeedHash ?? "").toString().toLowerCase() === targetHash);

  if (!played) {
    return NextResponse.json({ status: "waiting", phase: "awaiting_play" });
  }

  const roundId   = played.args.roundId!;
  const player    = played.args.player!;
  const betWei    = played.args.betWei!;
  const playerSeed = played.args.playerSeed!;

  // Already settled? Could be a Resolved (normal reveal) or Refunded
  // (claimTimeout fired). Check both so stuck rounds don't hang forever.
  const [resolvedLogs, refundedLogs] = await Promise.all([
    client.getLogs({ address, event: RESOLVED_EVENT, args: { roundId }, fromBlock, toBlock: head }),
    client.getLogs({ address, event: REFUNDED_EVENT, args: { roundId }, fromBlock, toBlock: head }),
  ]);

  if (resolvedLogs.length > 0) {
    const r = resolvedLogs[0]!;
    forgetServerSeed(seedHash);
    return NextResponse.json({
      status: "resolved",
      roundId: roundId.toString(),
      chainId,
      player,
      playerSeed,
      betWei: betWei.toString(),
      payoutWei: (r.args.payoutWei ?? 0n).toString(),
      multiplierThousandths: r.args.multiplierThousandths ?? 0,
      roll: r.args.roll,
      txReveal: r.transactionHash,
    });
  }

  if (refundedLogs.length > 0) {
    const r = refundedLogs[0]!;
    forgetServerSeed(seedHash);
    return NextResponse.json({
      status: "refunded",
      roundId: roundId.toString(),
      chainId,
      player,
      betWei: betWei.toString(),
      refundWei: (r.args.betWei ?? 0n).toString(),
      txRefund: r.transactionHash,
    });
  }

  // Not yet settled. If we still hold the seed pre-image, fire reveal.
  if (!entry) {
    return NextResponse.json({
      status: "stuck",
      reason: "seed pre-image lost server-side — round can be refunded on-chain via claimTimeout after 1h",
      roundId: roundId.toString(),
    });
  }

  const inflightKey = `${chainId}:${roundId.toString()}`;
  if (!inFlightReveals.has(inflightKey)) {
    inFlightReveals.add(inflightKey);
    try {
      const w = gameResolverWalletFor(chainId);
      const hash = await w.writeContract({
        address,
        abi: GAME_ABI,
        functionName: "reveal",
        args: [roundId, entry.serverSeed],
      });
      console.log(`[game:${chainId}] submitted reveal tx ${hash} for round ${roundId}`);
    } catch (e) {
      console.error(`[game:${chainId}] reveal failed`, e);
      inFlightReveals.delete(inflightKey);
    }
  }

  return NextResponse.json({
    status: "revealing",
    roundId: roundId.toString(),
    chainId,
    player,
    betWei: betWei.toString(),
    txPlay: played.transactionHash,
  });
}
