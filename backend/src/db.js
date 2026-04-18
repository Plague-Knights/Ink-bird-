import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(here, "..", "data.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS credits (
    player TEXT PRIMARY KEY,
    remaining INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    tx_hash TEXT PRIMARY KEY,
    player TEXT NOT NULL,
    week_id INTEGER NOT NULL,
    credits INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    observed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    player TEXT NOT NULL,
    seed TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    consumed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    player TEXT NOT NULL,
    week_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    inputs_hash TEXT NOT NULL,
    submitted_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_week_player_score
    ON runs(week_id, player, score DESC);

  CREATE TABLE IF NOT EXISTS cursor (
    k TEXT PRIMARY KEY,
    v INTEGER NOT NULL
  );
`);

export default db;
