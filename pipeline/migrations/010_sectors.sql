-- Migration 010: Stock Sector Mapping and Daily Sector Breadth
-- Tab 3: Sector Rotation

CREATE TABLE IF NOT EXISTS stock_sector (
  symbol VARCHAR(30) PRIMARY KEY,
  isin VARCHAR(12),
  sector VARCHAR(40) NOT NULL,
  source_index VARCHAR(60) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_sector_sector ON stock_sector(sector);
CREATE INDEX IF NOT EXISTS idx_stock_sector_isin ON stock_sector(isin);

CREATE TABLE IF NOT EXISTS daily_sector_breadth (
  trade_date DATE NOT NULL,
  sector VARCHAR(40) NOT NULL,
  n_stocks INT NOT NULL,
  n_valid INT NOT NULL,
  pct_above_50dma NUMERIC(6, 2),
  pct_above_200dma NUMERIC(6, 2),
  pct_above_20ema NUMERIC(6, 2),
  advances INT NOT NULL,
  declines INT NOT NULL,
  new_52w_highs INT NOT NULL,
  new_52w_lows INT NOT NULL,
  ret_1w_ew NUMERIC(8, 4),
  ret_1m_ew NUMERIC(8, 4),
  ret_3m_ew NUMERIC(8, 4),
  price_source VARCHAR(20) DEFAULT 'official',
  PRIMARY KEY (trade_date, sector)
);

CREATE INDEX IF NOT EXISTS idx_daily_sector_breadth_date ON daily_sector_breadth(trade_date);
CREATE INDEX IF NOT EXISTS idx_daily_sector_breadth_sector ON daily_sector_breadth(sector);

-- Role grants for web_readonly
DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE stock_sector TO web_readonly;
      GRANT SELECT ON TABLE daily_sector_breadth TO web_readonly;
   END IF;
END
$$;
