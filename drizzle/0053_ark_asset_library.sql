-- 火山方舟「私域虚拟人像素材资产库」支持
-- 解决 Seedance 2.0 系列模型不支持直接上传含真人人脸参考图的问题：
-- 把角色定妆图注册进私域素材库，拿到永久有效的 asset:// ID，视频生成时改用该 ID 引用。

-- 账号级 AK/SK 凭证（素材库管控面 API 用 AK/SK 签名鉴权，与普通 Bearer API Key 分开存）
CREATE TABLE IF NOT EXISTS ark_asset_library_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  access_key_id TEXT NOT NULL DEFAULT '',
  secret_access_key TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT 'default',
  region TEXT NOT NULL DEFAULT 'cn-beijing',
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ark_asset_library_credentials_user_idx
  ON ark_asset_library_credentials(user_id);
--> statement-breakpoint

-- 一个角色 = 一个私域素材组合（Asset Group），组内可放该角色的多张素材
ALTER TABLE characters ADD COLUMN ark_asset_group_id TEXT;
--> statement-breakpoint

-- 单个角色资产（定妆图）注册进素材库后的状态
ALTER TABLE character_assets ADD COLUMN ark_asset_id TEXT;
--> statement-breakpoint
ALTER TABLE character_assets ADD COLUMN ark_asset_status TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE character_assets ADD COLUMN ark_asset_registered_at INTEGER;
