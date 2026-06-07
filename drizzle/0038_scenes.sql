-- 场景资产表：存储场景名称、描述和参考图路径
-- episode_id = NULL 表示项目级场景（跨集复用）
CREATE TABLE IF NOT EXISTS `scenes` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `episode_id` text REFERENCES `episodes`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `image_path` text,
  `created_at` integer NOT NULL
);

-- shots 表新增 scene_id 外键（可空，级联 SET NULL）
ALTER TABLE `shots` ADD COLUMN `scene_id` text REFERENCES `scenes`(`id`) ON DELETE SET NULL;
