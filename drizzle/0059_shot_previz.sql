-- 白模预演（previz）：正式出片前先用 480p 灰白模验证运镜与构图。
-- 一个分镜可以有多条 take，选中的那条会作为 reference_video 参与正式生成（Seedance 2.5）。
CREATE TABLE `shot_previz` (
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
--> statement-breakpoint
CREATE INDEX `shot_previz_shot_id_idx` ON `shot_previz` (`shot_id`);
--> statement-breakpoint
ALTER TABLE `shots` ADD COLUMN `previz_selected_id` TEXT;
