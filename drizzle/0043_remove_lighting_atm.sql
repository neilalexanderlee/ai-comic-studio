-- Migration 0043: Remove lightingAtm from shots table
-- Architectural decision (2026-06-08): Complete Toonflow alignment.
-- lightingAtm is fully removed. Lighting information is embedded directly
-- in startFrameDesc (single source of truth for all generation).
-- startFrameDesc must self-contain: framing/angle + character pose + main light + emotional anatomy.
--
-- SQLite does not support DROP COLUMN before version 3.35.
-- Using the rename-copy-drop pattern for compatibility.

-- Step 1: Create new table without lighting_atm
CREATE TABLE shots_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_id TEXT,
  episode_id TEXT,
  sequence INTEGER NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  start_frame_desc TEXT,
  end_frame_desc TEXT,
  motion_script TEXT,
  camera_direction TEXT NOT NULL DEFAULT 'static',
  duration INTEGER NOT NULL DEFAULT 8,
  track TEXT,
  scene_id TEXT,
  scene_title TEXT,
  sound_effect_note TEXT,
  warnings TEXT,
  chain_source_shot_id TEXT,
  chain_source_type TEXT,
  anchor_first TEXT,
  anchor_last_ai TEXT,
  cut_point TEXT,
  video_url TEXT,
  remote_video_url TEXT,
  remote_video_status TEXT,
  remote_video_expires_at INTEGER,
  remote_video_last_download_at INTEGER,
  video_prompt TEXT,
  video_resolution TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Step 2: Copy data (lighting_atm dropped)
INSERT INTO shots_new SELECT
  id, project_id, version_id, episode_id, sequence, prompt,
  start_frame_desc, end_frame_desc, motion_script, camera_direction,
  duration, track, scene_id, scene_title,
  sound_effect_note, warnings, chain_source_shot_id, chain_source_type,
  anchor_first, anchor_last_ai, cut_point, video_url,
  remote_video_url, remote_video_status, remote_video_expires_at,
  remote_video_last_download_at, video_prompt, video_resolution,
  status, created_at, updated_at
FROM shots;

-- Step 3: Swap tables
DROP TABLE shots;
ALTER TABLE shots_new RENAME TO shots;
