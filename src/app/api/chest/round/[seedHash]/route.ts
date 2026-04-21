import { NextRequest, NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { CHESTS_ABI } from "@/lib/chestsContract";
import { publicClientFor, resolverWalletFor, contractAddressFor } from "@/lib/chestsServer";
import { recallSeed, forgetSeed } from "@/lib/chestRounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLAYED_EVENT = parseAbiItem(
  "event Played(uint256 indexed roundId, address indexed player, bytes32 seedHash, uint256 betWei)"
);
const RESOLVED_EVENT = parseAbiItem(
  "event Resolved(uint256 indexed roundId, address indexed player, uint256 betWei, uint16 multiplierThousandths, uint256 payoutWei)"
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

  // Which chain did this round live on? Priority:
  //   1. ?chain=<id> query param from client
  //   2. chainId recorded when the seed was issued
  //   3. (fallback) Ink Sepolia = 763373
  const url = new URL(req.url);
  const entry = recallSeed(seedHash);
  const chainId = Number(url.searchParams.get("chain") ?? entry?.chainId ?? 763373);

  let address: `0x${string}`;
  try { address = contractAddressFor(chainId); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const client = publicClientFor(chainId);
  const head = await client.getBlockNumber();
  const fromBlock = head > 1000n ? head - 1000n : 0n;

  const playedLogs = await client.getLogs({
    address,
    event: PLAYED_EVENT,
    fromBlock,
    toBlock: head,
  });
  const targetHash = seedHash.toLowerCase();
  const played = playedLogs.find(l => (l.args.seedHash ?? "").toString().toLowerCase() === targetHash);

  if (!played) {
    return NextResponse.json({ status: "waiting", phase: "awaiting_play" });
  }

  const roundId = played.args.roundId!;
  const player  = played.args.player!;
  const betWei  = played.args.betWei!;

  const resolvedLogs = await client.getLogs({
    address,
    event: RESOLVED_EVENT,
    args: { roundId },
    fromBlock,
    toBlock: head,
  });

  if (resolvedLogs.length > 0) {
    const r = resolvedLogs[0]!;
    forgetSeed(seedHash);
    return NextResponse.json({
      status: "resolved",
      roundId: roundId.toString(),
      chainId,
      player,
      betWei: betWei.toString(),
      payoutWei: (r.args.payoutWei ?? 0n).toString(),
      multiplierThousandths: r.args.multiplierThousandths ?? 0,
      txReveal: r.transactionHash,
    });
  }

  if (!entry) {
    return NextResponse.json({
      status: "stuck",
      reason: "seed pre-image lost server-side; player can't be auto-resolved",
      roundId: roundId.toString(),
    });
  }

  const inflightKey = `${chainId}:${roundId.toString()}`;
  if (!inFlightReveals.has(inflightKey)) {
    inFlightReveals.add(inflightKey);
    try {
      const w = resolverWalletFor(chainId);
      const hash = await w.writeContract({
        address,
        abi: CHESTS_ABI,
        functionName: "reveal",
        args: [roundId, entry.seed],
      });
      console.log(`[chest:${chainId}] submitted reveal tx ${hash} for round ${roundId}`);
    } catch (e) {
      console.error(`[chest:${chainId}] reveal failed`, e);
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
