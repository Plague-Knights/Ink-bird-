import crypto from "node:crypto";
import db from "./db.js";

const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s === "change-me-to-something-random") {
    throw new Error("SESSION_SECRET not set to a strong value");
  }
  return s;
};

function sign(payload) {
  return crypto.createHmac("sha256", SECRET()).update(payload).digest("hex");
}

export function issueSession(player) {
  const id = crypto.randomUUID();
  const seed = crypto.randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, player, seed, issued_at) VALUES (?, ?, ?, ?)`
  ).run(id, player, seed, issuedAt);
  const token = `${id}.${issuedAt}.${sign(`${id}.${player}.${issuedAt}`)}`;
  return { sessionId: id, seed, token, issuedAt };
}

export function verifyToken(token, expectedPlayer) {
  const parts = (token || "").split(".");
  if (parts.length !== 3) return null;
  const [id, issuedAt, sig] = parts;
  const expected = sign(`${id}.${expectedPlayer}.${issuedAt}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  const row = db.prepare(`SELECT id, player, seed, issued_at, consumed_at FROM sessions WHERE id = ?`).get(id);
  if (!row || row.player.toLowerCase() !== expectedPlayer.toLowerCase()) return null;
  return row;
}

export function consumeSession(id) {
  db.prepare(`UPDATE sessions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`).run(Date.now(), id);
}
