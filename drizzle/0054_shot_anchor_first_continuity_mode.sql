-- Distinguish "where the first frame came from" from "whether video must start from it".
-- NULL keeps legacy/fresh behavior; new writes use:
--   strict_start     = direct continuity copy, use Seedance initialImage
--   reference_redraw = reference-guided redraw, still eligible for multimodal
ALTER TABLE shots ADD COLUMN anchor_first_continuity_mode TEXT;
--> statement-breakpoint

-- Backfill old "adopt previous shot tail frame" rows that copied the path but did not record chain_source_*.
UPDATE shots
SET
  chain_source_shot_id = (
    SELECT source.id
    FROM shots AS source
    WHERE source.project_id = shots.project_id
      AND source.episode_id = shots.episode_id
      AND (source.version_id = shots.version_id OR (source.version_id IS NULL AND shots.version_id IS NULL))
      AND source.sequence = shots.sequence - 1
      AND shots.anchor_first = source.cut_point
    LIMIT 1
  ),
  chain_source_type = 'cut_point',
  anchor_first_continuity_mode = 'strict_start'
WHERE chain_source_shot_id IS NULL
  AND anchor_first IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM shots AS source
    WHERE source.project_id = shots.project_id
      AND source.episode_id = shots.episode_id
      AND (source.version_id = shots.version_id OR (source.version_id IS NULL AND shots.version_id IS NULL))
      AND source.sequence = shots.sequence - 1
      AND shots.anchor_first = source.cut_point
  );
--> statement-breakpoint

UPDATE shots
SET
  chain_source_shot_id = (
    SELECT source.id
    FROM shots AS source
    WHERE source.project_id = shots.project_id
      AND source.episode_id = shots.episode_id
      AND (source.version_id = shots.version_id OR (source.version_id IS NULL AND shots.version_id IS NULL))
      AND source.sequence = shots.sequence - 1
      AND shots.anchor_first = source.anchor_last_ai
    LIMIT 1
  ),
  chain_source_type = 'anchor_last_ai',
  anchor_first_continuity_mode = 'strict_start'
WHERE chain_source_shot_id IS NULL
  AND anchor_first IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM shots AS source
    WHERE source.project_id = shots.project_id
      AND source.episode_id = shots.episode_id
      AND (source.version_id = shots.version_id OR (source.version_id IS NULL AND shots.version_id IS NULL))
      AND source.sequence = shots.sequence - 1
      AND shots.anchor_first = source.anchor_last_ai
  );
--> statement-breakpoint

-- Backfill old rows that already recorded a source shot.
-- If anchor_first is exactly the same file as the recorded source frame, it was a direct continuity copy.
UPDATE shots
SET anchor_first_continuity_mode = 'strict_start'
WHERE chain_source_shot_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM shots AS source
    WHERE source.id = shots.chain_source_shot_id
      AND (
        (shots.chain_source_type = 'cut_point' AND shots.anchor_first = source.cut_point)
        OR (shots.chain_source_type = 'anchor_last_ai' AND shots.anchor_first = source.anchor_last_ai)
        OR (shots.chain_source_type = 'anchor_first' AND shots.anchor_first = source.anchor_first)
      )
  );
--> statement-breakpoint

-- Otherwise the source was only used as a reference to redraw a new first frame.
UPDATE shots
SET anchor_first_continuity_mode = 'reference_redraw'
WHERE chain_source_shot_id IS NOT NULL
  AND anchor_first_continuity_mode IS NULL;
