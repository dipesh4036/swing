-- Migration 023: Tab 5 Track Record outcomes, control sample, and Daily Plan notification tracking.

ALTER TABLE daily_plan
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS plan_outcomes (
  plan_date DATE NOT NULL,
  token BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  industry_label TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'backfill')),
  horizon SMALLINT NOT NULL CHECK (horizon IN (1, 5, 10, 20)),
  base_close NUMERIC(12, 2),
  base_open_next NUMERIC(12, 2),
  fwd_date DATE,
  fwd_close NUMERIC(12, 2),
  ret_from_close_pct NUMERIC(10, 4),
  ret_from_open_pct NUMERIC(10, 4),
  bench_ret_from_close_pct NUMERIC(10, 4),
  bench_ret_from_open_pct NUMERIC(10, 4),
  excess_from_close_pct NUMERIC(10, 4),
  excess_from_open_pct NUMERIC(10, 4),
  status TEXT NOT NULL CHECK (status IN ('matured', 'missing')),
  missing_reason TEXT,
  PRIMARY KEY (plan_date, token, horizon)
);

CREATE INDEX IF NOT EXISTS idx_plan_outcomes_query
  ON plan_outcomes(rules_version, horizon, source, plan_date);

CREATE TABLE IF NOT EXISTS plan_control (
  plan_date DATE NOT NULL,
  token BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  industry_label TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('same_filter_any_industry')),
  rules_version TEXT NOT NULL,
  PRIMARY KEY (plan_date, token, group_name)
);

CREATE TABLE IF NOT EXISTS plan_outcomes_control (
  plan_date DATE NOT NULL,
  token BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  industry_label TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('same_filter_any_industry')),
  rules_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'backfill')),
  horizon SMALLINT NOT NULL CHECK (horizon IN (1, 5, 10, 20)),
  base_close NUMERIC(12, 2),
  base_open_next NUMERIC(12, 2),
  fwd_date DATE,
  fwd_close NUMERIC(12, 2),
  ret_from_close_pct NUMERIC(10, 4),
  ret_from_open_pct NUMERIC(10, 4),
  bench_ret_from_close_pct NUMERIC(10, 4),
  bench_ret_from_open_pct NUMERIC(10, 4),
  excess_from_close_pct NUMERIC(10, 4),
  excess_from_open_pct NUMERIC(10, 4),
  status TEXT NOT NULL CHECK (status IN ('matured', 'missing')),
  missing_reason TEXT,
  PRIMARY KEY (plan_date, token, group_name, horizon)
);

CREATE INDEX IF NOT EXISTS idx_plan_outcomes_control_query
  ON plan_outcomes_control(rules_version, group_name, horizon, source, plan_date);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_readonly') THEN
    GRANT SELECT ON TABLE plan_outcomes TO web_readonly;
    GRANT SELECT ON TABLE plan_control TO web_readonly;
    GRANT SELECT ON TABLE plan_outcomes_control TO web_readonly;
  END IF;
END
$$;
