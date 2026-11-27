-- Migration 021: Store deterministic minimax Top 3 groups across 1D/1W/1M/3M + optional constrained summary note.

CREATE TABLE IF NOT EXISTS industry_top_groups (
  snapshot_date DATE NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('macro', 'sector', 'industry', 'basic_industry')),
  universe TEXT NOT NULL CHECK (universe IN ('all', 'liquid')),
  pos SMALLINT NOT NULL CHECK (pos BETWEEN 1 AND 3),
  group_id TEXT NOT NULL REFERENCES industry_groups(group_id) ON DELETE CASCADE,
  r_1d INT NOT NULL,
  r_1w INT NOT NULL,
  r_1m INT NOT NULL,
  r_3m INT NOT NULL,
  worst_rank INT NOT NULL,
  mean_rank NUMERIC(6, 2) NOT NULL,
  med_1d NUMERIC(8, 4) NOT NULL,
  med_1w NUMERIC(8, 4) NOT NULL,
  med_1m NUMERIC(8, 4) NOT NULL,
  med_3m NUMERIC(8, 4) NOT NULL,
  n_20d_high INT NOT NULL DEFAULT 0,
  n_20d_low INT NOT NULL DEFAULT 0,
  pct_above_50dma NUMERIC(6, 2),
  n_eligible INT NOT NULL,
  note_text TEXT NOT NULL,
  note_source TEXT NOT NULL CHECK (note_source IN ('gemini', 'template')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (snapshot_date, level, universe, pos)
);

CREATE INDEX IF NOT EXISTS idx_industry_top_groups_lookup
  ON industry_top_groups(snapshot_date DESC, level, universe, pos);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_readonly') THEN
    GRANT SELECT ON TABLE industry_top_groups TO web_readonly;
  END IF;
END
$$;
