CREATE TABLE storyboard_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  version_num INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN version_id TEXT REFERENCES storyboard_versions(id) ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO storyboard_versions (id, project_id, label, version_num, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  p.id AS project_id,
  strftime('%Y%m%d', datetime(p.created_at, 'unixepoch')) || '-V1' AS label,
  1 AS version_num,
  p.created_at AS created_at
FROM projects p
WHERE EXISTS (SELECT 1 FROM shots s WHERE s.project_id = p.id);
--> statement-breakpoint
UPDATE shots
SET version_id = (
  SELECT sv.id FROM storyboard_versions sv
  WHERE sv.project_id = shots.project_id AND sv.version_num = 1
)
WHERE version_id IS NULL;
