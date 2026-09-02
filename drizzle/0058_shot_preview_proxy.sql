-- 预览代理与封面帧。
-- 编辑器直接解码 1080p 源片（单个可达 55MB）会把音频解码线程饿死，
-- 报 MP4Clip.tick audio timeout 并严重卡顿；迁到 OSS 后叠加网络延迟更明显。
-- 480p/CRF30 代理实测压缩 73x（55MB → 764KB）。导出成片仍用原片。
ALTER TABLE shots ADD COLUMN preview_url TEXT;
--> statement-breakpoint
ALTER TABLE shots ADD COLUMN poster_url TEXT;
