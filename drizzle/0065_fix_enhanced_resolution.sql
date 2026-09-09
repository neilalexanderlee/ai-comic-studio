-- 订正「画质增强的产物被记成 720p，实际是 1080p」的存量数据。
--
-- 成因见 CLAUDE.md 陷阱表：增强路由调 provider 时没传 resolution，
-- 走了 provider 默认值 1080p，而落库、文案、额度折算全都写死 720p。
--
-- 只订正**确实做过增强**的那些（历史表里留有「增强↑…前」标记）且**当前仍标为 720p** 的。
-- 增强后又重新生成过的分镜，当前视频是新的 480p，标识本来就对 —— WHERE 会把它们排除。
-- 本次生产库实测：27 个做过增强，其中 25 个标为 720p（需订正）、2 个标为 480p（不动）。
--
-- 幂等且对未受影响的库是空操作：没做过增强的部署匹配不到任何行。
UPDATE shots
SET video_resolution = '1080p'
WHERE video_resolution = '720p'
  AND id IN (SELECT DISTINCT shot_id FROM shot_video_history WHERE label LIKE '增强%');
--> statement-breakpoint
-- 历史记录里那句「增强↑720p 前」描述的也是同一件事，同样是错的。
-- 这条只在本次升级时跑一次；此后用户可以显式选 720p，那时的标签是真实的。
UPDATE shot_video_history
SET label = '增强↑1080p 前'
WHERE label = '增强↑720p 前';
