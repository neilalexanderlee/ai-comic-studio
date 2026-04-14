CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt_key TEXT NOT NULL,
  slot_key TEXT,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_templates_unique
  ON prompt_templates(user_id, prompt_key, COALESCE(slot_key, ''), scope, COALESCE(project_id, ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompt_templates_user_scope
  ON prompt_templates(user_id, scope);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompt_versions_template
  ON prompt_versions(template_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT,
  prompt_key TEXT NOT NULL,
  slots TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompt_presets_user
  ON prompt_presets(user_id);
