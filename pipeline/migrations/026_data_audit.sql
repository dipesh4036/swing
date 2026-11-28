-- Migration 026: data_audit table for D4 Data Trust page and weekly/manual audit runs.

CREATE TABLE IF NOT EXISTS data_audit (
  run_at TIMESTAMPTZ NOT NULL,
  check_id TEXT NOT NULL,
  source TEXT,
  sample_n INT,
  matched_n INT,
  match_pct NUMERIC,
  gate_pct NUMERIC,
  passed BOOLEAN,
  detail JSONB,
  run_kind TEXT CHECK (run_kind IN ('ci', 'manual')),
  PRIMARY KEY (run_at, check_id)
);

CREATE INDEX IF NOT EXISTS idx_data_audit_check_run ON data_audit (check_id, run_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_readonly') THEN
    GRANT SELECT ON TABLE data_audit TO web_readonly;
  END IF;
END $$;
