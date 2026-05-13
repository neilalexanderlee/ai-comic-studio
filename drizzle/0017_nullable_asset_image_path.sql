-- Make character_assets.image_path nullable so "clear image" works.
-- Note: PRAGMA foreign_keys cannot be used inside a transaction (drizzle wraps
-- migrations in BEGIN/COMMIT), so we omit it. The DROP is safe because nothing
-- references character_assets — it is the child table, not the parent.

CREATE TABLE character_assets_new (
  id           TEXT    NOT NULL PRIMARY KEY,
  character_id TEXT    NOT NULL,
  image_path   TEXT,
  tag          TEXT    NOT NULL DEFAULT '日常',
  is_default   INTEGER NOT NULL DEFAULT 0,
  asset_type   TEXT    NOT NULL DEFAULT 'morph',
  created_at   INTEGER NOT NULL
);

INSERT INTO character_assets_new
  SELECT id, character_id, image_path, tag, is_default, asset_type, created_at
  FROM character_assets;

DROP TABLE character_assets;

ALTER TABLE character_assets_new RENAME TO character_assets;
