-- 项目级画面比例设置（16:9 / 9:16 / 1:1）
-- 驱动帧/视频生成的 ratio 参数，以及视频编辑器画布尺寸（竖屏短剧支持）
ALTER TABLE projects ADD COLUMN video_ratio TEXT NOT NULL DEFAULT '16:9';
