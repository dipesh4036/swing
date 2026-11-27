-- Migration 022: Tab 4 Daily Plan stored snapshots and candidate list (90-day retention).

CREATE TABLE IF NOT EXISTS daily_plan (
  plan_date DATE PRIMARY KEY,
  market JSONB NOT NULL,
  caps JSONB NOT NULL,
  breakouts JSONB NOT NULL,
  top_industries JSONB NOT NULL,
  total_candidates INT NOT NULL DEFAULT 0,
  summary_text TEXT NOT NULL,
  summary_source TEXT NOT NULL CHECK (summary_source IN ('gemini', 'template')),
  rules_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_plan_candidates (
  plan_date DATE NOT NULL REFERENCES daily_plan(plan_date) ON DELETE CASCADE,
  rank SMALLINT NOT NULL,
  token BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  industry_label TEXT NOT NULL,
  level TEXT NOT NULL,
  rs_rank NUMERIC(6, 2) NOT NULL,
  stage SMALLINT NOT NULL,
  screener_hits TEXT[] NOT NULL DEFAULT '{}',
  reasons TEXT[] NOT NULL DEFAULT '{}',
  close NUMERIC(12, 2),
  ret_1d_pct NUMERIC(8, 4),
  pct_from_52w_high NUMERIC(8, 4),
  PRIMARY KEY (plan_date, token)
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_candidates_rank
  ON daily_plan_candidates(plan_date, rank);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_readonly') THEN
    GRANT SELECT ON TABLE daily_plan TO web_readonly;
    GRANT SELECT ON TABLE daily_plan_candidates TO web_readonly;
  END IF;
END
$$;
