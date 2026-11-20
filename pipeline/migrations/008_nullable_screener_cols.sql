-- Migration 008: Ensure screener columns are nullable
ALTER TABLE daily_screener_results ALTER COLUMN vol_ratio DROP NOT NULL;
ALTER TABLE daily_screener_results ALTER COLUMN ret_1d_pct DROP NOT NULL;
ALTER TABLE daily_screener_results ALTER COLUMN pct_from_52w_high DROP NOT NULL;
