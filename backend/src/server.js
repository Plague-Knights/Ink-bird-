import "dotenv/config";
import express from "express";
import cors from "cors";
import { getAddress, isAddress, verifyMessage } from "viem";
import db from "./db.js";
import { issueSession, verifyToken, consumeSession } from "./sessions.js";
import { validateRun } from "./scoreValidator.js";
import { indexEntriesLoop } from "./indexer.js";
import { publicClient, arcadeAddress, ARCADE_ABI } from "./chain.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Kick off the on-chain indexer.
indexEntriesLoop().catch((e) => console.error("indexer crashed", e));

// Current week from the contract.
async function currentWeek() {
  const client = publicClient();
  const wk = await client.readContract({
    address: arcadeAddress(),
    abi: ARCADE_ABI,
    functionName: "currentWeekId",
  });
  return Number(wk);
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Credits for a player.
app.get("/api/credits/:player", (req, res) => {
  if (!isAddress(req.params.player)) return res.status(400).json({ error: "bad address" });
  const addr = getAddress(req.params.player);
  const row = db.prepare(`SELECT remaining FROM credits WHERE player = ?`).get(addr);
  res.json({ player: addr, remaining: row?.remaining ?? 0 });
});

// Issue a play session. Player signs a nonce to prove wallet ownership.
app.post("/api/session", async (req, res) => {
  try {
    const { player, signature, message } = req.body || {};
    if (!isAddress(player)) return res.status(400).json({ error: "bad address" });
    const addr = getAddress(player);
    if (typeof message !== "string" || !message.includes("Ink Bird Arcade")) {
      return res.status(400).json({ error: "bad message" });
    }
    const ok = await verifyMessage({ address: addr, message, signature });
    if (!ok) return res.status(401).json({ error: "bad signature" });

    const row = db.prepare(`SELECT remaining FROM credits WHERE player = ?`).get(addr);
    if (!row || row.remaining <= 0) return res.status(402).json({ error: "no credits" });

    // Decrement one credit per session issuance.
    db.prepare(`UPDATE credits SET remaining = remaining - 1, updated_at = ? WHERE player = ?`)
      .run(Date.now(), addr);

    const session = issueSession(addr);
    res.json({ sessionId: session.sessionId, seed: session.seed, token: session.token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Submit a finished run's score for the current week.
app.post("/api/submit", async (req, res) => {
  try {
    const { player, token, score, inputs, inputsHash } = req.body || {};
    if (!isAddress(player)) return res.status(400).json({ error: "bad address" });
    const addr = getAddress(player);
    const session = verifyToken(token, addr);
    if (!session) return res.status(401).json({ error: "bad token" });
    if (session.consumed_at) return res.status(409).json({ error: "session spent" });

    const check = validateRun({ session, score, inputs, inputsHash });
    if (!check.ok) return res.status(400).json({ error: check.reason });

    const weekId = await currentWeek();
    db.prepare(
      `INSERT INTO runs (session_id, player, week_id, score, inputs_hash, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(session.id, addr, weekId, score, inputsHash, Date.now());
    consumeSession(session.id);
    res.json({ ok: true, weekId, score });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Public leaderboard for the current (or specified) week.
app.get("/api/leaderboard", async (req, res) => {
  try {
    const weekId = req.query.week != null ? Number(req.query.week) : await currentWeek();
    const rows = db.prepare(`
      SELECT player, MAX(score) AS score
      FROM runs WHERE week_id = ?
      GROUP BY player
      ORDER BY score DESC, MIN(submitted_at) ASC
      LIMIT 100
    `).all(weekId);
    res.json({ weekId, entries: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`inkbird backend listening on :${port}`));
