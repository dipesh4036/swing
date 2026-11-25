-- Migration 015: Allow NULL basic_industry in industry_stock_metrics for unclassified liquid universe stocks
ALTER TABLE industry_stock_metrics ALTER COLUMN basic_industry DROP NOT NULL;
