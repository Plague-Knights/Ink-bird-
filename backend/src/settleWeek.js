import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { distribute } from "./payout.js";
import { buildTree, leafOf, root, proofFor } from "./merkle.js";
import { publicClient, operatorClient, arcadeAddress, ARCADE_ABI } from "./chain.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const weekArg = process.argv[2];
  if (!weekArg) throw new Error("usage: npm run settle -- <weekId>");
  const weekId = Number(weekArg);
  const client = publicClient();
  const cur = Number(await client.readContract({
    address: arcadeAddress(), abi: ARCADE_ABI, functionName: "currentWeekId",
  }));
  if (weekId >= cur) throw new Error(`week ${weekId} not over (current: ${cur})`);

  const pool = await client.readContract({
    address: arcadeAddress(), abi: ARCADE_ABI, functionName: "weekPool", args: [BigInt(weekId)],
  });
  if (pool === 0n) { console.log("empty pool; nothing to settle"); return; }

  const rows = db.prepare(`
    SELECT player, MAX(score) AS score
    FROM runs WHERE week_id = ?
    GROUP BY player
    ORDER BY score DESC, MIN(submitted_at) ASC
    LIMIT 100
  `).all(weekId);
  if (!rows.length) { console.log("no runs recorded for week"); return; }

  const { rewards, assigned } = distribute(pool, rows);
  if (!rewards.length) { console.log("no rewards to distribute"); return; }

  const leaves = rewards.map((r) => leafOf(r.player, r.amount));
  const tree = buildTree(leaves);
  const r = root(tree);

  // Write the manifest so players can look up their proof for claim().
  const manifest = {
    weekId,
    pool: pool.toString(),
    totalPayout: assigned.toString(),
    root: r,
    rewards: rewards.map((rw, i) => ({
      rank: i + 1,
      player: rw.player,
      amount: rw.amount.toString(),
      proof: proofFor(tree, i),
    })),
  };
  const out = path.join(here, "..", `week-${weekId}.json`);
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`manifest written: ${out}`);
  console.log(`root: ${r}`);
  console.log(`total payout: ${assigned.toString()} wei`);

  // Submit to the contract.
  const wallet = operatorClient();
  const hash = await wallet.writeContract({
    address: arcadeAddress(),
    abi: ARCADE_ABI,
    functionName: "settleWeek",
    args: [BigInt(weekId), r, assigned],
  });
  console.log(`settleWeek tx: ${hash}`);
  const rcpt = await client.waitForTransactionReceipt({ hash });
  console.log(`mined in block ${rcpt.blockNumber} (status: ${rcpt.status})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
