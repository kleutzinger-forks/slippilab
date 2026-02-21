import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "";

export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export interface ReplayRecord {
  id: string;
  file_name: string;
  created_at: Date;
  played_on: string | null;
  num_frames: number | null;
  stage_id: number | null;
  is_teams: boolean;
  players: any;
}

export async function getAllReplays(): Promise<ReplayRecord[]> {
  const rows = await sql<ReplayRecord[]>`SELECT * FROM replays ORDER BY created_at DESC`;
  return rows;
}

export async function getReplayById(
  id: string
): Promise<ReplayRecord | undefined> {
  const rows = await sql<ReplayRecord[]>`SELECT * FROM replays WHERE id = ${id}`;
  return rows[0];
}

export async function insertReplay(replay: {
  id: string;
  file_name: string;
  played_on: string | null;
  num_frames: number;
  stage_id: number;
  is_teams: boolean;
  players: any;
}): Promise<void> {
  await sql`
    INSERT INTO replays (id, file_name, created_at, played_on, num_frames, stage_id, is_teams, players)
    VALUES (
      ${replay.id},
      ${replay.file_name},
      NOW(),
      ${replay.played_on},
      ${replay.num_frames},
      ${replay.stage_id},
      ${replay.is_teams},
      ${JSON.stringify(replay.players)}
    )
  `;
}

export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      played_on TEXT,
      num_frames INTEGER,
      stage_id INTEGER,
      is_teams BOOLEAN DEFAULT FALSE,
      players JSONB
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at DESC)
  `;
}
