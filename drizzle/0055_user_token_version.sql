-- 会话版本号：改密码 / 登出所有设备时自增，使此前签发的所有 auth cookie 立即失效。
-- 配合 lib/auth.ts 的 v2 cookie 格式（cookie 载荷里带签发时的版本号）。
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
