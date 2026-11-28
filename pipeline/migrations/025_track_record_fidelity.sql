-- Migration 025: Backfill fidelity (candidate_set, method, and top_industries_any_stock control).

ALTER TABLE plan_outcomes
  ADD COLUMN IF NOT EXISTS candidate_set TEXT NOT NULL DEFAULT 'displayed' CHECK (candidate_set IN ('filter_only', 'displayed')),
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'live_v1' CHECK (method IN ('live_v1', 'backfill_v0', 'backfill_v1'));

UPDATE plan_outcomes SET method = 'backfill_v0' WHERE source = 'backfill' AND method = 'live_v1';

ALTER TABLE plan_outcomes DROP CONSTRAINT IF EXISTS plan_outcomes_pkey;
ALTER TABLE plan_outcomes ADD PRIMARY KEY (plan_date, token, horizon, candidate_set);

ALTER TABLE plan_control DROP CONSTRAINT IF EXISTS plan_control_group_name_check;
ALTER TABLE plan_control
  ADD CONSTRAINT plan_control_group_name_check
  CHECK (group_name IN ('same_filter_any_industry', 'top_industries_any_stock'));

ALTER TABLE plan_outcomes_control DROP CONSTRAINT IF EXISTS plan_outcomes_control_group_name_check;
ALTER TABLE plan_outcomes_control
  ADD CONSTRAINT plan_outcomes_control_group_name_check
  CHECK (group_name IN ('same_filter_any_industry', 'top_industries_any_stock'));

ALTER TABLE plan_outcomes_control
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'backfill_v1' CHECK (method IN ('live_v1', 'backfill_v0', 'backfill_v1'));
