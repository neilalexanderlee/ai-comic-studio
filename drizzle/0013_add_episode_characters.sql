CREATE TABLE IF NOT EXISTS episode_characters (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  UNIQUE(episode_id, character_id)
);
