-- Migration 009: Ensure 52-week breadth columns are nullable
ALTER TABLE daily_market_breadth ALTER COLUMN highs_52w DROP NOT NULL;
ALTER TABLE daily_market_breadth ALTER COLUMN lows_52w DROP NOT NULL;
ALTER TABLE daily_market_breadth ALTER COLUMN net_52w DROP NOT NULL;
