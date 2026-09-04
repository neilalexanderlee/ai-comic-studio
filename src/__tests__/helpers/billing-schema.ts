/**
 * 计费相关表的建表语句，供跑在**真实 SQLite** 上的计费测试共用。
 *
 * 为什么不用 drizzle schema 直接建：这些测试要覆盖的正确性全在 SQL 里
 * （条件扣减、事务边界、UNIQUE 约束），用最贴近真库的裸 DDL 最直接。
 * 抽成共享文件是因为已经有第二个测试文件要用同一套表 —— 两份副本必然漂移。
 */
export const BILLING_DDL = `
CREATE TABLE credit_accounts (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  frozen INTEGER NOT NULL DEFAULT 0,
  subscription_balance INTEGER NOT NULL DEFAULT 0,
  subscription_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  ref_type TEXT, ref_id TEXT, note TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, shot_id TEXT,
  kind TEXT NOT NULL, protocol TEXT, model_id TEXT, params TEXT,
  credits_reserved INTEGER NOT NULL DEFAULT 0, credits_charged INTEGER NOT NULL DEFAULT 0,
  upstream_usage INTEGER, reserved_from_subscription INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reserved', created_at INTEGER NOT NULL
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, credits_granted INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'mock', status TEXT NOT NULL DEFAULT 'pending',
  out_trade_no TEXT NOT NULL UNIQUE, channel_trade_no TEXT,
  expires_at INTEGER NOT NULL, paid_at INTEGER, raw_callback TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX orders_channel_trade_uq ON orders(channel, channel_trade_no);
`;

/** 每个用例之间清空的表。顺序无关（没有外键约束）。 */
export const BILLING_TABLES = [
  "credit_accounts",
  "credit_ledger",
  "usage_records",
  "subscriptions",
  "orders",
] as const;
