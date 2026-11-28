-- Migration 024: Add qualifies and cutoff to industry_top_groups (K1, plan_v2).

ALTER TABLE industry_top_groups
  ADD COLUMN IF NOT EXISTS qualifies BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cutoff SMALLINT;
