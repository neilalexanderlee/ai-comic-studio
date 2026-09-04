-- 渲染任务外置所需的两列。
--
-- progress：worker 在别的进程里跑，进度不能再靠 SSE 直接推给发起请求的那个连接，
--           只能落库让客户端轮询。
-- started_at：认领时间。没有它就无法回收「进程崩在中途、永远卡在 running」的任务 ——
--             与 usage_records 里那些永远 reserved 的残骸是同一个形状的问题。
ALTER TABLE tasks ADD COLUMN progress TEXT;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN started_at INTEGER;
