ALTER TABLE tasks ADD COLUMN dedup_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX tasks_dedup_key_unique ON tasks (dedup_key);
