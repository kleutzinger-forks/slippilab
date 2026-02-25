import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "data/slippilab.db");

export const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

export interface SetRecord {
  id: string;
  created_at: string;
  name: string | null;
}

export interface SetRecordWithReplays extends SetRecord {
  replays: ReplayRecord[];
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

export function getSetReplays(setId: string): ReplayRecord[] {
  return db
    .prepare("SELECT * FROM replays WHERE batch_id = ? ORDER BY batch_order ASC")
    .all(setId) as ReplayRecord[];
}

export function insertSet(id: string, name: string | null): void {
  db.prepare(
    `INSERT INTO sets (id, created_at, name) VALUES (?, datetime('now'), ?)`
  ).run(id, name);
}

export function getAllSetsWithReplays(): SetRecordWithReplays[] {
  // Order sets by the earliest game's played_on timestamp, falling back to created_at
  const sets = db.prepare(`
    SELECT s.*
    FROM sets s
    LEFT JOIN replays r ON r.batch_id = s.id AND r.played_on IS NOT NULL
    GROUP BY s.id
    ORDER BY COALESCE(MIN(r.played_on), s.created_at) DESC
  `).all() as SetRecord[];
  return sets.map((set) => ({
    ...set,
    replays: db.prepare(
      "SELECT * FROM replays WHERE batch_id = ? ORDER BY batch_order ASC"
    ).all(set.id) as ReplayRecord[],
  }));
}

export function renameSet(id: string, name: string): void {
  db.prepare("UPDATE sets SET name = ? WHERE id = ?").run(name, id);
}

export function clearAllData(): { replays: number; sets: number } {
  const replays = (db.prepare("DELETE FROM replays").run()).changes;
  const sets = (db.prepare("DELETE FROM sets").run()).changes;
  return { replays, sets };
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
    CREATE TABLE IF NOT EXISTS sets (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      name TEXT
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
      batch_id TEXT REFERENCES sets(id),
      batch_order INTEGER,
      file_hash TEXT UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_replays_batch_id ON replays(batch_id, batch_order);
  `);

  // Add new columns / rename tables for existing DBs
  for (const sql of [
    "ALTER TABLE replays ADD COLUMN batch_id TEXT",
    "ALTER TABLE replays ADD COLUMN batch_order INTEGER",
    "ALTER TABLE replays ADD COLUMN file_hash TEXT UNIQUE",
    "ALTER TABLE upload_batches RENAME TO sets",
    "ALTER TABLE sets RENAME COLUMN note TO name",
  ]) {
    try { db.exec(sql); } catch {}
  }
}
