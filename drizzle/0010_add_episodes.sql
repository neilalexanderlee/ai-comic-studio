-- 1. Create episodes table
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  idea TEXT DEFAULT '',
  script TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  generation_mode TEXT NOT NULL DEFAULT 'keyframe',
  final_video_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
-- 2. Insert default episode for each existing project
INSERT INTO episodes (id, project_id, title, sequence, idea, script, status, generation_mode, final_video_url, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  p.id,
  '第1集',
  1,
  COALESCE(p.idea, ''),
  COALESCE(p.script, ''),
  p.status,
  p.generation_mode,
  p.final_video_url,
  p.created_at,
  CAST(strftime('%s', 'now') AS INTEGER)
FROM projects p;
--> statement-breakpoint
-- 3. Add episode_id to shots and backfill
ALTER TABLE shots ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE shots SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = shots.project_id LIMIT 1
) WHERE episode_id IS NULL;
--> statement-breakpoint
-- 4. Add scope and episode_id to characters
ALTER TABLE characters ADD COLUMN scope TEXT NOT NULL DEFAULT 'main' CHECK (scope IN ('main', 'guest'));
--> statement-breakpoint
ALTER TABLE characters ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
--> statement-breakpoint
-- 5. Add episode_id to storyboard_versions and backfill
ALTER TABLE storyboard_versions ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE storyboard_versions SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = storyboard_versions.project_id LIMIT 1
) WHERE episode_id IS NULL;
--> statement-breakpoint
-- 6. Add episode_id to tasks and backfill
ALTER TABLE tasks ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE tasks SET episode_id = (
  SELECT e.id FROM episodes e WHERE e.project_id = tasks.project_id LIMIT 1
) WHERE episode_id IS NULL;
