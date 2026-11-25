-- Migration 013: Industry Stock Metrics, Breadth, and Equal-Weight Series
-- Tab 3: Industry Rotation (I2)

CREATE TABLE IF NOT EXISTS industry_stock_metrics (
  trade_date DATE NOT NULL,
  token INT PRIMARY KEY,
  symbol VARCHAR(30) NOT NULL,
  name VARCHAR(150),
  macro VARCHAR(100),
  sector VARCHAR(100) NOT NULL,
  industry VARCHAR(100),
  basic_industry VARCHAR(150) NOT NULL,
  in_universe BOOLEAN NOT NULL,
  close NUMERIC,
  ret_1d NUMERIC(8, 4),
  ret_1w NUMERIC(8, 4),
  ret_1m NUMERIC(8, 4),
  ret_3m NUMERIC(8, 4),
  ret_6m NUMERIC(8, 4),
  pct_from_52w_high NUMERIC(6, 2),
  above_20ema BOOLEAN,
  above_50dma BOOLEAN,
  above_200dma BOOLEAN,
  stage INT,
  vol_ratio NUMERIC(6, 2),
  avg_traded_value NUMERIC,
  rs_rank INT,
  screeners TEXT[] DEFAULT '{}',
  mcap_cr NUMERIC,
  at_20d_high BOOLEAN,
  at_20d_low BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_industry_stock_metrics_date ON industry_stock_metrics(trade_date);
CREATE INDEX IF NOT EXISTS idx_industry_stock_metrics_sector ON industry_stock_metrics(sector);
CREATE INDEX IF NOT EXISTS idx_industry_stock_metrics_basic ON industry_stock_metrics(basic_industry);
CREATE INDEX IF NOT EXISTS idx_industry_stock_metrics_symbol ON industry_stock_metrics(symbol);

CREATE TABLE IF NOT EXISTS daily_industry_breadth (
  trade_date DATE NOT NULL,
  sector VARCHAR(100) NOT NULL,
  basic_industry VARCHAR(150) NOT NULL,
  n_stocks INT NOT NULL,
  n_valid_50 INT,
  n_valid_200 INT,
  median_1d NUMERIC(8, 4),
  median_1w NUMERIC(8, 4),
  median_1m NUMERIC(8, 4),
  median_3m NUMERIC(8, 4),
  median_6m NUMERIC(8, 4),
  pct_above_50 NUMERIC(6, 2),
  pct_above_200 NUMERIC(6, 2),
  n_20d_high INT,
  n_20d_low INT,
  pct_leaders NUMERIC(6, 2),
  mcap_cr NUMERIC,
  rank INT,
  PRIMARY KEY (trade_date, basic_industry)
);

CREATE INDEX IF NOT EXISTS idx_daily_industry_breadth_date ON daily_industry_breadth(trade_date);
CREATE INDEX IF NOT EXISTS idx_daily_industry_breadth_rank ON daily_industry_breadth(trade_date, rank);

CREATE TABLE IF NOT EXISTS daily_industry_index (
  trade_date DATE NOT NULL,
  basic_industry VARCHAR(150) NOT NULL,
  ew_close NUMERIC(12, 4) NOT NULL,
  n_members INT NOT NULL,
  PRIMARY KEY (trade_date, basic_industry)
);

CREATE INDEX IF NOT EXISTS idx_daily_industry_index_industry ON daily_industry_index(basic_industry, trade_date);

DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE industry_stock_metrics TO web_readonly;
      GRANT SELECT ON TABLE daily_industry_breadth TO web_readonly;
      GRANT SELECT ON TABLE daily_industry_index TO web_readonly;
   END IF;
END
$$;
