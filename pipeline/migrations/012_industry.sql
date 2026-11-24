-- Migration 012: Industry Classification and Market Cap
-- Tab 3: Industry Rotation (I1)

-- 1. Stock -> Industry 4-level classification table
CREATE TABLE IF NOT EXISTS stock_industry (
  symbol VARCHAR(30) PRIMARY KEY,
  macro VARCHAR(100),
  sector VARCHAR(100),
  industry VARCHAR(100),
  basic_industry VARCHAR(150),
  source VARCHAR(30) DEFAULT 'nse_quote',
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_industry_sector_basic ON stock_industry(sector, basic_industry);

-- 2. Daily Market Cap and Issue Size (latest row per symbol)
CREATE TABLE IF NOT EXISTS stock_mcap (
  symbol VARCHAR(30) PRIMARY KEY,
  trade_date DATE NOT NULL,
  series VARCHAR(10),
  issue_size BIGINT,
  mcap_rs NUMERIC,
  close NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_mcap_trade_date ON stock_mcap(trade_date);

-- 3. Grants for web_readonly role
DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE stock_industry TO web_readonly;
      GRANT SELECT ON TABLE stock_mcap TO web_readonly;
   END IF;
END
$$;
