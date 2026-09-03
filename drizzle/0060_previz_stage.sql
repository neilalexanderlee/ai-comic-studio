-- 3D 导演台：一集一个场景（景 + 演员身形），每镜一组走位与机位。
-- 这正是剧组的工作方式 —— 景是搭好的，变的是机位和走位；跨镜共用同一套空间坐标，
-- 也是视觉连续性能成立的前提。
--
-- 两段 JSON 里只有数字（尺寸/坐标/颜色），不内嵌素材路径 ——
-- 刻意避开 editor_state 那种「JSON 内嵌路径」给存储脚本造成的扫描盲区。
ALTER TABLE `episodes` ADD COLUMN `previz_scene` TEXT;
--> statement-breakpoint
ALTER TABLE `shots` ADD COLUMN `previz_blocking` TEXT;
--> statement-breakpoint
ALTER TABLE `shots` ADD COLUMN `previz_layout_url` TEXT;
