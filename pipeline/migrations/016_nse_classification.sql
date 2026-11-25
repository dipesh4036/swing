-- Migration 016: NSE 4-Level Classification & Industry Strength Tables
-- Additive & idempotent; preserves existing tables for safe rollback.

ALTER TABLE instruments ADD COLUMN IF NOT EXISTS macro_sector VARCHAR(100);
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS sector VARCHAR(100);
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS industry VARCHAR(120);
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS basic_industry VARCHAR(150);
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS classification_source VARCHAR(40);
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS classification_updated_at TIMESTAMPTZ;
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS classification_status VARCHAR(20) DEFAULT 'unmapped';
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS classification_retry_after TIMESTAMPTZ;
ALTER TABLE instruments ADD COLUMN IF NOT EXISTS classification_attempts INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_instruments_classification_hierarchy
  ON instruments(macro_sector, sector, industry, basic_industry);
CREATE INDEX IF NOT EXISTS idx_instruments_classification_status
  ON instruments(classification_status);

CREATE TABLE IF NOT EXISTS industry_groups (
  group_id VARCHAR(64) PRIMARY KEY,
  level VARCHAR(20) NOT NULL,
  label VARCHAR(150) NOT NULL,
  parent_id VARCHAR(64),
  macro_label VARCHAR(100),
  sector_label VARCHAR(100),
  industry_label VARCHAR(120),
  basic_industry_label VARCHAR(150),
  full_path VARCHAR(512) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_industry_groups_level ON industry_groups(level);
CREATE INDEX IF NOT EXISTS idx_industry_groups_parent ON industry_groups(parent_id);

CREATE TABLE IF NOT EXISTS industry_snapshots (
  snapshot_id VARCHAR(40) PRIMARY KEY,
  trade_date DATE NOT NULL,
  classification_date DATE,
  methodology_version VARCHAR(20) NOT NULL DEFAULT 'rs_sts_v1',
  total_stocks INT NOT NULL DEFAULT 0,
  classified_stocks INT NOT NULL DEFAULT 0,
  eligible_stocks INT NOT NULL DEFAULT 0,
  group_count INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_industry_snapshots_status_date
  ON industry_snapshots(status, trade_date DESC, completed_at DESC);

CREATE TABLE IF NOT EXISTS daily_industry_strength (
  trade_date DATE NOT NULL,
  group_id VARCHAR(64) NOT NULL REFERENCES industry_groups(group_id) ON DELETE CASCADE,
  universe VARCHAR(20) NOT NULL DEFAULT 'all',
  n_stocks INT NOT NULL DEFAULT 0,
  n_eligible INT NOT NULL DEFAULT 0,
  adv INT NOT NULL DEFAULT 0,
  dec INT NOT NULL DEFAULT 0,
  unch INT NOT NULL DEFAULT 0,
  ret_1d NUMERIC(8, 4),
  ret_1w NUMERIC(8, 4),
  ret_1m NUMERIC(8, 4),
  ret_3m NUMERIC(8, 4),
  ret_6m NUMERIC(8, 4),
  rs_sts NUMERIC(7, 4),
  rs_sts_prev NUMERIC(7, 4),
  rs_line NUMERIC(12, 6),
  rs_above_ema21 BOOLEAN,
  pct_above_20ema NUMERIC(6, 2),
  pct_above_50dma NUMERIC(6, 2),
  pct_above_200dma NUMERIC(6, 2),
  n_valid_20ema INT NOT NULL DEFAULT 0,
  n_valid_50dma INT NOT NULL DEFAULT 0,
  n_valid_200dma INT NOT NULL DEFAULT 0,
  mcap_cr NUMERIC,
  rank INT,
  PRIMARY KEY (trade_date, group_id, universe)
);

CREATE INDEX IF NOT EXISTS idx_daily_industry_strength_lookup
  ON daily_industry_strength(trade_date, universe, group_id);

CREATE TABLE IF NOT EXISTS latest_industry_stock_metrics (
  snapshot_id VARCHAR(40) NOT NULL REFERENCES industry_snapshots(snapshot_id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  token INT NOT NULL,
  symbol VARCHAR(30) NOT NULL,
  name VARCHAR(150),
  isin VARCHAR(12),
  macro VARCHAR(100),
  sector VARCHAR(100),
  industry VARCHAR(120),
  basic_industry VARCHAR(150),
  in_universe BOOLEAN NOT NULL DEFAULT FALSE,
  is_liquid BOOLEAN NOT NULL DEFAULT FALSE,
  is_new_listing BOOLEAN NOT NULL DEFAULT FALSE,
  listing_sessions INT,
  close NUMERIC,
  ret_1d NUMERIC(8, 4),
  ret_1w NUMERIC(8, 4),
  ret_1m NUMERIC(8, 4),
  ret_3m NUMERIC(8, 4),
  ret_6m NUMERIC(8, 4),
  pct_from_52w_high NUMERIC(6, 2),
  adr_pct NUMERIC(6, 2),
  above_20ema BOOLEAN,
  above_50dma BOOLEAN,
  above_200dma BOOLEAN,
  rs_sts NUMERIC(7, 4),
  rs_above_ema21 BOOLEAN,
  rs_rating INT,
  avg_turnover_cr NUMERIC(10, 2),
  mcap_cr NUMERIC,
  PRIMARY KEY (snapshot_id, token)
);

CREATE INDEX IF NOT EXISTS idx_latest_ind_stock_metrics_sym
  ON latest_industry_stock_metrics(snapshot_id, symbol);
CREATE INDEX IF NOT EXISTS idx_latest_ind_stock_metrics_hier
  ON latest_industry_stock_metrics(snapshot_id, macro, sector, industry, basic_industry);

DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE industry_groups TO web_readonly;
      GRANT SELECT ON TABLE industry_snapshots TO web_readonly;
      GRANT SELECT ON TABLE daily_industry_strength TO web_readonly;
      GRANT SELECT ON TABLE latest_industry_stock_metrics TO web_readonly;
   END IF;
END
$$;
