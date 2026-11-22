-- Migration 011: Sector Stock Metrics and Sector Extensions
-- Tab 3: Sector Rotation Round 2 (T3, T8, T12)

-- 1. T3: Separate denominator for 200 DMA breadth
ALTER TABLE daily_sector_breadth ADD COLUMN IF NOT EXISTS n_valid_200 INT;

-- 2. T12: Industry and mapping source for Nifty 500 stocks
ALTER TABLE stock_sector ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
ALTER TABLE stock_sector ADD COLUMN IF NOT EXISTS mapped_via VARCHAR(20) DEFAULT 'index';

-- 3. T8: Per-stock sector metrics table for latest trade date
CREATE TABLE IF NOT EXISTS sector_stock_metrics (
  trade_date DATE NOT NULL,
  token INT PRIMARY KEY,
  symbol VARCHAR(30) NOT NULL,
  name VARCHAR(150),
  sector VARCHAR(40) NOT NULL,
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sector_stock_metrics_sector ON sector_stock_metrics(sector);
CREATE INDEX IF NOT EXISTS idx_sector_stock_metrics_symbol ON sector_stock_metrics(symbol);
CREATE INDEX IF NOT EXISTS idx_sector_stock_metrics_date ON sector_stock_metrics(trade_date);

-- 4. Cleanups (T12.3: Pharma merged into Healthcare; T5: Clean old EW rows from daily_index_ohlcv)
DELETE FROM stock_sector WHERE sector = 'pharma';
DELETE FROM daily_sector_breadth WHERE sector = 'pharma';
DELETE FROM daily_index_ohlcv WHERE index_name IN ('NIFTY HEALTHCARE', 'NIFTY CONSUMER DURABLES', 'NIFTY OIL & GAS');

-- 5. Role grants for web_readonly
DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE sector_stock_metrics TO web_readonly;
      GRANT SELECT ON TABLE stock_sector TO web_readonly;
      GRANT SELECT ON TABLE daily_sector_breadth TO web_readonly;
   END IF;
END
$$;
