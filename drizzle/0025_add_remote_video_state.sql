ALTER TABLE `shots` ADD `remote_video_status` text;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_video_created_at` integer;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_video_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_video_last_download_at` integer;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_reference_video_status` text;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_reference_video_created_at` integer;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_reference_video_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `shots` ADD `remote_reference_video_last_download_at` integer;
