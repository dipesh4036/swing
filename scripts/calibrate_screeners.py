#!/usr/bin/env python3
"""
scripts/calibrate_screeners.py

Offline screener calibration script (no credentials required).
Reads equity_ohlcv.parquet, executes the updated screener rules on the latest available session,
and compares candidates against ground truth ScanTheCharts symbols.

Prints:
1. For each symbol in ScanTheCharts list: PASS, or FIRST failing rule (actual value vs threshold)
2. Total count per screener
3. 5 sample symbols that pass our screener but are not in the ScanTheCharts list
"""

import sys
import os
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd

# Add repo root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.compute import compute_stock_indicators
from pipeline.screeners import (
    SCREENER_PARAMS,
    to_date,
    compute_screener_indicators,
    calculate_rs_rank,
    evaluate_trend_template,
    eval_stage2_breakout,
    eval_vcp,
    eval_near_pivot,
    eval_ipo_base,
    eval_ema50_pullback,
    find_zigzag_swings,
)

TARGET_SYMBOLS = {
    "IPO Base": [
        "FUSIONCX", "AONESTEELS", "SMT", "BLSPOLY", "JPL", "KNACK", "VEEGALAND"
    ],
    "VCP": [
        "VSSL", "KROSS", "GOODLUCK", "GNA", "SANATHAN", "SKYGOLD", "BHAGERIA",
        "MGEL", "IOLCP", "JSWINFRA", "BHEL", "ENGINERSIN", "DOLPHIN", "DELTACORP", "AETHER"
    ],
    "Stage 2 Breakout": [
        "ALICON", "SRD", "GCSL", "ESAFSFB", "ANURAS", "APOLLO", "SURYODAY",
        "SBIN", "HDFCLIFE", "NAVINFLUOR"
    ],
    "Near Pivot": [
        "SHALPAINTS", "DVL", "MMFL", "ATL", "SANSERA", "DCBBANK", "GROWW",
        "APLAPOLLO", "GLFL", "PDSL", "CHEMBOND"
    ]
}


def explain_ipo_base_failure(row, hist, cutoff_date, params):
    p_ipo = params["ipo_base"]
    p_trad = params["tradability"]
    first_date = row.get("first_candle_date")
    if not first_date:
        return "first_candle_date missing"

    first_date_val = to_date(first_date)
    target_date_val = to_date(row["trade_date"])
    listing_age_days = (target_date_val - first_date_val).days
    hist_len = len(hist)

    if listing_age_days > p_ipo["max_listing_age_days"]:
        return f"listing_age_days ({listing_age_days}) > {p_ipo['max_listing_age_days']}d"
    if hist_len < p_ipo["min_listing_sessions"]:
        return f"sessions ({hist_len}) < {p_ipo['min_listing_sessions']}"
    if first_date_val <= cutoff_date:
        return f"not real listing (first_date {first_date_val} <= cutoff {cutoff_date})"

    close = float(row["close"])
    if close < p_trad["min_close"]:
        return f"close ({close:.2f}) < min_close ({p_trad['min_close']})"

    recent_n = min(hist_len, p_ipo.get("avg_vol_window", 50))
    avg_vol = float(hist["volume"].iloc[-recent_n:].mean())
    if avg_vol < p_ipo["min_avg_volume"]:
        return f"avg_vol ({avg_vol:.0f}) < {p_ipo['min_avg_volume']}"
    if (avg_vol * close) < p_trad["min_traded_value"]:
        return f"traded_value ({(avg_vol*close)/1e7:.2f} Cr) < 1.00 Cr"

    if hist_len < 2:
        return "insufficient history (< 2 sessions)"
    prior_hist = hist.iloc[:-1]
    base_top = float(prior_hist["high"].max())
    base_top_idx = prior_hist["high"].idxmax()

    if close > base_top:
        return f"broken out (close {close:.2f} > base_top {base_top:.2f})"

    atr_pct = float(row["atr_pct"]) if pd.notna(row.get("atr_pct")) and float(row.get("atr_pct")) > 0 else 0.03
    dist_top = (base_top - close) / close
    max_dist = p_ipo.get("k_atr", 2.0) * atr_pct
    if dist_top > max_dist:
        return f"too far under top (dist {dist_top*100:.1f}% > {max_dist*100:.1f}% [{p_ipo['k_atr']}*ATR])"

    post_top = hist.loc[base_top_idx:]
    lowest_low = float(post_top["low"].min())
    base_depth = (base_top - lowest_low) / base_top
    if base_depth > p_ipo["max_base_depth"]:
        return f"base_depth ({base_depth*100:.1f}%) > {p_ipo['max_base_depth']*100:.1f}%"

    sessions_since_top = len(post_top) - 1
    if sessions_since_top < p_ipo.get("min_sessions_since_base_top", 5):
        return f"sessions_since_base_top ({sessions_since_top}) < {p_ipo['min_sessions_since_base_top']}"

    return "Unknown"


def explain_vcp_failure(row, hist, params):
    p_vcp = params["vcp"]
    if p_vcp.get("require_tt", True) and not bool(row.get("tt_pass", False)):
        # Explain why TT failed
        close = row.get("close")
        sma_50 = row.get("sma_50")
        sma_150 = row.get("sma_150")
        sma_200 = row.get("sma_200")
        rs_rank = row.get("rs_rank")
        if pd.isna(rs_rank) or rs_rank < 70:
            return f"TT fail: rs_rank ({rs_rank}) < 70"
        if close <= sma_50:
            return f"TT fail: close ({close:.1f}) <= sma_50 ({sma_50:.1f})"
        if sma_50 <= sma_150:
            return f"TT fail: sma_50 ({sma_50:.1f}) <= sma_150 ({sma_150:.1f})"
        if sma_150 <= sma_200:
            return f"TT fail: sma_150 ({sma_150:.1f}) <= sma_200 ({sma_200:.1f})"
        return "TT fail (trend template not met)"

    close = float(row["close"])
    n_hist = len(hist)
    if n_hist < p_vcp.get("min_base_length", 15):
        return f"history ({n_hist}) < min_base_length ({p_vcp['min_base_length']})"

    max_win = p_vcp.get("max_window_sessions", 120)
    win_slice = hist.iloc[-max_win:]
    highs = win_slice["high"].values.astype(np.float64)
    lows = win_slice["low"].values.astype(np.float64)
    dates = [str(d) for d in win_slice["trade_date"].values]

    swings = find_zigzag_swings(highs, lows, dates, min_pct=p_vcp.get("zigzag_min_pct", 0.04))
    if len(swings) < 4:
        return f"zigzag swings ({len(swings)}) < 4 (no multi-swing contractions)"

    all_contractions = []
    for i in range(len(swings) - 1):
        if swings[i][0] == "H" and swings[i + 1][0] == "L":
            h_val = float(swings[i][2])
            l_val = float(swings[i + 1][2])
            depth = (h_val - l_val) / h_val if h_val > 0 else 0.0
            all_contractions.append(depth)

    if len(all_contractions) < p_vcp.get("min_contractions", 2):
        return f"contractions ({len(all_contractions)}) < {p_vcp['min_contractions']}"

    # Check why contraction sequence failed
    last_d = all_contractions[-1]
    if last_d > p_vcp.get("max_last_depth", 0.10):
        return f"last contraction depth ({last_d*100:.1f}%) > {p_vcp['max_last_depth']*100:.1f}%"

    return "zigzag contractions non-decreasing or pivot range exceeded"


def explain_stage2_breakout_failure(row, hist, params):
    p_s2 = params["stage2_breakout"]
    if p_s2.get("require_tt", True) and not bool(row.get("tt_pass", False)):
        rs_rank = row.get("rs_rank")
        if pd.isna(rs_rank) or rs_rank < 70:
            return f"TT fail: rs_rank ({rs_rank}) < 70"
        return "TT fail (trend template not met)"

    if int(row.get("stage_2", 0)) != 1:
        return f"not in stage 2 (stage_2 == {row.get('stage_2')})"

    recency = p_s2.get("recency_sessions", 3)
    n_hist = len(hist)

    breakout_seen = False
    for days_ago in range(min(recency, n_hist)):
        b_row = hist.iloc[-1 - days_ago]
        if int(b_row.get("breakout_20d", 0)) == 1:
            breakout_seen = True
            b_vol = float(b_row["volume"])
            b_vol_50 = float(b_row["vol_sma_50"]) if pd.notna(b_row.get("vol_sma_50")) else 1.0
            vol_r = b_vol / max(1.0, b_vol_50)
            if vol_r < p_s2["min_volume_ratio"]:
                return f"breakout vol_ratio ({vol_r:.2f}x) < {p_s2['min_volume_ratio']}x"

            b_pivot = float(b_row["high_20d"]) if pd.notna(b_row.get("high_20d")) else 0
            today_close = float(row["close"])
            if today_close < b_pivot:
                return f"close ({today_close:.2f}) slipped below pivot ({b_pivot:.2f})"
            if today_close > p_s2["max_extension_factor"] * b_pivot:
                return f"close ({today_close:.2f}) extended > 1.05 * pivot ({b_pivot:.2f})"

    if not breakout_seen:
        return f"no 20d breakout in last {recency} sessions"

    return "breakout criteria threshold not met"


def explain_near_pivot_failure(row, hist, params):
    p_np = params["near_pivot"]
    if p_np.get("require_tt", True) and not bool(row.get("tt_pass", False)):
        rs_rank = row.get("rs_rank")
        if pd.isna(rs_rank) or rs_rank < 70:
            return f"TT fail: rs_rank ({rs_rank}) < 70"
        return "TT fail (trend template not met)"

    pivot = float(row["pivot_20"]) if pd.notna(row.get("pivot_20")) else 0
    close = float(row["close"])
    if pivot <= 0:
        return "pivot_20 missing"

    atr_pct = float(row["atr_pct"]) if pd.notna(row.get("atr_pct")) and float(row.get("atr_pct")) > 0 else 0.03
    max_dist = p_np.get("k_atr", 1.0) * atr_pct
    dist = (pivot - close) / close

    if dist < 0:
        return f"close ({close:.2f}) > pivot ({pivot:.2f}) [already above]"
    if dist > max_dist:
        return f"dist to pivot ({dist*100:.1f}%) > {max_dist*100:.1f}% [1.0*ATR]"

    return "near pivot criteria not met"


def main():
    print("======================================================================")
    print("SCREENER CALIBRATION — ScanTheCharts vs Antigravity")
    print("======================================================================")

    data_path = Path("data/equity_ohlcv.parquet")
    if not data_path.exists():
        print("data/equity_ohlcv.parquet not found.")
        sys.exit(1)

    print(f"Loading {data_path}...")
    df = pd.read_parquet(data_path)
    print(f"Loaded {len(df)} rows across {df['token'].nunique()} tokens.")

    # Compute indicators
    print("Computing base stock indicators (SMAs, Weinstein stages, 20d breakouts)...")
    df = compute_stock_indicators(df)
    print("Computing screener indicators (EMAs, ATR(14), RS raw)...")
    df = compute_screener_indicators(df)

    latest_date = df["trade_date"].apply(to_date).max()
    print(f"Latest trade date in store: {latest_date}\n")

    df_latest_hist = df[df["trade_date"].apply(to_date) <= latest_date].copy()
    df_latest = df_latest_hist[df_latest_hist["trade_date"].apply(to_date) == latest_date].copy()

    # Precompute tradability and RS rank
    p_trad = SCREENER_PARAMS["tradability"]
    tradable_mask = (
        (df_latest["close"] >= p_trad["min_close"]) &
        (df_latest["vol_sma_50"] >= p_trad["min_vol_sma_50"]) &
        ((df_latest["close"] * df_latest["vol_sma_50"]) >= p_trad["min_traded_value"]) &
        (df_latest["session_idx"] >= p_trad["min_history_sessions"])
    )
    df_latest["rs_rank"] = calculate_rs_rank(df_latest, tradable_mask)
    df_latest["tt_pass"] = df_latest.apply(lambda row: evaluate_trend_template(row, SCREENER_PARAMS), axis=1)

    all_dates_sorted = df["trade_date"].apply(to_date).drop_duplicates().sort_values().tolist()
    earliest_session_idx = SCREENER_PARAMS["ipo_base"]["earliest_store_session_idx"]
    earliest_cutoff_date = all_dates_sorted[min(earliest_session_idx, len(all_dates_sorted) - 1)]

    # Group history by token
    hist_by_token = {tok: g.sort_values(by="trade_date") for tok, g in df_latest_hist.groupby("token")}
    sym_to_token = {str(row["symbol"]).upper(): int(row["token"]) for _, row in df_latest.iterrows()}

    # Run evaluations
    passing_symbols = {
        "IPO Base": set(),
        "VCP": set(),
        "Stage 2 Breakout": set(),
        "Near Pivot": set(),
        "50 EMA Pullback": set(),
    }

    for _, row in df_latest.iterrows():
        tok = int(row["token"])
        sym = str(row["symbol"]).upper()
        h = hist_by_token.get(tok)
        if h is None or h.empty:
            continue

        if eval_ipo_base(row, h, earliest_cutoff_date, SCREENER_PARAMS):
            passing_symbols["IPO Base"].add(sym)
        if eval_vcp(row, h, SCREENER_PARAMS):
            passing_symbols["VCP"].add(sym)
        if eval_stage2_breakout(row, h, SCREENER_PARAMS):
            passing_symbols["Stage 2 Breakout"].add(sym)
        if eval_near_pivot(row, h, SCREENER_PARAMS):
            passing_symbols["Near Pivot"].add(sym)
        if eval_ema50_pullback(row, h, SCREENER_PARAMS):
            passing_symbols["50 EMA Pullback"].add(sym)

    # Output per screener
    for screener_name, target_syms in TARGET_SYMBOLS.items():
        print("----------------------------------------------------------------------")
        print(f"SCREENER: {screener_name}")
        print(f"Our Total Pass Count: {len(passing_symbols[screener_name])}")
        print("ScanTheCharts Benchmark Symbols:")

        for sym in target_syms:
            if sym in passing_symbols[screener_name]:
                print(f"  {sym:<12} -> PASS")
            else:
                tok = sym_to_token.get(sym)
                if tok is None:
                    print(f"  {sym:<12} -> NOT IN STORE")
                else:
                    row = df_latest[df_latest["token"] == tok].iloc[0]
                    h = hist_by_token[tok]
                    if screener_name == "IPO Base":
                        reason = explain_ipo_base_failure(row, h, earliest_cutoff_date, SCREENER_PARAMS)
                    elif screener_name == "VCP":
                        reason = explain_vcp_failure(row, h, SCREENER_PARAMS)
                    elif screener_name == "Stage 2 Breakout":
                        reason = explain_stage2_breakout_failure(row, h, SCREENER_PARAMS)
                    elif screener_name == "Near Pivot":
                        reason = explain_near_pivot_failure(row, h, SCREENER_PARAMS)
                    else:
                        reason = "Criteria not met"
                    print(f"  {sym:<12} -> FAILED: {reason}")

        # 5 passing symbols not in benchmark list
        diff = sorted(list(passing_symbols[screener_name] - set(target_syms)))
        sample_diff = diff[:5]
        print(f"Sample 5 Our Stocks Not In ScanTheCharts List: {', '.join(sample_diff) if sample_diff else 'None'}\n")


if __name__ == "__main__":
    main()
