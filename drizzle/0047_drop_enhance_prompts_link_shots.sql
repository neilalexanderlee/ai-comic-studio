-- Drop enhance_prompts column (AI prompt enhancement toggle — removed: feature was no-op)
-- Drop link_shots_via_cut_point column (auto shot linking toggle — removed: manual button covers this)
ALTER TABLE projects DROP COLUMN enhance_prompts;
ALTER TABLE projects DROP COLUMN link_shots_via_cut_point;
