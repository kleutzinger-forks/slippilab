CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  played_on TEXT,
  num_frames INTEGER,
  stage_id INTEGER,
  is_teams BOOLEAN DEFAULT FALSE,
  players JSONB
);

CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at DESC);
