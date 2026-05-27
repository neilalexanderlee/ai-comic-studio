-- 将 legacy reference 视频迁入 video_url 后删除 Reference 双轨字段
UPDATE shots
SET video_url = reference_video_url
WHERE (video_url IS NULL OR video_url = '')
  AND reference_video_url IS NOT NULL
  AND reference_video_url != '';

ALTER TABLE `shots` DROP COLUMN `scene_ref_frame`;
ALTER TABLE `shots` DROP COLUMN `reference_video_url`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_url`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_task_id`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_status`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_created_at`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_expires_at`;
ALTER TABLE `shots` DROP COLUMN `remote_reference_video_last_download_at`;
