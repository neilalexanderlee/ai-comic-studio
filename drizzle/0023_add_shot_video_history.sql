-- Migration 0023: shot_video_history
-- 保存每个分镜的历史视频版本，最多保留 5 条，超出时由应用层删除最旧的记录和文件。

CREATE TABLE IF NOT EXISTS shot_video_history (
  id          TEXT PRIMARY KEY,
  shot_id     TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  video_url   TEXT NOT NULL,
  resolution  TEXT,                    -- "480p" | "720p" | null
  label       TEXT,                    -- "生成" | "增强↑720p" | "手动" 等
  created_at  INTEGER NOT NULL         -- Unix timestamp (ms)
);

CREATE INDEX IF NOT EXISTS idx_svh_shot_id ON shot_video_history(shot_id, created_at DESC);
