-- 分镜级道具绑定字段
-- 存储用户手动选择的 character_assets.id 列表（JSON 数组）
-- 对应 assetType="prop" 的资产，生成时注入为额外参考图
ALTER TABLE shots ADD COLUMN prop_refs TEXT;
