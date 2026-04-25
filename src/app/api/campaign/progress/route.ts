// Campaign progress endpoint. Counts a player's on-chain `Played`
// events across every game contract we've ever deployed — legacy chests
// + cannon, and the new unified InkSquidGame. Mainnet and testnet are
// both scanned so a player's progress stays continuous across the
// migration.
//
// Uses the contract's indexed `player` topic so the RPC does the
// filtering. Block range is capped with CAMPAIGN_FROM_BLOCK_<chainId>
// env so we don't sweep from genesis on every call.

import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient, http, parseAbiItem, parseEther, isAddress,
  type AbiEvent, type Address, type Chain,
} from "viem";
import { ink, inkSepolia, soneium, soneiumMinato } from "@/config/chains";
import { chestsAddressForChain } from "@/lib/chestsContract";
import { cannonAddressForChain } from "@/lib/cannonContract";
import { gameAddressForChain } from "@/lib/gameContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Legacy Chests + Cannon emit the older 4-arg Played.
const PLAYED_LEGACY: AbiEvent = parseAbiItem(
  "event Played(uint256 indexed roundId, address indexed player, bytes32 seedHash, uint256 betWei)"
);
// Unified InkSquidGame emits a 5-arg Played with playerSeed mixed in.
const PLAYED_GAME: AbiEvent = parseAbiItem(
  "event Played(uint256 indexed roundId, address indexed player, bytes32 serverSeedHash, bytes32 playerSeed, uint256 betWei)"
);

// Every chain the player might have plays on — mainnets included so a
// mainnet launch lights up automatically the moment an address env is
// populated.
const SUPPORTED_CHAINS: Chain[] = [ink, soneium, inkSepolia, soneiumMinato];
const BLOCK_CHUNK = 10_000n;

function campaignStartBlock(chainId: number): bigint {
  const raw = process.env[`CAMPAIGN_FROM_BLOCK_${chainId}`];
  if (!raw) return 0n;
  try { return BigInt(raw); } catch { return 0n; }
}

function clientFor(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

type ContractKind = "chests" | "cannon" | "game";

type ContractSummary = {
  contract: ContractKind;
  address: Address;
  plays: number;
  qualifying: number;
  totalVolumeWei: string;
};

type ChainSummary = {
  chainId: number;
  chainName: string;
  plays: number;
  qualifying: number;
  contracts: ContractSummary[];
  error?: string;
};

async function countPlays(
  chain: Chain,
  address: Address,
  event: AbiEvent,
  player: Address,
  thresholdWei: bigint,
): Promise<{ plays: number; qualifying: number; totalVolumeWei: bigint }> {
  const client = clientFor(chain);
  const head = await client.getBlockNumber();
  const start = campaignStartBlock(chain.id);
  let from = start > head ? head : start;
  let plays = 0;
  let qualifying = 0;
  let totalVolumeWei = 0n;

  while (from <= head) {
    const to = from + BLOCK_CHUNK - 1n > head ? head : from + BLOCK_CHUNK - 1n;
    const logs = await client.getLogs({
      address,
      event,
      args: { player },
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      plays++;
      // Both event shapes expose betWei as the final uint256 arg.
      const bet = (log.args as { betWei?: bigint }).betWei ?? 0n;
      totalVolumeWei += bet;
      if (bet >= thresholdWei) qualifying++;
    }
    from = to + 1n;
  }

  return { plays, qualifying, totalVolumeWei };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const addressRaw = url.searchParams.get("address");
  if (!addressRaw || !isAddress(addressRaw)) {
    return NextResponse.json(
      { error: "address query param required (0x-prefixed 20-byte)" },
      { status: 400 },
    );
  }
  const player = addressRaw as Address;

  const thresholdEth = url.searchParams.get("threshold") ?? "0.001";
  let thresholdWei: bigint;
  try { thresholdWei = parseEther(thresholdEth); }
  catch { return NextResponse.json({ error: "bad threshold" }, { status: 400 }); }

  const targetRaw = Number(url.searchParams.get("target") ?? "5");
  const target = Number.isFinite(targetRaw)
    ? Math.max(1, Math.min(1000, Math.floor(targetRaw)))
    : 5;

  const byChain: ChainSummary[] = await Promise.all(SUPPORTED_CHAINS.map(async chain => {
    const contracts: ContractSummary[] = [];
    let chainError: string | undefined;
    const targets: Array<{ kind: ContractKind; address: Address | null; event: AbiEvent }> = [
      { kind: "chests", address: chestsAddressForChain(chain.id), event: PLAYED_LEGACY },
      { kind: "cannon", address: cannonAddressForChain(chain.id), event: PLAYED_LEGACY },
      { kind: "game",   address: gameAddressForChain(chain.id),   event: PLAYED_GAME   },
    ];
    for (const t of targets) {
      if (!t.address) continue;
      try {
        const counts = await countPlays(chain, t.address, t.event, player, thresholdWei);
        contracts.push({
          contract: t.kind,
          address: t.address,
          plays: counts.plays,
          qualifying: counts.qualifying,
          totalVolumeWei: counts.totalVolumeWei.toString(),
        });
      } catch (e) {
        chainError = (e as Error).message;
        contracts.push({
          contract: t.kind,
          address: t.address,
          plays: 0,
          qualifying: 0,
          totalVolumeWei: "0",
        });
        console.error(`[campaign] scan failed ${chain.name}:${t.kind}`, e);
      }
    }
    return {
      chainId: chain.id,
      chainName: chain.name,
      plays: contracts.reduce((a, c) => a + c.plays, 0),
      qualifying: contracts.reduce((a, c) => a + c.qualifying, 0),
      contracts,
      ...(chainError ? { error: chainError } : {}),
    };
  }));

  const totalPlays = byChain.reduce((a, c) => a + c.plays, 0);
  const qualifyingPlays = byChain.reduce((a, c) => a + c.qualifying, 0);

  return NextResponse.json({
    address: player,
    thresholdWei: thresholdWei.toString(),
    thresholdEth,
    target,
    totalPlays,
    qualifyingPlays,
    complete: qualifyingPlays >= target,
    byChain,
  });
}
