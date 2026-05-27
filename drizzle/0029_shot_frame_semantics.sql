-- Plan B: semantic frame column names on shots
ALTER TABLE `shots` RENAME COLUMN `first_frame` TO `anchor_first`;
ALTER TABLE `shots` RENAME COLUMN `first_frame_remote_url` TO `anchor_first_remote_url`;
ALTER TABLE `shots` RENAME COLUMN `last_frame` TO `anchor_last_ai`;
ALTER TABLE `shots` RENAME COLUMN `last_frame_remote_url` TO `anchor_last_ai_remote_url`;
ALTER TABLE `shots` RENAME COLUMN `seedance_last_frame` TO `cut_point`;
ALTER TABLE `shots` ADD COLUMN `chain_source_shot_id` text;
ALTER TABLE `shots` ADD COLUMN `chain_source_type` text;
