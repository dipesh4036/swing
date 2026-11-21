import os
import sys
import json
import logging
from typing import Dict, List, Any, Optional, Set
import numpy as np
import pandas as pd
from psycopg2.extras import execute_batch
from pipeline.config import EQUITY_PARQUET_PATH
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.compute")

UNIVERSES = ["nifty500", "nifty200", "nifty100", "nifty_midcap150", "nifty_smallcap250", "liquid", "all"]

def compute_seeded_ema20(closes: np.ndarray) -> np.ndarray:
    """
    EMA20 seeded with the SMA of the first 20 closes (per spec 4.0):
    EMA_t = close_t * (2/21) + EMA_{t-1} * (19/21)
    """
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < 20:
        return out
    sma20 = np.mean(closes[:20])
    out[19] = sma20
    alpha = 2.0 / 21.0
    one_minus_alpha = 19.0 / 21.0
    for i in range(20, n):
        out[i] = closes[i] * alpha + out[i-1] * one_minus_alpha
    return out

def compute_weinstein_stages(
    closes: np.ndarray,
    sma150: np.ndarray,
    slopes: np.ndarray
) -> Dict[str, np.ndarray]:
    """
    Weinstein stages per spec 4.6 (mutually exclusive, exhaustive):
    History requirement: at least 170 sessions (150 SMA + 20 slope); otherwise stage_unclassified.
    
    pure trend_stage:
        2 if close > sma150 and slope >= +1.0
        4 if close < sma150 and slope <= -1.0
        else none (0)
        
    Classification (first match wins):
    1. slope >= +1.0: close > sma150 -> Stage 2; else -> Stage 3
    2. slope <= -1.0: close < sma150 -> Stage 4; else -> Stage 1
    3. |slope| < 1.0 (flat): look at most recent non-none trend_stage in prior 120 sessions:
       was 2 -> Stage 3; was 4 -> Stage 1; none -> Stage 1
    """
    n = len(closes)
    stage1 = np.zeros(n, dtype=np.int32)
    stage2 = np.zeros(n, dtype=np.int32)
    stage3 = np.zeros(n, dtype=np.int32)
    stage4 = np.zeros(n, dtype=np.int32)
    unclass = np.ones(n, dtype=np.int32)

    # Track pure trend stage occurrence
    last_trend_val = 0
    last_trend_idx = -9999

    for i in range(n):
        if i < 169 or np.isnan(sma150[i]) or np.isnan(slopes[i]):
            continue

        c = closes[i]
        m = sma150[i]
        s = slopes[i]

        unclass[i] = 0

        # Update pure trend stage history BEFORE classifying flat slopes
        # Pure trend stage is recorded at session i
        curr_trend = 0
        if s >= 1.0 and c > m:
            curr_trend = 2
        elif s <= -1.0 and c < m:
            curr_trend = 4

        if s >= 1.0:
            if c > m:
                stage2[i] = 1
            else:
                stage3[i] = 1
        elif s <= -1.0:
            if c < m:
                stage4[i] = 1
            else:
                stage1[i] = 1
        else: # |s| < 1.0 flat
            # Look at most recent non-none trend_stage within prior 120 sessions
            if (i - last_trend_idx) <= 120 and last_trend_val in (2, 4):
                if last_trend_val == 2:
                    stage3[i] = 1
                else:
                    stage1[i] = 1
            else:
                stage1[i] = 1

        if curr_trend != 0:
            last_trend_val = curr_trend
            last_trend_idx = i

    return {
        "stage_1": stage1,
        "stage_2": stage2,
        "stage_3": stage3,
        "stage_4": stage4,
        "stage_unclass": unclass,
    }

def compute_stock_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes per-stock indicators across OHLCV history with strict window floors.
    """
    logger.info("Computing per-stock indicators with spec 4.6 & strict windows...")
    df = df.sort_values(by=["token", "trade_date"]).copy()
    market_dates = sorted(df["trade_date"].unique())
    date_to_idx = {d: i for i, d in enumerate(market_dates)}
    df["date_idx"] = df["trade_date"].map(date_to_idx)
    grouped = df.groupby("token")

    # 1. Previous close & 1-day return (market calendar adjacency check)
    is_adjacent_session = (df["date_idx"] - grouped["date_idx"].shift(1)) == 1
    df["prev_close"] = grouped["close"].shift(1).where(is_adjacent_session, np.nan)
    df = df.drop(columns=["date_idx"])
    grouped = df.groupby("token")

    df["ret_1d"] = (df["close"] - df["prev_close"]) / df["prev_close"]
    df["advance"] = ((df["close"] > df["prev_close"]) & df["prev_close"].notna()).astype(int)
    df["decline"] = ((df["close"] < df["prev_close"]) & df["prev_close"].notna()).astype(int)
    df["unchanged"] = ((df["close"] == df["prev_close"]) | df["prev_close"].isna()).astype(int)

    # 2. Moving averages (Strict min_periods)
    df["ema_20"] = grouped["close"].transform(lambda s: compute_seeded_ema20(s.values))
    df["sma_50"] = grouped["close"].transform(lambda s: s.rolling(50, min_periods=50).mean())
    df["sma_150"] = grouped["close"].transform(lambda s: s.rolling(150, min_periods=150).mean())
    df["sma_200"] = grouped["close"].transform(lambda s: s.rolling(200, min_periods=200).mean())

    df["above_20ema"] = ((df["close"] > df["ema_20"]) & df["ema_20"].notna()).astype(int)
    df["has_valid_20ema"] = df["ema_20"].notna().astype(int)

    df["above_50sma"] = ((df["close"] > df["sma_50"]) & df["sma_50"].notna()).astype(int)
    df["has_valid_50sma"] = df["sma_50"].notna().astype(int)

    df["above_200sma"] = ((df["close"] > df["sma_200"]) & df["sma_200"].notna()).astype(int)
    df["has_valid_200sma"] = df["sma_200"].notna().astype(int)

    # 3. Highs and Lows (Strict 20 and 252 windows on prior sessions)
    df["high_20d"] = grouped["high"].transform(lambda s: s.shift(1).rolling(20, min_periods=20).max())
    df["low_20d"] = grouped["low"].transform(lambda s: s.shift(1).rolling(20, min_periods=20).min())
    df["is_high_20d"] = ((df["close"] >= df["high_20d"]) & df["high_20d"].notna()).astype(int)
    df["is_low_20d"] = ((df["close"] <= df["low_20d"]) & df["low_20d"].notna()).astype(int)

    df["high_52w"] = grouped["high"].transform(lambda s: s.shift(1).rolling(252, min_periods=252).max())
    df["low_52w"] = grouped["low"].transform(lambda s: s.shift(1).rolling(252, min_periods=252).min())
    df["has_valid_52w"] = df["high_52w"].notna().astype(int)
    df["is_high_52w"] = ((df["close"] >= df["high_52w"]) & df["high_52w"].notna()).astype(int)
    df["is_low_52w"] = ((df["close"] <= df["low_52w"]) & df["low_52w"].notna()).astype(int)

    # 4. 4% Movers and Breakouts (spec 4.4b & 4.5: close >= 20, prior 50d avg vol >= 25000)
    df["vol_sma_50"] = grouped["volume"].transform(lambda s: s.shift(1).rolling(50, min_periods=50).mean())
    is_mover_eligible = (df["close"] >= 20) & (df["vol_sma_50"] >= 25000) & df["prev_close"].notna()
    df["mover_eligible"] = is_mover_eligible.astype(int)
    df["mover_up_4pct"] = (is_mover_eligible & (df["ret_1d"] >= 0.04)).astype(int)
    df["mover_down_4pct"] = (is_mover_eligible & (df["ret_1d"] <= -0.04)).astype(int)

    is_bo_eligible = (df["close"] >= 20) & (df["vol_sma_50"] >= 25000) & df["high_20d"].notna()
    df["breakout_20d"] = (is_bo_eligible & (df["close"] > df["high_20d"]) & (df["volume"] >= 1.5 * df["vol_sma_50"])).astype(int)
    df["breakdown_20d"] = (is_bo_eligible & (df["close"] < df["low_20d"]) & (df["volume"] >= 1.5 * df["vol_sma_50"])).astype(int)

    # 5. Weinstein Stages (Spec 4.6)
    sma_150_prev20 = grouped["sma_150"].shift(20)
    df["sma_150_slope"] = ((df["sma_150"] / sma_150_prev20) - 1.0) * 100.0

    # Compute stages per token
    stage_1_list = []
    stage_2_list = []
    stage_3_list = []
    stage_4_list = []
    stage_unclass_list = []

    for _, group in grouped:
        st_dict = compute_weinstein_stages(
            group["close"].values,
            group["sma_150"].values,
            group["sma_150_slope"].values
        )
        stage_1_list.append(st_dict["stage_1"])
        stage_2_list.append(st_dict["stage_2"])
        stage_3_list.append(st_dict["stage_3"])
        stage_4_list.append(st_dict["stage_4"])
        stage_unclass_list.append(st_dict["stage_unclass"])

    df["stage_1"] = np.concatenate(stage_1_list)
    df["stage_2"] = np.concatenate(stage_2_list)
    df["stage_3"] = np.concatenate(stage_3_list)
    df["stage_4"] = np.concatenate(stage_4_list)
    df["stage_unclass"] = np.concatenate(stage_unclass_list)

    logger.info("Stock indicators computation finished.")
    return df

def get_nifty500_data(conn) -> pd.DataFrame:
    """
    Loads Nifty 500 OHLCV and computes metrics required for Regime & Market Read (spec 4.8).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT trade_date, close
            FROM daily_index_ohlcv
            WHERE index_name = 'NIFTY 500'
            ORDER BY trade_date ASC;
        """)
        rows = cur.fetchall()

    if not rows:
        return pd.DataFrame(columns=["close", "sma_50", "sma_200", "ema_20", "change_pct", "had_20d_low_last_10", "up_last_3"])

    df_n = pd.DataFrame(rows, columns=["trade_date", "close"])
    df_n["trade_date"] = pd.to_datetime(df_n["trade_date"]).dt.strftime("%Y-%m-%d")
    df_n["close"] = df_n["close"].astype(float)
    df_n["sma_50"] = df_n["close"].rolling(50, min_periods=50).mean()
    df_n["sma_200"] = df_n["close"].rolling(200, min_periods=200).mean()
    df_n["ema_20"] = compute_seeded_ema20(df_n["close"].values)

    prev_c = df_n["close"].shift(1)
    df_n["change_pct"] = (df_n["close"] - prev_c) / prev_c * 100.0

    prior_20_low = prev_c.rolling(20, min_periods=20).min()
    is_20d_low = (df_n["close"] <= prior_20_low).astype(int)
    df_n["had_20d_low_last_10"] = is_20d_low.rolling(10, min_periods=1).max() == 1

    c = df_n["close"]
    df_n["up_last_3"] = (c > c.shift(1)) & (c.shift(1) > c.shift(2)) & (c.shift(2) > c.shift(3))

    return df_n.set_index("trade_date")

def compute_breadth_for_universe(
    df_ind: pd.DataFrame,
    universe: str,
    symbols: Optional[Set[str]] = None,
    constituents_df: Optional[pd.DataFrame] = None,
    nifty500_df: Optional[pd.DataFrame] = None,
    dist_days_series: Optional[pd.Series] = None
) -> List[Dict[str, Any]]:
    """
    Aggregates per-stock indicators into daily market breadth metrics for a universe per spec 4.1-4.8.
    """
    if universe not in ("all", "liquid") and symbols is None and (constituents_df is None or constituents_df.empty):
        logger.warning(f"Missing constituents for index universe '{universe}'. Skipping to prevent fallback to all stocks.")
        return []

    if universe == "liquid":
        # Liquid universe: close >= 20 and prior 50-day average volume >= 25,000 (no OR, NaN excluded)
        vol_col = "vol_sma_50" if "vol_sma_50" in df_ind.columns else "volume"
        df_sub = df_ind[(df_ind["close"] >= 20) & (df_ind[vol_col] >= 25000) & df_ind[vol_col].notna()].copy()
    elif constituents_df is not None and not constituents_df.empty:
        # Point-in-time constituent filtering
        merged = pd.merge(df_ind, constituents_df[["symbol", "effective_from", "effective_to"]], on="symbol", how="inner")
        cond_from = merged["effective_from"].isna() | (merged["trade_date"] >= merged["effective_from"])
        cond_to = merged["effective_to"].isna() | (merged["trade_date"] < merged["effective_to"])
        df_sub = merged[cond_from & cond_to].copy()
    elif symbols is not None:
        df_sub = df_ind[df_ind["symbol"].isin(symbols)].copy()
    else:
        df_sub = df_ind.copy()

    if df_sub.empty:
        logger.warning(f"No stock records found for universe: {universe}")
        return []

    grouped_date = df_sub.groupby("trade_date")

    agg_df = pd.DataFrame({
        "advances": grouped_date["advance"].sum(),
        "declines": grouped_date["decline"].sum(),
        "unchanged": grouped_date["unchanged"].sum(),
        "total_active": grouped_date["close"].count(),
        "valid_20ema": grouped_date["has_valid_20ema"].sum(),
        "count_above_20ema": grouped_date["above_20ema"].sum(),
        "valid_50sma": grouped_date["has_valid_50sma"].sum(),
        "count_above_50sma": grouped_date["above_50sma"].sum(),
        "valid_200sma": grouped_date["has_valid_200sma"].sum(),
        "count_above_200sma": grouped_date["above_200sma"].sum(),
        "highs_20d": grouped_date["is_high_20d"].sum(),
        "lows_20d": grouped_date["is_low_20d"].sum(),
        "valid_52w": grouped_date["has_valid_52w"].sum() if "has_valid_52w" in df_sub.columns else 0,
        "highs_52w": grouped_date["is_high_52w"].sum(),
        "lows_52w": grouped_date["is_low_52w"].sum(),
        "valid_movers": grouped_date["mover_eligible"].sum(),
        "movers_up": grouped_date["mover_up_4pct"].sum(),
        "movers_down": grouped_date["mover_down_4pct"].sum(),
        "breakouts_20d": grouped_date["breakout_20d"].sum(),
        "breakdowns_20d": grouped_date["breakdown_20d"].sum(),
        "stage_1_count": grouped_date["stage_1"].sum(),
        "stage_2_count": grouped_date["stage_2"].sum(),
        "stage_3_count": grouped_date["stage_3"].sum(),
        "stage_4_count": grouped_date["stage_4"].sum(),
        "stage_unclass": grouped_date["stage_unclass"].sum(),
    }).sort_index()

    # Spec 4.2: A/D ratios use max(1, declines)
    agg_df["ad_ratio"] = agg_df["advances"] / np.maximum(1, agg_df["declines"])
    adv_20 = agg_df["advances"].rolling(20, min_periods=20).sum()
    dec_20 = agg_df["declines"].rolling(20, min_periods=20).sum()
    agg_df["ad_ratio_20d"] = np.where(dec_20.notna(), adv_20 / np.maximum(1, dec_20), np.nan)

    adv_40 = agg_df["advances"].rolling(40, min_periods=40).sum()
    dec_40 = agg_df["declines"].rolling(40, min_periods=40).sum()
    agg_df["ad_ratio_40d"] = np.where(dec_40.notna(), adv_40 / np.maximum(1, dec_40), np.nan)

    # Spec 4.3: % Above MAs (count with valid window only)
    agg_df["pct_above_20ema"] = np.where(agg_df["valid_20ema"] > 0, (agg_df["count_above_20ema"] / agg_df["valid_20ema"]) * 100.0, np.nan)
    agg_df["pct_above_50sma"] = np.where(agg_df["valid_50sma"] > 0, (agg_df["count_above_50sma"] / agg_df["valid_50sma"]) * 100.0, np.nan)
    agg_df["pct_above_200sma"] = np.where(agg_df["valid_200sma"] > 0, (agg_df["count_above_200sma"] / agg_df["valid_200sma"]) * 100.0, np.nan)

    # Spec 4.4: Highs & Lows net
    agg_df["net_highs_20d"] = agg_df["highs_20d"] - agg_df["lows_20d"]
    agg_df["net_52w"] = np.where(agg_df["valid_52w"] > 0, agg_df["highs_52w"] - agg_df["lows_52w"], np.nan)

    # Spec 4.4b: 4% Movers percentage & ratios
    agg_df["pct_movers_up_4pct"] = np.where(agg_df["valid_movers"] > 0, (agg_df["movers_up"] / agg_df["valid_movers"]) * 100.0, np.nan)
    agg_df["pct_movers_down_4pct"] = np.where(agg_df["valid_movers"] > 0, (agg_df["movers_down"] / agg_df["valid_movers"]) * 100.0, np.nan)

    mup_5 = agg_df["movers_up"].rolling(5, min_periods=5).sum()
    mdown_5 = agg_df["movers_down"].rolling(5, min_periods=5).sum()
    agg_df["movers_ratio_5d"] = np.where(mdown_5.notna(), mup_5 / np.maximum(1, mdown_5), np.nan)

    mup_10 = agg_df["movers_up"].rolling(10, min_periods=10).sum()
    mdown_10 = agg_df["movers_down"].rolling(10, min_periods=10).sum()
    agg_df["movers_ratio_10d"] = np.where(mdown_10.notna(), mup_10 / np.maximum(1, mdown_10), np.nan)

    # Spec 4.6: Weinstein Stage Percentages
    classified_total = agg_df["stage_1_count"] + agg_df["stage_2_count"] + agg_df["stage_3_count"] + agg_df["stage_4_count"]
    agg_df["weinstein_stage_1_pct"] = np.where(classified_total > 0, (agg_df["stage_1_count"] / classified_total) * 100.0, np.nan)
    agg_df["weinstein_stage_2_pct"] = np.where(classified_total > 0, (agg_df["stage_2_count"] / classified_total) * 100.0, np.nan)
    agg_df["weinstein_stage_3_pct"] = np.where(classified_total > 0, (agg_df["stage_3_count"] / classified_total) * 100.0, np.nan)
    agg_df["weinstein_stage_4_pct"] = np.where(classified_total > 0, (agg_df["stage_4_count"] / classified_total) * 100.0, np.nan)

    # Zweig Breadth Thrust: 10-day EMA of Advances / (Advances + Declines)
    total_adv_dec = agg_df["advances"] + agg_df["declines"]
    adv_ratio_raw = np.where(total_adv_dec > 0, agg_df["advances"] / total_adv_dec, 0.5)
    thrust_ema = pd.Series(adv_ratio_raw, index=agg_df.index).ewm(span=10, adjust=False).mean()
    agg_df["breadth_thrust"] = (thrust_ema > 0.615) & (thrust_ema.rolling(10, min_periods=1).min() < 0.40)

    # Spec 4.8 Distribution Sessions (breadth-based: Nifty 500 chg <= -0.5% and declines >= 1.5 * advances)
    if dist_days_series is not None and not dist_days_series.empty:
        agg_df["distribution_days"] = agg_df.index.map(lambda d: int(dist_days_series.get(d, 0)))
    elif nifty500_df is not None and not nifty500_df.empty:
        n_chg = agg_df.index.map(lambda d: nifty500_df.loc[d, "change_pct"] if d in nifty500_df.index else 0.0)
        is_dist = (n_chg <= -0.5) & (agg_df["declines"] >= 1.5 * agg_df["advances"])
        agg_df["distribution_days"] = is_dist.astype(int).rolling(10, min_periods=1).sum().astype(int)
    else:
        agg_df["distribution_days"] = 0

    records = []
    for trade_date, row in agg_df.iterrows():
        # Spec 4.8: Regime & 6 Market Read indicators
        regime = "MARKET_CORRECTION"
        read_indicators = []

        if nifty500_df is not None and trade_date in nifty500_df.index:
            n_row = nifty500_df.loc[trade_date]
            n_close = float(n_row["close"])
            n_sma50 = float(n_row["sma_50"]) if pd.notna(n_row["sma_50"]) else None
            n_sma200 = float(n_row["sma_200"]) if pd.notna(n_row["sma_200"]) else None
            n_ema20 = float(n_row["ema_20"]) if pd.notna(n_row["ema_20"]) else None
            had_20d_low = bool(n_row["had_20d_low_last_10"])
            up_3 = bool(n_row["up_last_3"])

            b50 = row["pct_above_50sma"]
            valid_52w = int(row["valid_52w"]) if "valid_52w" in row and pd.notna(row["valid_52w"]) else 0
            h52 = int(row["highs_52w"]) if pd.notna(row["highs_52w"]) and valid_52w > 0 else None
            l52 = int(row["lows_52w"]) if pd.notna(row["lows_52w"]) and valid_52w > 0 else None
            nh52 = int(row["net_52w"]) if pd.notna(row["net_52w"]) and valid_52w > 0 else None
            dist10 = int(row["distribution_days"])
            ad20 = row["ad_ratio_20d"]

            # Regime (first match wins):
            if (n_sma50 and n_ema20 and n_close > n_sma50 and n_close > n_ema20 and
                pd.notna(b50) and b50 >= 50 and nh52 is not None and nh52 > 0 and dist10 < 3):
                regime = "CONFIRMED_UPTREND"
            elif n_sma50 and n_close > n_sma50:
                regime = "UPTREND_UNDER_PRESSURE"
            elif (n_sma50 and n_close <= n_sma50 and had_20d_low and up_3):
                regime = "RALLY_ATTEMPT"
            else:
                regime = "MARKET_CORRECTION"

            # 6 Market Read indicators
            # 1. long_term: N >= SMA200 Positive, else Negative
            lt_status = "Positive" if (n_sma200 and n_close >= n_sma200) else "Negative"
            read_indicators.append({
                "id": "long_term",
                "status": lt_status,
                "value": round(n_close - n_sma200, 2) if n_sma200 else None
            })

            # 2. medium_term: N >= SMA50 Positive, else Negative
            mt_status = "Positive" if (n_sma50 and n_close >= n_sma50) else "Negative"
            read_indicators.append({
                "id": "medium_term",
                "status": mt_status,
                "value": round(n_close - n_sma50, 2) if n_sma50 else None
            })

            # 3. short_term: N >= EMA20 Positive, else Negative
            st_status = "Positive" if (n_ema20 and n_close >= n_ema20) else "Negative"
            read_indicators.append({
                "id": "short_term",
                "status": st_status,
                "value": round(n_close - n_ema20, 2) if n_ema20 else None
            })

            # 4. ad_momentum: ad_ratio_20d >= 1.05 Positive, <= 0.95 Negative, else Neutral
            if pd.notna(ad20):
                adm_status = "Positive" if ad20 >= 1.05 else ("Negative" if ad20 <= 0.95 else "Neutral")
            else:
                adm_status = "Neutral"
            read_indicators.append({
                "id": "ad_momentum",
                "status": adm_status,
                "value": round(float(ad20), 4) if pd.notna(ad20) else None
            })

            # 5. highs_vs_lows: highs_52w > lows_52w Positive, < Negative, equal Neutral
            if h52 is not None and l52 is not None:
                hvl_status = "Positive" if h52 > l52 else ("Negative" if h52 < l52 else "Neutral")
            else:
                hvl_status = "Neutral"
            read_indicators.append({
                "id": "highs_vs_lows",
                "status": hvl_status,
                "value": nh52
            })

            # 6. participation: B50 >= 50 Positive, 40 <= B50 < 50 Neutral, < 40 Negative
            if pd.notna(b50):
                part_status = "Positive" if b50 >= 50 else ("Neutral" if b50 >= 40 else "Negative")
            else:
                part_status = "Negative"
            read_indicators.append({
                "id": "participation",
                "status": part_status,
                "value": round(float(b50), 2) if pd.notna(b50) else None
            })

        valid_52w_val = int(row["valid_52w"]) if "valid_52w" in row and pd.notna(row["valid_52w"]) else 0
        h52_val = int(row["highs_52w"]) if pd.notna(row["highs_52w"]) and valid_52w_val > 0 else None
        l52_val = int(row["lows_52w"]) if pd.notna(row["lows_52w"]) and valid_52w_val > 0 else None
        nh52_val = int(row["net_52w"]) if pd.notna(row["net_52w"]) and valid_52w_val > 0 else None

        records.append({
            "trade_date": trade_date,
            "universe": universe,
            "advances": int(row["advances"]),
            "declines": int(row["declines"]),
            "unchanged": int(row["unchanged"]),
            "ad_ratio": round(float(row["ad_ratio"]), 4) if pd.notna(row["ad_ratio"]) else None,
            "ad_ratio_20d": round(float(row["ad_ratio_20d"]), 4) if pd.notna(row["ad_ratio_20d"]) else None,
            "ad_ratio_40d": round(float(row["ad_ratio_40d"]), 4) if pd.notna(row["ad_ratio_40d"]) else None,
            "ad_line": None, # Spec 4.2 / 8: Stop storing ad_line. Computed in API from window start.
            "pct_above_20ema": round(float(row["pct_above_20ema"]), 2) if pd.notna(row["pct_above_20ema"]) else None,
            "pct_above_50sma": round(float(row["pct_above_50sma"]), 2) if pd.notna(row["pct_above_50sma"]) else None,
            "pct_above_200sma": round(float(row["pct_above_200sma"]), 2) if pd.notna(row["pct_above_200sma"]) else None,
            "highs_20d": int(row["highs_20d"]),
            "lows_20d": int(row["lows_20d"]),
            "net_highs_20d": int(row["net_highs_20d"]),
            "highs_52w": h52_val,
            "lows_52w": l52_val,
            "net_52w": nh52_val,
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
            "regime": regime,
            "regime_score": None, # Spec 4.8 / 5: Deleted invented 40/30/30 score
            "distribution_days": int(row["distribution_days"]),
            "breadth_thrust": bool(row["breadth_thrust"]),
            "total_stocks": int(row["total_active"]),
            "stage_1_count": int(row["stage_1_count"]),
            "stage_2_count": int(row["stage_2_count"]),
            "stage_3_count": int(row["stage_3_count"]),
            "stage_4_count": int(row["stage_4_count"]),
            "stage_unclassified": int(row["stage_unclass"]),
            "movers_up_count": int(row["movers_up"]),
            "movers_down_count": int(row["movers_down"]),
            "read_indicators": json.dumps(read_indicators) if read_indicators else None,
            "definitions_version": "2.0",
        })

    logger.info(f"Computed {len(records)} breadth rows for universe {universe}.")
    return records

def compute_and_publish_all(parquet_path: str = EQUITY_PARQUET_PATH) -> bool:
    """
    Main computation runner:
    1. Loads equity candles from parquet.
    2. Computes per-stock technical indicators with spec 4.6 & strict min_periods.
    3. Loads index constituents and Nifty 500 index data from Neon PostgreSQL.
    4. Computes daily market breadth for each universe.
    5. Applies the 252-session publish floor (no zero rows from partial windows).
    6. Upserts into `daily_market_breadth` table in Neon PostgreSQL.
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
        # Load constituents with versioning (effective_from, effective_to)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT index_name, symbol, effective_from, effective_to
                FROM index_constituents;
            """)
            const_rows = cur.fetchall()

        const_df_all = pd.DataFrame(
            const_rows, columns=["index_name", "symbol", "effective_from", "effective_to"]
        )
        if not const_df_all.empty:
            const_df_all["effective_from"] = pd.to_datetime(const_df_all["effective_from"]).dt.strftime("%Y-%m-%d")
            const_df_all["effective_to"] = pd.to_datetime(const_df_all["effective_to"]).dt.strftime("%Y-%m-%d")

        nifty500_df = get_nifty500_data(conn)

        # Spec 4.12 / 7: Publish breadth rows only for dates at least 252 sessions after history start
        all_trade_dates = sorted(df_ind["trade_date"].unique())
        publish_floor_date = all_trade_dates[252] if len(all_trade_dates) >= 253 else all_trade_dates[0]
        logger.info(f"Publish floor date: {publish_floor_date} (sessions total: {len(all_trade_dates)}).")

        all_breadth_records = []
        for universe in UNIVERSES:
            if universe in ("all", "liquid"):
                u_const_df = None
            else:
                if const_df_all.empty:
                    logger.warning(f"No constituents found in database for universe '{universe}'. Skipping.")
                    continue
                u_const_df = const_df_all[const_df_all["index_name"] == universe]
                if u_const_df.empty:
                    logger.warning(f"No constituents found in database for universe '{universe}'. Skipping.")
                    continue

            records = compute_breadth_for_universe(
                df_ind=df_ind,
                universe=universe,
                symbols=None,
                constituents_df=u_const_df,
                nifty500_df=nifty500_df
            )
            # Filter rows by 252-session publish floor
            filtered_records = [r for r in records if r["trade_date"] >= publish_floor_date]
            all_breadth_records.extend(filtered_records)

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
            regime, regime_score, distribution_days, breadth_thrust,
            total_stocks, stage_1_count, stage_2_count, stage_3_count, stage_4_count, stage_unclassified,
            movers_up_count, movers_down_count, read_indicators, definitions_version
        ) VALUES (
            %(trade_date)s, %(universe)s, %(advances)s, %(declines)s, %(unchanged)s,
            %(ad_ratio)s, %(ad_ratio_20d)s, %(ad_ratio_40d)s, %(ad_line)s,
            %(pct_above_20ema)s, %(pct_above_50sma)s, %(pct_above_200sma)s,
            %(highs_20d)s, %(lows_20d)s, %(net_highs_20d)s, %(highs_52w)s, %(lows_52w)s, %(net_52w)s,
            %(pct_movers_up_4pct)s, %(pct_movers_down_4pct)s, %(movers_ratio_5d)s, %(movers_ratio_10d)s,
            %(breakouts_20d)s, %(breakdowns_20d)s,
            %(weinstein_stage_1_pct)s, %(weinstein_stage_2_pct)s, %(weinstein_stage_3_pct)s, %(weinstein_stage_4_pct)s,
            %(regime)s, %(regime_score)s, %(distribution_days)s, %(breadth_thrust)s,
            %(total_stocks)s, %(stage_1_count)s, %(stage_2_count)s, %(stage_3_count)s, %(stage_4_count)s, %(stage_unclassified)s,
            %(movers_up_count)s, %(movers_down_count)s, %(read_indicators)s, %(definitions_version)s
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
            breadth_thrust = EXCLUDED.breadth_thrust,
            total_stocks = EXCLUDED.total_stocks,
            stage_1_count = EXCLUDED.stage_1_count,
            stage_2_count = EXCLUDED.stage_2_count,
            stage_3_count = EXCLUDED.stage_3_count,
            stage_4_count = EXCLUDED.stage_4_count,
            stage_unclassified = EXCLUDED.stage_unclassified,
            movers_up_count = EXCLUDED.movers_up_count,
            movers_down_count = EXCLUDED.movers_down_count,
            read_indicators = EXCLUDED.read_indicators,
            definitions_version = EXCLUDED.definitions_version;
        """

        with conn.cursor() as cur:
            execute_batch(cur, insert_sql, all_breadth_records, page_size=1000)
        conn.commit()
        logger.info(f"Successfully published {len(all_breadth_records)} rows to daily_market_breadth.")

        # Trigger screener calculation for the latest trade date
        try:
            from pipeline.screeners import run_screeners
            latest_date = max(all_trade_dates)
            logger.info(f"Triggering screeners for latest trade date: {latest_date}...")
            screener_res = run_screeners(df_ind, target_date=latest_date, conn=conn)
            logger.info(f"Screener execution finished for {latest_date}: {screener_res.get('counts')}")
        except Exception as se:
            logger.error(f"Screener execution encountered an error: {se}", exc_info=True)
            try:
                from pipeline.alerts import send_telegram_alert
                send_telegram_alert(f"⚠️ Screener run failed for {max(all_trade_dates)}: {se}")
            except Exception:
                pass

        return True
    finally:
        conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    compute_and_publish_all()
