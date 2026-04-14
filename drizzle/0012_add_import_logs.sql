CREATE TABLE IF NOT EXISTS import_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  message TEXT NOT NULL DEFAULT '',
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
