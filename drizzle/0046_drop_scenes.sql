-- Migration 0046: Remove scenes feature entirely
-- Remove scene_id from shots first (FK dependency)
ALTER TABLE shots DROP COLUMN scene_id;

-- Drop scenes table
DROP TABLE IF EXISTS scenes;
