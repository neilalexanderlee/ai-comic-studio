-- Migration 0045: Remove scene image and angle variant feature
-- Drop scene_variants table
DROP TABLE IF EXISTS scene_variants;

-- Remove scene_variant_id from shots
ALTER TABLE shots DROP COLUMN scene_variant_id;

-- Remove image_path from scenes
ALTER TABLE scenes DROP COLUMN image_path;
