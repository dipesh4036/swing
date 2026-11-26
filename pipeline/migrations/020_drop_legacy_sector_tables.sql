-- Migration 020: Drop legacy Sector Rotation and pre-rebuild Industry Rotation tables.
-- DO NOT APPLY until the owner verifies zero readers remain on Vercel/Neon.

DROP TABLE IF EXISTS sector_stock_metrics;
DROP TABLE IF EXISTS daily_sector_breadth;
DROP TABLE IF EXISTS daily_industry_breadth;
DROP TABLE IF EXISTS daily_industry_index;
DROP TABLE IF EXISTS industry_stock_metrics;
DROP TABLE IF EXISTS stock_industry;
