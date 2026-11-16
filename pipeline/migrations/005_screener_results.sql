-- Migration 005: Screener Results Table
CREATE TABLE IF NOT EXISTS daily_screener_results (
  trade_date DATE NOT NULL,
  screener VARCHAR(20) NOT NULL,   -- stage2_breakout | vcp | near_pivot | ipo_base | ema50_pullback
  token INT NOT NULL,
  symbol VARCHAR(30) NOT NULL,
  close NUMERIC,
  ret_1d_pct NUMERIC,
  vol_ratio NUMERIC,               -- volume / vol_sma_50
  pct_from_52w_high NUMERIC,
  pivot NUMERIC,
  dist_to_pivot_pct NUMERIC,
  rs_rank INT,
  stage INT,
  in_nifty500 BOOLEAN,
  extra JSONB,                     -- screener-specific values and chart overlay
  PRIMARY KEY (trade_date, screener, token)
);

CREATE INDEX IF NOT EXISTS idx_screener_lookup ON daily_screener_results(screener, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_screener_token_date ON daily_screener_results(token, trade_date DESC);

