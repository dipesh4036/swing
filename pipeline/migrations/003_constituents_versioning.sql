-- Migration 003: Constituents Versioning (effective_from, effective_to, is_active)
ALTER TABLE index_constituents
    ADD COLUMN IF NOT EXISTS effective_from DATE,
    ADD COLUMN IF NOT EXISTS effective_to DATE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS isin VARCHAR(12);

-- Populate effective_from from effective_date if null
UPDATE index_constituents
SET effective_from = effective_date
WHERE effective_from IS NULL AND effective_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_constituents_effective
ON index_constituents(index_name, effective_from, effective_to, is_active);

