-- 基线 schema —— **不是普通迁移，不在 _journal.json 里**。
--
-- 为什么需要它：本项目早期用 `drizzle-kit push` 直接改库，没留下对应的迁移文件。
-- 于是 `character_assets` 整张表、`shots.first_frame_remote_url` / `scene_title` 等列
-- 都是"只被后来的迁移重命名/删除过，却从没被任何迁移创建过"。
-- 结果是：**现有库能用，只是因为它从没被从零建过**；任何全新安装（Docker、
-- 自部署、CI）跑到 0017 就会撞上 `no such table: character_assets`，7 个迁移连环失败。
--
-- 这份 DDL 直接导出自一个健康的生产库，因此天然与 schema.ts 一致。
-- 空库启动时先整体应用它，再把 baseline/meta.json 里 throughTag 及之前的迁移
-- 标记为已应用；之后的迁移照常增量执行。已有库完全不走这条路径。
--
-- 重新生成：pnpm baseline:dump

CREATE TABLE IF NOT EXISTS ark_asset_library_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  access_key_id TEXT NOT NULL DEFAULT '',
  secret_access_key TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT 'default',
  region TEXT NOT NULL DEFAULT 'cn-beijing',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "character_assets" (
  id           TEXT    NOT NULL PRIMARY KEY,
  character_id TEXT    NOT NULL,
  image_path   TEXT,
  tag          TEXT    NOT NULL DEFAULT '日常',
  is_default   INTEGER NOT NULL DEFAULT 0,
  asset_type   TEXT    NOT NULL DEFAULT 'morph',
  created_at   INTEGER NOT NULL
, `audio_path` text, angle TEXT, source_asset_id TEXT, ark_asset_id TEXT, ark_asset_status TEXT NOT NULL DEFAULT 'none', ark_asset_registered_at INTEGER);

CREATE TABLE IF NOT EXISTS `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`visual_hint` text DEFAULT '',
	`reference_image` text,
	`scope` text DEFAULT 'main' NOT NULL,
	`episode_id` text, `beauty_image` text, `combat_image` text, `voice_hint` text DEFAULT '', ark_asset_group_id TEXT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id     TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  frozen      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
, subscription_balance INTEGER NOT NULL DEFAULT 0, subscription_expires_at INTEGER);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  note          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `episode_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`episode_id` text NOT NULL,
	`character_id` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`sequence` integer NOT NULL,
	`idea` text DEFAULT '',
	`script` text DEFAULT '',
	`status` text DEFAULT 'draft' NOT NULL,
	`description` text DEFAULT '',
	`keywords` text DEFAULT '',
	`final_video_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, target_duration_seconds INTEGER, `editor_state` text, `previz_scene` TEXT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `import_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`step` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL,
  plan_code        TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,
  credits_granted  INTEGER NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'mock',
  status           TEXT NOT NULL DEFAULT 'pending',
  out_trade_no     TEXT NOT NULL UNIQUE,
  channel_trade_no TEXT,
  expires_at       INTEGER NOT NULL,
  paid_at          INTEGER,
  raw_callback     TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`idea` text DEFAULT '',
	`script` text DEFAULT '',
	`status` text DEFAULT 'draft' NOT NULL,
	`final_video_url` text,
	`use_project_prompts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, visual_style TEXT NOT NULL DEFAULT 'anime_2d', video_ratio TEXT NOT NULL DEFAULT '16:9');

CREATE TABLE IF NOT EXISTS `prompt_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text,
	`prompt_key` text NOT NULL,
	`slots` text NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt_key` text NOT NULL,
	`slot_key` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `prompt_templates`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `provider_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`secret_key` text,
	`updated_at` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `shot_previz` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`video_url` text NOT NULL,
	`poster_url` text,
	`prompt` text,
	`model_id` text,
	`duration` integer,
	`resolution` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shot_id`) REFERENCES `shots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS shot_video_history (
  id          TEXT PRIMARY KEY,
  shot_id     TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  video_url   TEXT NOT NULL,
  resolution  TEXT,                    -- "480p" | "720p" | null
  label       TEXT,                    -- "生成" | "增强↑720p" | "手动" 等
  created_at  INTEGER NOT NULL         -- Unix timestamp (ms)
);

CREATE TABLE IF NOT EXISTS `shots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`prompt` text DEFAULT '',
	`start_frame_desc` text,
	`end_frame_desc` text,
	`motion_script` text,
	`camera_direction` text DEFAULT 'static',
	`duration` integer DEFAULT 10 NOT NULL,
	"anchor_first" text,
	"anchor_last_ai" text,
	`video_url` text,
	`video_prompt` text,
	`episode_id` text,
	`version_id` text,
	`status` text DEFAULT 'pending' NOT NULL, warnings text, video_resolution TEXT, `remote_video_url` text, `remote_video_task_id` text, `remote_video_status` text, `remote_video_created_at` integer, `remote_video_expires_at` integer, `remote_video_last_download_at` integer, "cut_point" text, "anchor_first_remote_url" TEXT, "anchor_last_ai_remote_url" TEXT, bgm_note TEXT, sound_effect_note TEXT, `chain_source_shot_id` text, `chain_source_type` text, `video_prompt_frame_fingerprint` text, `track` text, prop_refs TEXT, anchor_first_continuity_mode TEXT, preview_url TEXT, poster_url TEXT, `previz_selected_id` TEXT, `previz_blocking` TEXT, `previz_layout_url` TEXT,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `storyboard_versions`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `storyboard_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`version_num` integer NOT NULL,
	`created_at` integer NOT NULL,
	`episode_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE,
  plan_code     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  period_start  INTEGER NOT NULL,
  period_end    INTEGER NOT NULL,
  auto_renew    INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`result` text,
	`error` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 3 NOT NULL,
	`created_at` integer NOT NULL,
	`scheduled_at` integer,
	`episode_id` text, progress TEXT, started_at INTEGER,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE IF NOT EXISTS usage_records (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  project_id       TEXT,
  shot_id          TEXT,
  kind             TEXT NOT NULL,
  protocol         TEXT,
  model_id         TEXT,
  params           TEXT,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_charged  INTEGER NOT NULL DEFAULT 0,
  upstream_usage   INTEGER,
  status           TEXT NOT NULL DEFAULT 'reserved',
  created_at       INTEGER NOT NULL
, reserved_from_subscription INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS user_client_prefs (
      user_id TEXT PRIMARY KEY NOT NULL,
      model_store_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `username` text NOT NULL UNIQUE,
  `password_hash` text NOT NULL,
  `created_at` integer NOT NULL
, token_version INTEGER NOT NULL DEFAULT 0);

CREATE UNIQUE INDEX IF NOT EXISTS ark_asset_library_credentials_user_idx
  ON ark_asset_library_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_svh_shot_id ON shot_video_history(shot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_records_user ON usage_records(user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS orders_channel_trade_uq ON orders(channel, channel_trade_no);

CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS provider_secrets_user_provider_idx
    ON provider_secrets(user_id, provider_id);

CREATE INDEX IF NOT EXISTS `shot_previz_shot_id_idx` ON `shot_previz` (`shot_id`);
