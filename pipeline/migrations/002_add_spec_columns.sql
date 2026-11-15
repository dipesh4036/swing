-- Migration 002: Add Spec Columns to daily_market_breadth and ingest_runs
ALTER TABLE daily_market_breadth
    ADD COLUMN IF NOT EXISTS total_stocks INT,
    ADD COLUMN IF NOT EXISTS stage_1_count INT,
    ADD COLUMN IF NOT EXISTS stage_2_count INT,
    ADD COLUMN IF NOT EXISTS stage_3_count INT,
    ADD COLUMN IF NOT EXISTS stage_4_count INT,
    ADD COLUMN IF NOT EXISTS stage_unclassified INT,
    ADD COLUMN IF NOT EXISTS movers_up_count INT,
    ADD COLUMN IF NOT EXISTS movers_down_count INT,
    ADD COLUMN IF NOT EXISTS read_indicators JSONB,
    ADD COLUMN IF NOT EXISTS definitions_version VARCHAR(20) DEFAULT '2.0';

ALTER TABLE ingest_runs
    ADD COLUMN IF NOT EXISTS quality_gate_passed BOOLEAN DEFAULT TRUE;

