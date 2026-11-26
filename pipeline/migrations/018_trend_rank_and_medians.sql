-- Migration 018: Blog-style Trend Rank, 20D High/Low counts, and Multi-Timeframe Medians

ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS rank_trend INT;
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS rank_trend_prev5 INT;
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS rank_trend_change INT;
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS n_20d_high INT NOT NULL DEFAULT 0;
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS n_20d_low INT NOT NULL DEFAULT 0;
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_1d NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_1w NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_1m NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_3m NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_6m NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_1y NUMERIC(8, 4);
ALTER TABLE daily_industry_strength ADD COLUMN IF NOT EXISTS median_ytd NUMERIC(8, 4);

ALTER TABLE latest_industry_stock_metrics ADD COLUMN IF NOT EXISTS ret_1y NUMERIC(8, 4);
ALTER TABLE latest_industry_stock_metrics ADD COLUMN IF NOT EXISTS ret_ytd NUMERIC(8, 4);
ALTER TABLE latest_industry_stock_metrics ADD COLUMN IF NOT EXISTS at_20d_high BOOLEAN;
ALTER TABLE latest_industry_stock_metrics ADD COLUMN IF NOT EXISTS at_20d_low BOOLEAN;
