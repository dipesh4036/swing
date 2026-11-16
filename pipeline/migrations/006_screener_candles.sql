-- Migration 006: Screener Candles Table for Charting
CREATE TABLE IF NOT EXISTS screener_candles (
  token INT NOT NULL,
  trade_date DATE NOT NULL,
  open NUMERIC,
  high NUMERIC,
  low NUMERIC,
  close NUMERIC NOT NULL,
  volume BIGINT,
  sma_10 NUMERIC,
  sma_20 NUMERIC,
  sma_50 NUMERIC,
  sma_150 NUMERIC,
  sma_200 NUMERIC,
  ema_50 NUMERIC,
  PRIMARY KEY (token, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_screener_candles_lookup ON screener_candles(token, trade_date ASC);
CREATE INDEX IF NOT EXISTS idx_screener_candles_date ON screener_candles(trade_date DESC);

