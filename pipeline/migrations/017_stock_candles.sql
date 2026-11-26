-- Migration 017: Stock Candles for Liquid Classified Stocks (260-session window)
-- Provides chart OHLCV fallback on Vercel without Angel One secrets.

CREATE TABLE IF NOT EXISTS stock_candles (
  token INT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  PRIMARY KEY (token, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_candles_token_date
  ON stock_candles(token, trade_date DESC);

DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE stock_candles TO web_readonly;
   END IF;
END
$$;
