import os
import logging
from typing import Optional
import psycopg2
from psycopg2.extras import execute_batch, execute_values
from dotenv import load_dotenv

load_dotenv(".env")

logger = logging.getLogger("pipeline.db")

DATABASE_URL = os.environ.get("DATABASE_URL")

SCHEMA_SQL = """
-- 1. instruments
CREATE TABLE IF NOT EXISTS instruments (
    token INT PRIMARY KEY,
    symbol VARCHAR(30) NOT NULL,
    name TEXT,
    isin VARCHAR(12),
    exchange VARCHAR(10) DEFAULT 'NSE',
    instrument_type VARCHAR(10),
    tick_size NUMERIC,
    lot_size INT,
    is_active BOOLEAN DEFAULT TRUE,
    is_traded BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);
CREATE INDEX IF NOT EXISTS idx_instruments_isin ON instruments(isin);

-- 2. trading_days
CREATE TABLE IF NOT EXISTS trading_days (
    trade_date DATE PRIMARY KEY,
    is_trading_day BOOLEAN DEFAULT TRUE,
    holiday_name TEXT,
    settlement_holiday BOOLEAN DEFAULT FALSE
);

-- 3. daily_index_ohlcv
CREATE TABLE IF NOT EXISTS daily_index_ohlcv (
    trade_date DATE NOT NULL,
    index_name VARCHAR(30) NOT NULL,
    open NUMERIC,
    high NUMERIC,
    low NUMERIC,
    close NUMERIC NOT NULL,
    volume BIGINT,
    PRIMARY KEY (trade_date, index_name)
);
CREATE INDEX IF NOT EXISTS idx_daily_index_date ON daily_index_ohlcv(trade_date);

-- 4. daily_macro_rates
CREATE TABLE IF NOT EXISTS daily_macro_rates (
    trade_date DATE NOT NULL,
    series VARCHAR(20) NOT NULL,
    close NUMERIC NOT NULL,
    PRIMARY KEY (trade_date, series)
);
CREATE INDEX IF NOT EXISTS idx_daily_macro_date ON daily_macro_rates(trade_date);

-- 5. daily_fii_dii_cash
CREATE TABLE IF NOT EXISTS daily_fii_dii_cash (
    trade_date DATE PRIMARY KEY,
    fii_buy NUMERIC,
    fii_sell NUMERIC,
    fii_net NUMERIC,
    dii_buy NUMERIC,
    dii_sell NUMERIC,
    dii_net NUMERIC
);

-- 6. index_constituents
CREATE TABLE IF NOT EXISTS index_constituents (
    index_name VARCHAR(30) NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    weight NUMERIC,
    effective_date DATE NOT NULL,
    PRIMARY KEY (index_name, symbol, effective_date)
);
CREATE INDEX IF NOT EXISTS idx_constituents_lookup ON index_constituents(index_name, symbol);

-- 7. price_adjustments
CREATE TABLE IF NOT EXISTS price_adjustments (
    token INT NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    ex_date DATE NOT NULL,
    action_type VARCHAR(20) NOT NULL,
    ratio NUMERIC NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (token, ex_date, action_type)
);

-- 8. ingest_runs
CREATE TABLE IF NOT EXISTS ingest_runs (
    run_id SERIAL PRIMARY KEY,
    run_type VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL,
    instruments_total INT,
    instruments_success INT,
    instruments_failed INT,
    error_message TEXT
);

-- 9. daily_market_breadth
CREATE TABLE IF NOT EXISTS daily_market_breadth (
    trade_date DATE NOT NULL,
    universe VARCHAR(30) NOT NULL,
    advances INT,
    declines INT,
    unchanged INT,
    ad_ratio NUMERIC,
    ad_ratio_20d NUMERIC,
    ad_ratio_40d NUMERIC,
    ad_line NUMERIC,
    pct_above_20ema NUMERIC,
    pct_above_50sma NUMERIC,
    pct_above_200sma NUMERIC,
    highs_20d INT,
    lows_20d INT,
    net_highs_20d INT,
    highs_52w INT,
    lows_52w INT,
    net_52w INT,
    pct_movers_up_4pct NUMERIC,
    pct_movers_down_4pct NUMERIC,
    movers_ratio_5d NUMERIC,
    movers_ratio_10d NUMERIC,
    breakouts_20d INT,
    breakdowns_20d INT,
    weinstein_stage_1_pct NUMERIC,
    weinstein_stage_2_pct NUMERIC,
    weinstein_stage_3_pct NUMERIC,
    weinstein_stage_4_pct NUMERIC,
    regime VARCHAR(30),
    regime_score INT,
    distribution_days INT,
    breadth_thrust BOOLEAN,
    PRIMARY KEY (trade_date, universe)
);
CREATE INDEX IF NOT EXISTS idx_breadth_universe_date ON daily_market_breadth(universe, trade_date DESC);
"""

def get_connection(db_url: Optional[str] = None):
    url = db_url or DATABASE_URL
    if not url:
        raise ValueError("DATABASE_URL is not set.")
    return psycopg2.connect(url)

def init_db(db_url: Optional[str] = None):
    """Initializes tables and indexes in Neon PostgreSQL."""
    conn = get_connection(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(SCHEMA_SQL)
        conn.commit()
        logger.info("Database schema initialized successfully.")
    finally:
        conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()

