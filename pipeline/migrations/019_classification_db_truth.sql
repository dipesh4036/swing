-- Migration 019: DB-backed Classification Overrides, Symbol Changes, Audit Log, and Delist Streak

CREATE TABLE IF NOT EXISTS classification_overrides (
  symbol VARCHAR(30) PRIMARY KEY,
  macro VARCHAR(100) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  industry VARCHAR(120) NOT NULL,
  basic_industry VARCHAR(150) NOT NULL,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS symbol_changes (
  old_symbol VARCHAR(30) NOT NULL,
  new_symbol VARCHAR(30) NOT NULL,
  isin VARCHAR(12),
  changed_on DATE,
  PRIMARY KEY (old_symbol, new_symbol)
);

CREATE INDEX IF NOT EXISTS idx_symbol_changes_isin ON symbol_changes(isin);

CREATE TABLE IF NOT EXISTS classification_audit (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(30) NOT NULL,
  field VARCHAR(40) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source VARCHAR(40) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classification_audit_sym ON classification_audit(symbol, changed_at DESC);

ALTER TABLE instruments ADD COLUMN IF NOT EXISTS missing_equity_l_streak INT DEFAULT 0;

DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE classification_overrides TO web_readonly;
      GRANT SELECT ON TABLE symbol_changes TO web_readonly;
      GRANT SELECT ON TABLE classification_audit TO web_readonly;
   END IF;
END
$$;
