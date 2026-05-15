-- Add video_resolution column to shots table
-- Tracks the resolution at which the video was generated or enhanced to.
-- NULL = legacy / unknown, '480p' = generated at 480p (candidate for enhancement), '720p' = enhanced or generated at 720p.
ALTER TABLE shots ADD COLUMN video_resolution TEXT;
