import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data/slippilab.db");

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

export interface UploadBatch {
  id: string;
  created_at: string;
  note: string | null;
}

export interface ReplayRecord {
  id: string;
  file_name: string;
  created_at: string;
  played_on: string | null;
  num_frames: number | null;
  external_stage_id: number | null;
  is_teams: number;
  players: any;
  batch_id: string | null;
  batch_order: number | null;
  file_hash: string | null;
}

export function getAllReplays(): ReplayRecord[] {
  return db
    .prepare("SELECT * FROM replays ORDER BY created_at DESC")
    .all() as ReplayRecord[];
}

export function getReplayByFileName(fileName: string): ReplayRecord | undefined {
  return db
    .prepare("SELECT * FROM replays WHERE file_name = ?")
    .get(fileName) as ReplayRecord | undefined;
}

export function getReplayByHash(hash: string): ReplayRecord | undefined {
  return db
    .prepare("SELECT * FROM replays WHERE file_hash = ?")
    .get(hash) as ReplayRecord | undefined;
}

export function updateReplayBatch(id: string, batchId: string, batchOrder: number): void {
  db.prepare("UPDATE replays SET batch_id = ?, batch_order = ? WHERE id = ?")
    .run(batchId, batchOrder, id);
}

export function getBatchReplays(batchId: string): ReplayRecord[] {
  return db
    .prepare("SELECT * FROM replays WHERE batch_id = ? ORDER BY batch_order ASC")
    .all(batchId) as ReplayRecord[];
}

export function insertBatch(id: string, note: string | null): void {
  db.prepare(
    `INSERT INTO upload_batches (id, created_at, note) VALUES (?, datetime('now'), ?)`
  ).run(id, note);
}

export function insertReplay(replay: {
  id: string;
  file_name: string;
  played_on: string | null;
  num_frames: number;
  external_stage_id: number;
  is_teams: boolean;
  players: any;
  batch_id: string | null;
  batch_order: number | null;
  file_hash: string;
}): void {
  db.prepare(
    `INSERT INTO replays (id, file_name, created_at, played_on, num_frames, external_stage_id, is_teams, players, batch_id, batch_order, file_hash)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    replay.id,
    replay.file_name,
    replay.played_on,
    replay.num_frames,
    replay.external_stage_id,
    replay.is_teams ? 1 : 0,
    JSON.stringify(replay.players),
    replay.batch_id,
    replay.batch_order,
    replay.file_hash
  );
}

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_batches (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      played_on TEXT,
      num_frames INTEGER,
      external_stage_id INTEGER,
      is_teams INTEGER DEFAULT 0,
      players TEXT,
      batch_id TEXT REFERENCES upload_batches(id),
      batch_order INTEGER,
      file_hash TEXT UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_replays_batch_id ON replays(batch_id, batch_order);
  `);

  // Add new columns to existing DBs that predate this migration
  for (const sql of [
    "ALTER TABLE replays ADD COLUMN batch_id TEXT",
    "ALTER TABLE replays ADD COLUMN batch_order INTEGER",
    "ALTER TABLE replays ADD COLUMN file_hash TEXT UNIQUE",
  ]) {
    try { db.exec(sql); } catch {}
  }
}
