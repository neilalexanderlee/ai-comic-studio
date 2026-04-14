ALTER TABLE `projects` ADD COLUMN `user_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `projects_user_id_idx` ON `projects` (`user_id`);
