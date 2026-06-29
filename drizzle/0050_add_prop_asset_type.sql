-- Add "prop" as a valid assetType for character_assets.
-- The character_assets table was created manually (migration 0016 is empty),
-- so no DB-level CHECK constraint exists on asset_type. This migration is
-- a bookkeeping record only — the TypeScript enum in schema.ts is the source of truth.
SELECT 1;
