-- 计费 / 积分底座（S3 一期：账本与闸门；支付相关表待商户号到位后再加）
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id     TEXT PRIMARY KEY,
  balance     INTEGER NOT NULL DEFAULT 0,
  frozen      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, created_at);

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
);
CREATE INDEX IF NOT EXISTS idx_usage_records_user ON usage_records(user_id, created_at);
