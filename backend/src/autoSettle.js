import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { distribute } from "./payout.js";
import { buildTree, leafOf, root, proofFor } from "./merkle.js";
import { publicClient, operatorClient, arcadeAddress, ARCADE_ABI } from "./chain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = path.join(here, "..", "manifests");
fs.mkdirSync(MANIFEST_DIR, { recursive: true });

async function onchainCurrentWeek() {
  const client = publicClient();
  return Number(await client.readContract({
    address: arcadeAddress(), abi: ARCADE_ABI, functionName: "currentWeekId",
  }));
}

async function isAlreadySettled(weekId) {
  const client = publicClient();
  const settledAt = await client.readContract({
    address: arcadeAddress(), abi: ARCADE_ABI, functionName: "weekSettledAt", args: [BigInt(weekId)],
  });
  return settledAt > 0n;
}

export async function settleWeekOnce(weekId) {
  const client = publicClient();
  const pool = await client.readContract({
    address: arcadeAddress(), abi: ARCADE_ABI, functionName: "weekPool", args: [BigInt(weekId)],
  });
  if (pool === 0n) {
    console.log(`[autoSettle] week ${weekId}: empty pool, skipping`);
    return { skipped: true, reason: "empty-pool" };
  }

  const rows = db.prepare(`
    SELECT player, MAX(score) AS score
    FROM runs WHERE week_id = ?
    GROUP BY player
    ORDER BY score DESC, MIN(submitted_at) ASC
    LIMIT 100
  `).all(weekId);
  if (!rows.length) {
    console.log(`[autoSettle] week ${weekId}: no runs; rolls into next week on next entry`);
    return { skipped: true, reason: "no-runs" };
  }

  const { rewards, assigned } = distribute(pool, rows);
  if (!rewards.length) return { skipped: true, reason: "no-rewards" };

  const leaves = rewards.map((r) => leafOf(r.player, r.amount));
  const tree = buildTree(leaves);
  const r = root(tree);

  const manifest = {
    weekId,
    pool: pool.toString(),
    totalPayout: assigned.toString(),
    root: r,
    generatedAt: new Date().toISOString(),
    rewards: rewards.map((rw, i) => ({
      rank: i + 1,
      player: rw.player,
      amount: rw.amount.toString(),
      proof: proofFor(tree, i),
    })),
  };
  const out = path.join(MANIFEST_DIR, `week-${weekId}.json`);
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`[autoSettle] week ${weekId}: manifest written`);

  const wallet = operatorClient();
  const hash = await wallet.writeContract({
    address: arcadeAddress(),
    abi: ARCADE_ABI,
    functionName: "settleWeek",
    args: [BigInt(weekId), r, assigned],
  });
  console.log(`[autoSettle] week ${weekId}: settleWeek tx ${hash}`);
  const rcpt = await client.waitForTransactionReceipt({ hash });
  console.log(`[autoSettle] week ${weekId}: mined in block ${rcpt.blockNumber}`);
  return { ok: true, txHash: hash, weekId, root: r, total: assigned.toString() };
}

/// Poll for finished-but-unsettled weeks every 10 minutes. Settle at most one
/// per tick. Safe to run alongside a manual settleWeek.js invocation.
export function startAutoSettleLoop() {
  const tick = async () => {
    try {
      const cur = await onchainCurrentWeek();
      for (let wk = cur - 1; wk >= 0 && wk >= cur - 4; wk--) {
        if (!(await isAlreadySettled(wk))) {
          console.log(`[autoSettle] attempting settlement for week ${wk}`);
          await settleWeekOnce(wk);
          break;
        }
      }
    } catch (e) {
      console.error("[autoSettle] tick error", e.message);
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 10 * 60 * 1000);
}

export function getManifest(weekId) {
  const p = path.join(MANIFEST_DIR, `week-${weekId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
