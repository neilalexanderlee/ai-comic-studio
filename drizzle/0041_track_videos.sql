CREATE TABLE IF NOT EXISTS track_videos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
  version_id TEXT,
  track_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  total_duration INTEGER,
  shot_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
