import os
import sys
import logging
from typing import Dict, List, Any, Optional
import numpy as np
import pandas as pd
from psycopg2.extras import execute_batch
from pipeline.config import EQUITY_PARQUET_PATH
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.compute")

UNIVERSES = ["nifty500", "nifty200", "nifty100", "nifty_midcap150", "nifty_smallcap250", "all"]

def compute_stock_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes vectorised indicators across OHLCV history for all instruments.
    Assumes df is sorted by ['token', 'trade_date'].
    """
    logger.info("Computing vectorised per-stock indicators...")
    df = df.copy()
    df.sort_values(by=["token", "trade_date"], inplace=True)
    grouped = df.groupby("token")

    # 1. Previous close & 1-day return
    df["prev_close"] = grouped["close"].shift(1)
    df["ret_1d"] = (df["close"] - df["prev_close"]) / df["prev_close"]
    df["advance"] = (df["close"] > df["prev_close"]).astype(int)
    df["decline"] = (df["close"] < df["prev_close"]).astype(int)
    df["unchanged"] = (df["close"] == df["prev_close"]).astype(int)

    # 2. Moving averages
    # 20 EMA (adjust=False)
    df["ema_20"] = grouped["close"].transform(lambda s: s.ewm(span=20, adjust=False).mean())
    # 50 SMA
    df["sma_50"] = grouped["close"].transform(lambda s: s.rolling(50, min_periods=40).mean())
    # 150 SMA (30-week)
    df["sma_150"] = grouped["close"].transform(lambda s: s.rolling(150, min_periods=120).mean())
    # 200 SMA
    df["sma_200"] = grouped["close"].transform(lambda s: s.rolling(200, min_periods=160).mean())

    df["above_20ema"] = df["close"] > df["ema_20"]
    df["above_50sma"] = df["close"] > df["sma_50"]
    df["above_200sma"] = df["close"] > df["sma_200"]

    # 3. Highs and Lows (20D and 52W / 252 sessions, excluding current session)
    df["high_20d"] = grouped["high"].transform(lambda s: s.shift(1).rolling(20, min_periods=15).max())
    df["low_20d"] = grouped["low"].transform(lambda s: s.shift(1).rolling(20, min_periods=15).min())
    df["is_high_20d"] = (df["high"] >= df["high_20d"]).astype(int)
    df["is_low_20d"] = (df["low"] <= df["low_20d"]).astype(int)

    df["high_52w"] = grouped["high"].transform(lambda s: s.shift(1).rolling(252, min_periods=180).max())
    df["low_52w"] = grouped["low"].transform(lambda s: s.shift(1).rolling(252, min_periods=180).min())
    df["is_high_52w"] = (df["high"] >= df["high_52w"]).astype(int)
    df["is_low_52w"] = (df["low"] <= df["low_52w"]).astype(int)

    # 4. 4% Movers (with minimum price filter close >= 10)
    df["mover_up_4pct"] = ((df["ret_1d"] >= 0.04) & (df["close"] >= 10)).astype(int)
    df["mover_down_4pct"] = ((df["ret_1d"] <= -0.04) & (df["close"] >= 10)).astype(int)

    # 5. Breakouts / Breakdowns (close > prior 20D high on volume >= 1.5 * 50D vol SMA)
    df["vol_sma_50"] = grouped["volume"].transform(lambda s: s.shift(1).rolling(50, min_periods=30).mean())
    df["breakout_20d"] = ((df["close"] > df["high_20d"]) & (df["volume"] >= 1.5 * df["vol_sma_50"])).astype(int)
    df["breakdown_20d"] = ((df["close"] < df["low_20d"]) & (df["volume"] >= 1.5 * df["vol_sma_50"])).astype(int)

    # 6. Weinstein Stages (Price vs 150 SMA & 20-session slope)
    sma_150_prev20 = grouped["sma_150"].shift(20)
    df["sma_150_slope"] = (df["sma_150"] - sma_150_prev20) / sma_150_prev20

    is_valid_stage = df["sma_150"].notna() & df["sma_150_slope"].notna()
    df["stage_1"] = (is_valid_stage & (df["close"] >= df["sma_150"]) & (df["sma_150_slope"] < 0.005)).astype(int)
    df["stage_2"] = (is_valid_stage & (df["close"] >= df["sma_150"]) & (df["sma_150_slope"] >= 0.005)).astype(int)
    df["stage_3"] = (is_valid_stage & (df["close"] < df["sma_150"]) & (df["sma_150_slope"] > -0.005)).astype(int)
    df["stage_4"] = (is_valid_stage & (df["close"] < df["sma_150"]) & (df["sma_150_slope"] <= -0.005)).astype(int)

    logger.info("Stock indicators computation finished.")
    return df

def get_distribution_days_series(conn) -> pd.Series:
    """
    Computes trailing 25-session distribution days on NIFTY 50.
    A distribution day is a day where Nifty 50 drops > 0.2% on higher volume than previous day.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT trade_date, close, volume
            FROM daily_index_ohlcv
            WHERE index_name = 'NIFTY 50'
            ORDER BY trade_date ASC;
        """)
        rows = cur.fetchall()

    if not rows:
        return pd.Series(dtype=float)

    df_nifty = pd.DataFrame(rows, columns=["trade_date", "close", "volume"])
    df_nifty["trade_date"] = pd.to_datetime(df_nifty["trade_date"]).dt.strftime("%Y-%m-%d")
    df_nifty["prev_close"] = df_nifty["close"].shift(1)
    df_nifty["prev_volume"] = df_nifty["volume"].shift(1)
    df_nifty["ret"] = (df_nifty["close"] - df_nifty["prev_close"]) / df_nifty["prev_close"]
    
    # Distribution day condition: ret <= -0.002 and volume > prev_volume
    df_nifty["is_dist_day"] = ((df_nifty["ret"] <= -0.002) & (df_nifty["volume"] > df_nifty["prev_volume"])).astype(int)
    # Trailing 25 sessions sum
    df_nifty["dist_days_25"] = df_nifty["is_dist_day"].rolling(25, min_periods=1).sum().astype(int)
    return df_nifty.set_index("trade_date")["dist_days_25"]

def compute_breadth_for_universe(
    df_ind: pd.DataFrame,
    universe: str,
    symbols: Optional[Set[str]],
    dist_days_series: pd.Series
) -> List[Dict[str, Any]]:
    """
    Aggregates per-stock indicators into daily market breadth metrics for a universe.
    """
    if symbols is not None:
        df_sub = df_ind[df_ind["symbol"].isin(symbols)].copy()
    else:
        df_sub = df_ind.copy()

    if df_sub.empty:
        logger.warning(f"No stock records found for universe: {universe}")
        return []

    # Group by trade_date
    grouped_date = df_sub.groupby("trade_date")

    agg_df = pd.DataFrame({
        "advances": grouped_date["advance"].sum(),
        "declines": grouped_date["decline"].sum(),
        "unchanged": grouped_date["unchanged"].sum(),
        "total_active": grouped_date["close"].count(),
        "valid_20ema": grouped_date["above_20ema"].count(),
        "count_above_20ema": grouped_date["above_20ema"].sum(),
        "valid_50sma": grouped_date["above_50sma"].count(),
        "count_above_50sma": grouped_date["above_50sma"].sum(),
        "valid_200sma": grouped_date["above_200sma"].count(),
        "count_above_200sma": grouped_date["above_200sma"].sum(),
        "highs_20d": grouped_date["is_high_20d"].sum(),
        "lows_20d": grouped_date["is_low_20d"].sum(),
        "highs_52w": grouped_date["is_high_52w"].sum(),
        "lows_52w": grouped_date["is_low_52w"].sum(),
        "movers_up": grouped_date["mover_up_4pct"].sum(),
        "movers_down": grouped_date["mover_down_4pct"].sum(),
        "breakouts_20d": grouped_date["breakout_20d"].sum(),
        "breakdowns_20d": grouped_date["breakdown_20d"].sum(),
        "stage_1_count": grouped_date["stage_1"].sum(),
        "stage_2_count": grouped_date["stage_2"].sum(),
        "stage_3_count": grouped_date["stage_3"].sum(),
        "stage_4_count": grouped_date["stage_4"].sum(),
    }).sort_index()

    # Derived rolling metrics
    agg_df["ad_ratio"] = np.where(agg_df["declines"] > 0, agg_df["advances"] / agg_df["declines"], np.nan)
    adv_20 = agg_df["advances"].rolling(20, min_periods=10).sum()
    dec_20 = agg_df["declines"].rolling(20, min_periods=10).sum()
    agg_df["ad_ratio_20d"] = np.where(dec_20 > 0, adv_20 / dec_20, np.nan)

    adv_40 = agg_df["advances"].rolling(40, min_periods=20).sum()
    dec_40 = agg_df["declines"].rolling(40, min_periods=20).sum()
    agg_df["ad_ratio_40d"] = np.where(dec_40 > 0, adv_40 / dec_40, np.nan)

    agg_df["ad_line"] = (agg_df["advances"] - agg_df["declines"]).cumsum()

    agg_df["pct_above_20ema"] = np.where(agg_df["valid_20ema"] > 0, (agg_df["count_above_20ema"] / agg_df["valid_20ema"]) * 100.0, np.nan)
    agg_df["pct_above_50sma"] = np.where(agg_df["valid_50sma"] > 0, (agg_df["count_above_50sma"] / agg_df["valid_50sma"]) * 100.0, np.nan)
    agg_df["pct_above_200sma"] = np.where(agg_df["valid_200sma"] > 0, (agg_df["count_above_200sma"] / agg_df["valid_200sma"]) * 100.0, np.nan)

    agg_df["net_highs_20d"] = agg_df["highs_20d"] - agg_df["lows_20d"]
    agg_df["net_52w"] = agg_df["highs_52w"] - agg_df["lows_52w"]

    agg_df["pct_movers_up_4pct"] = np.where(agg_df["total_active"] > 0, (agg_df["movers_up"] / agg_df["total_active"]) * 100.0, np.nan)
    agg_df["pct_movers_down_4pct"] = np.where(agg_df["total_active"] > 0, (agg_df["movers_down"] / agg_df["total_active"]) * 100.0, np.nan)

    mup_5 = agg_df["movers_up"].rolling(5, min_periods=3).sum()
    mdown_5 = agg_df["movers_down"].rolling(5, min_periods=3).sum()
    agg_df["movers_ratio_5d"] = np.where(mdown_5 > 0, mup_5 / mdown_5, np.nan)

    mup_10 = agg_df["movers_up"].rolling(10, min_periods=5).sum()
    mdown_10 = agg_df["movers_down"].rolling(10, min_periods=5).sum()
    agg_df["movers_ratio_10d"] = np.where(mdown_10 > 0, mup_10 / mdown_10, np.nan)

    stage_total = agg_df["stage_1_count"] + agg_df["stage_2_count"] + agg_df["stage_3_count"] + agg_df["stage_4_count"]
    agg_df["weinstein_stage_1_pct"] = np.where(stage_total > 0, (agg_df["stage_1_count"] / stage_total) * 100.0, np.nan)
    agg_df["weinstein_stage_2_pct"] = np.where(stage_total > 0, (agg_df["stage_2_count"] / stage_total) * 100.0, np.nan)
    agg_df["weinstein_stage_3_pct"] = np.where(stage_total > 0, (agg_df["stage_3_count"] / stage_total) * 100.0, np.nan)
    agg_df["weinstein_stage_4_pct"] = np.where(stage_total > 0, (agg_df["stage_4_count"] / stage_total) * 100.0, np.nan)

    # Zweig Breadth Thrust: 10-day EMA of Advances / (Advances + Declines)
    total_adv_dec = agg_df["advances"] + agg_df["declines"]
    adv_ratio_raw = np.where(total_adv_dec > 0, agg_df["advances"] / total_adv_dec, 0.5)
    thrust_ema = pd.Series(adv_ratio_raw, index=agg_df.index).ewm(span=10, adjust=False).mean()
    # Thrust condition: in the last 10 days, crossed from < 0.40 to > 0.615
    agg_df["breadth_thrust"] = (thrust_ema > 0.615) & (thrust_ema.shift(10) < 0.40)

    # Composite regime score (0 to 100)
    # 40% weight on % > 50 SMA, 30% weight on % > 200 SMA, 30% weight on 20D A/D ratio (scaled 0-2 -> 0-100)
    s50 = agg_df["pct_above_50sma"].fillna(50)
    s200 = agg_df["pct_above_200sma"].fillna(50)
    ad20 = (agg_df["ad_ratio_20d"].fillna(1.0).clip(0.0, 2.0) / 2.0) * 100.0
    composite = (0.40 * s50 + 0.30 * s200 + 0.30 * ad20).round().astype(int)
    agg_df["regime_score"] = composite

    def get_regime(score: int) -> str:
        if score >= 70:
            return "Confirmed Uptrend"
        elif score >= 50:
            return "Uptrend Under Pressure"
        elif score >= 35:
            return "Rally Attempt"
        else:
            return "Market in Correction"

    agg_df["regime"] = agg_df["regime_score"].apply(get_regime)

    # Add distribution days
    agg_df["distribution_days"] = agg_df.index.map(lambda d: int(dist_days_series.get(d, 0)))

    records = []
    for trade_date, row in agg_df.iterrows():
        records.append({
            "trade_date": trade_date,
            "universe": universe,
            "advances": int(row["advances"]),
            "declines": int(row["declines"]),
            "unchanged": int(row["unchanged"]),
            "ad_ratio": round(float(row["ad_ratio"]), 4) if pd.notna(row["ad_ratio"]) else None,
            "ad_ratio_20d": round(float(row["ad_ratio_20d"]), 4) if pd.notna(row["ad_ratio_20d"]) else None,
            "ad_ratio_40d": round(float(row["ad_ratio_40d"]), 4) if pd.notna(row["ad_ratio_40d"]) else None,
            "ad_line": round(float(row["ad_line"]), 2) if pd.notna(row["ad_line"]) else None,
            "pct_above_20ema": round(float(row["pct_above_20ema"]), 2) if pd.notna(row["pct_above_20ema"]) else None,
            "pct_above_50sma": round(float(row["pct_above_50sma"]), 2) if pd.notna(row["pct_above_50sma"]) else None,
            "pct_above_200sma": round(float(row["pct_above_200sma"]), 2) if pd.notna(row["pct_above_200sma"]) else None,
            "highs_20d": int(row["highs_20d"]),
            "lows_20d": int(row["lows_20d"]),
            "net_highs_20d": int(row["net_highs_20d"]),
            "highs_52w": int(row["highs_52w"]),
            "lows_52w": int(row["lows_52w"]),
            "net_52w": int(row["net_52w"]),
            "pct_movers_up_4pct": round(float(row["pct_movers_up_4pct"]), 2) if pd.notna(row["pct_movers_up_4pct"]) else None,
            "pct_movers_down_4pct": round(float(row["pct_movers_down_4pct"]), 2) if pd.notna(row["pct_movers_down_4pct"]) else None,
            "movers_ratio_5d": round(float(row["movers_ratio_5d"]), 4) if pd.notna(row["movers_ratio_5d"]) else None,
            "movers_ratio_10d": round(float(row["movers_ratio_10d"]), 4) if pd.notna(row["movers_ratio_10d"]) else None,
            "breakouts_20d": int(row["breakouts_20d"]),
            "breakdowns_20d": int(row["breakdowns_20d"]),
            "weinstein_stage_1_pct": round(float(row["weinstein_stage_1_pct"]), 2) if pd.notna(row["weinstein_stage_1_pct"]) else None,
            "weinstein_stage_2_pct": round(float(row["weinstein_stage_2_pct"]), 2) if pd.notna(row["weinstein_stage_2_pct"]) else None,
            "weinstein_stage_3_pct": round(float(row["weinstein_stage_3_pct"]), 2) if pd.notna(row["weinstein_stage_3_pct"]) else None,
            "weinstein_stage_4_pct": round(float(row["weinstein_stage_4_pct"]), 2) if pd.notna(row["weinstein_stage_4_pct"]) else None,
            "regime": str(row["regime"]),
            "regime_score": int(row["regime_score"]),
            "distribution_days": int(row["distribution_days"]),
            "breadth_thrust": bool(row["breadth_thrust"]),
        })

    logger.info(f"Computed {len(records)} breadth rows for universe {universe}.")
    return records

def compute_and_publish_all(parquet_path: str = EQUITY_PARQUET_PATH) -> bool:
    """
    Main computation runner:
    1. Loads equity candles from parquet.
    2. Computes per-stock vectorised technical indicators.
    3. Loads index constituents from Neon PostgreSQL.
    4. Computes daily market breadth for each universe.
    5. Upserts into `daily_market_breadth` table in Neon PostgreSQL.
    """
    if not os.path.exists(parquet_path):
        logger.error(f"Parquet file {parquet_path} does not exist. Run ingest first.")
        return False

    df_raw = pd.read_parquet(parquet_path)
    if df_raw.empty:
        logger.error("Parquet file is empty.")
        return False

    logger.info(f"Loaded {len(df_raw)} raw equity rows from {parquet_path}.")
    df_ind = compute_stock_indicators(df_raw)

    conn = get_connection()
    try:
        # Load constituents
        with conn.cursor() as cur:
            cur.execute("SELECT index_name, symbol FROM index_constituents;")
            const_rows = cur.fetchall()

        constituents_by_universe = {}
        for idx_name, sym in const_rows:
            if idx_name not in constituents_by_universe:
                constituents_by_universe[idx_name] = set()
            constituents_by_universe[idx_name].add(sym)

        dist_days_series = get_distribution_days_series(conn)

        all_breadth_records = []
        for universe in UNIVERSES:
            symbols = constituents_by_universe.get(universe) if universe != "all" else None
            records = compute_breadth_for_universe(df_ind, universe, symbols, dist_days_series)
            all_breadth_records.extend(records)

        logger.info(f"Publishing {len(all_breadth_records)} breadth records to Neon PostgreSQL...")
        
        insert_sql = """
        INSERT INTO daily_market_breadth (
            trade_date, universe, advances, declines, unchanged,
            ad_ratio, ad_ratio_20d, ad_ratio_40d, ad_line,
            pct_above_20ema, pct_above_50sma, pct_above_200sma,
            highs_20d, lows_20d, net_highs_20d, highs_52w, lows_52w, net_52w,
            pct_movers_up_4pct, pct_movers_down_4pct, movers_ratio_5d, movers_ratio_10d,
            breakouts_20d, breakdowns_20d,
            weinstein_stage_1_pct, weinstein_stage_2_pct, weinstein_stage_3_pct, weinstein_stage_4_pct,
            regime, regime_score, distribution_days, breadth_thrust
        ) VALUES (
            %(trade_date)s, %(universe)s, %(advances)s, %(declines)s, %(unchanged)s,
            %(ad_ratio)s, %(ad_ratio_20d)s, %(ad_ratio_40d)s, %(ad_line)s,
            %(pct_above_20ema)s, %(pct_above_50sma)s, %(pct_above_200sma)s,
            %(highs_20d)s, %(lows_20d)s, %(net_highs_20d)s, %(highs_52w)s, %(lows_52w)s, %(net_52w)s,
            %(pct_movers_up_4pct)s, %(pct_movers_down_4pct)s, %(movers_ratio_5d)s, %(movers_ratio_10d)s,
            %(breakouts_20d)s, %(breakdowns_20d)s,
            %(weinstein_stage_1_pct)s, %(weinstein_stage_2_pct)s, %(weinstein_stage_3_pct)s, %(weinstein_stage_4_pct)s,
            %(regime)s, %(regime_score)s, %(distribution_days)s, %(breadth_thrust)s
        )
        ON CONFLICT (trade_date, universe) DO UPDATE SET
            advances = EXCLUDED.advances,
            declines = EXCLUDED.declines,
            unchanged = EXCLUDED.unchanged,
            ad_ratio = EXCLUDED.ad_ratio,
            ad_ratio_20d = EXCLUDED.ad_ratio_20d,
            ad_ratio_40d = EXCLUDED.ad_ratio_40d,
            ad_line = EXCLUDED.ad_line,
            pct_above_20ema = EXCLUDED.pct_above_20ema,
            pct_above_50sma = EXCLUDED.pct_above_50sma,
            pct_above_200sma = EXCLUDED.pct_above_200sma,
            highs_20d = EXCLUDED.highs_20d,
            lows_20d = EXCLUDED.lows_20d,
            net_highs_20d = EXCLUDED.net_highs_20d,
            highs_52w = EXCLUDED.highs_52w,
            lows_52w = EXCLUDED.lows_52w,
            net_52w = EXCLUDED.net_52w,
            pct_movers_up_4pct = EXCLUDED.pct_movers_up_4pct,
            pct_movers_down_4pct = EXCLUDED.pct_movers_down_4pct,
            movers_ratio_5d = EXCLUDED.movers_ratio_5d,
            movers_ratio_10d = EXCLUDED.movers_ratio_10d,
            breakouts_20d = EXCLUDED.breakouts_20d,
            breakdowns_20d = EXCLUDED.breakdowns_20d,
            weinstein_stage_1_pct = EXCLUDED.weinstein_stage_1_pct,
            weinstein_stage_2_pct = EXCLUDED.weinstein_stage_2_pct,
            weinstein_stage_3_pct = EXCLUDED.weinstein_stage_3_pct,
            weinstein_stage_4_pct = EXCLUDED.weinstein_stage_4_pct,
            regime = EXCLUDED.regime,
            regime_score = EXCLUDED.regime_score,
            distribution_days = EXCLUDED.distribution_days,
            breadth_thrust = EXCLUDED.breadth_thrust;
        """

        with conn.cursor() as cur:
            execute_batch(cur, insert_sql, all_breadth_records, page_size=1000)
        conn.commit()
        logger.info(f"Successfully published {len(all_breadth_records)} rows into daily_market_breadth.")
        return True
    finally:
        conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    compute_and_publish_all()

