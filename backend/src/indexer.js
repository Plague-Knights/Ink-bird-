import db from "./db.js";
import { publicClient, arcadeAddress, ARCADE_ABI } from "./chain.js";
import { getAddress, parseAbiItem } from "viem";

const CREDITS_PER_ENTRY = Number(process.env.CREDITS_PER_ENTRY || "100");
const EVENT = parseAbiItem(
  "event EntryPurchased(address indexed player, uint256 indexed weekId, uint256 credits, uint256 poolAmount, uint256 treasuryAmount)"
);

const upsertCredits = db.prepare(`
  INSERT INTO credits (player, remaining, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(player) DO UPDATE SET
    remaining = remaining + excluded.remaining,
    updated_at = excluded.updated_at
`);
const insertEntry = db.prepare(`
  INSERT OR IGNORE INTO entries (tx_hash, player, week_id, credits, block_number, observed_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const getCursor = db.prepare(`SELECT v FROM cursor WHERE k = 'entries_block'`);
const setCursor = db.prepare(`
  INSERT INTO cursor (k, v) VALUES ('entries_block', ?)
  ON CONFLICT(k) DO UPDATE SET v = excluded.v
`);

export async function indexEntriesLoop() {
  const client = publicClient();
  const addr = arcadeAddress();
  while (true) {
    try {
      const head = await client.getBlockNumber();
      const row = getCursor.get();
      const from = row ? BigInt(row.v) + 1n : head - 100n;
      if (from > head) {
        await sleep(5000);
        continue;
      }
      const logs = await client.getLogs({
        address: addr,
        event: EVENT,
        fromBlock: from,
        toBlock: head,
      });
      const tx = db.transaction((logs) => {
        for (const l of logs) {
          const player = getAddress(l.args.player);
          const weekId = Number(l.args.weekId);
          const credits = Number(l.args.credits) || CREDITS_PER_ENTRY;
          insertEntry.run(l.transactionHash, player, weekId, credits, Number(l.blockNumber), Date.now());
          upsertCredits.run(player, credits, Date.now());
        }
        setCursor.run(Number(head));
      });
      tx(logs);
      if (logs.length) console.log(`indexed ${logs.length} entries up to block ${head}`);
    } catch (e) {
      console.error("indexer error", e.message);
    }
    await sleep(5000);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
