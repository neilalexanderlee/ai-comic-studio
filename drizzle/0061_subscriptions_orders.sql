-- 订阅 / 套餐 / 积分充值。
--
-- 设计要点（详见 src/lib/billing/plans.ts 与 schema.ts 的注释）：
--  · 套餐定义是**代码常量**，不建 plans 表；可审计性由订单快照（plan_code + 金额 + 积分）保证
--  · 订阅积分**周期末清零**，加油包积分**永不过期** —— 两种寿命，所以 credit_accounts 拆双余额
--  · 订单回调幂等靠 UNIQUE(channel, channel_trade_no) 在数据库层兜底
--
-- 全部是 CREATE / ADD COLUMN，没有 rename-copy-drop（0042/0043 就是那么静默失败的）。
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
--> statement-breakpoint
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
--> statement-breakpoint
-- 回调幂等的硬保证。SQLite 里多行 NULL 不互相冲突，所以未支付订单（channel_trade_no 为空）
-- 不会互相挡住，而同一笔渠道流水只能入账一次。
CREATE UNIQUE INDEX IF NOT EXISTS orders_channel_trade_uq ON orders(channel, channel_trade_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at);
--> statement-breakpoint
ALTER TABLE credit_accounts ADD COLUMN subscription_balance INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE credit_accounts ADD COLUMN subscription_expires_at INTEGER;
--> statement-breakpoint
-- 每次预扣里有多少来自"会过期的订阅余额"。退还必须按这个拆分原路退回，
-- 否则可以套利：用订阅积分预扣→取消→退进永久桶，把会过期的洗成永久的。
ALTER TABLE usage_records ADD COLUMN reserved_from_subscription INTEGER NOT NULL DEFAULT 0;
