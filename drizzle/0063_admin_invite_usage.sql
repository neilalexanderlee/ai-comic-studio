-- 平台统一 Key 的第一阶段基础设施：管理员概念 + 注册准入 + 平台 Key 用量归属。
--
-- 三层防线各占一部分（见 CLAUDE.md 约定 8p）：
--  · 准入 → invite_codes（谁能拿到账号）
--  · 撤销 → users.status（已有账号怎么立刻切断）
--  · 止损 → usage_records.key_source（哪些请求烧的是平台的钱，据此限额与限并发）
--
-- 全部是 ADD COLUMN / CREATE TABLE，没有 rename-copy-drop（0042/0043 就是那么静默失败的）。
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS invite_codes (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  note        TEXT,
  created_by  TEXT NOT NULL,
  max_uses    INTEGER NOT NULL DEFAULT 1,
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
-- 谁用了哪个码：以后要按渠道追踪来源、或者顺着一个码把它带进来的人全停掉，都靠这张表
CREATE TABLE IF NOT EXISTS invite_code_uses (
  id        TEXT PRIMARY KEY,
  code_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  used_at   INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invite_code_uses_code_idx ON invite_code_uses(code_id);
--> statement-breakpoint
-- 'user' = 用户自带 Key（BYOK，不该被平台限额约束）；'platform' = 烧的是平台的钱
ALTER TABLE usage_records ADD COLUMN key_source TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_records_key_source_created_idx
  ON usage_records(key_source, created_at);
