-- 场景角度变体表：每个场景可有多张不同拍摄角度的参考图
CREATE TABLE IF NOT EXISTS `scene_variants` (
  `id` text PRIMARY KEY NOT NULL,
  `scene_id` text NOT NULL REFERENCES `scenes`(`id`) ON DELETE CASCADE,
  `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `label` text NOT NULL DEFAULT '',
  `image_path` text NOT NULL,
  `created_at` integer NOT NULL
);

-- shots 加 scene_variant_id，指向具体变体图（null = 用场景主图）
ALTER TABLE `shots` ADD COLUMN `scene_variant_id` text REFERENCES `scene_variants`(`id`) ON DELETE SET NULL;
