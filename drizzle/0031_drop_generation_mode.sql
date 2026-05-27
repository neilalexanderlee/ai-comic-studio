-- Reference 双轨已移除；统一 keyframe / Plan B 流程
ALTER TABLE `projects` DROP COLUMN `generation_mode`;
ALTER TABLE `episodes` DROP COLUMN `generation_mode`;
