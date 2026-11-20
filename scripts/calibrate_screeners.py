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

REFERENCE_IPOS = [
    "KPL", "FREDUN", "AONESTEELS", "SYMBIOTEC", "BONFIG", "MEESHO", "SHUKRAPHAR",
    "TIMEX", "SUNSHINE", "KHAZANCHI", "SMT", "KNACK", "VEEGALAND", "AEROPLANE",
    "MOMSBELIEF", "TGVSL", "DHOOTTRANS", "MOLBIO", "MILKYMIST", "ZETWERK",
    "KSHINTL", "FUSIONCX", "RENTOMOJO", "PARASHLTH", "MONEYVIEW", "MMWL", "SINGERIND"
]

TARGET_SYMBOLS = {
    "IPO Base": REFERENCE_IPOS,
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

    atr_med_val = row.get("atr_med_pct")
    if pd.isna(atr_med_val) or float(atr_med_val) <= 0:
        return "atr_med_pct missing or <= 0"
    atr_med_pct = float(atr_med_val)
    dist_top = (base_top - close) / close
    max_dist = min(p_ipo.get("k_atr", 3.0) * atr_med_pct, p_ipo.get("max_dist_pct", 0.15))
    if dist_top > max_dist:
        return f"too far under top (dist {dist_top*100:.1f}% > {max_dist*100:.1f}% [min({p_ipo['k_atr']}*ATR_med, {p_ipo['max_dist_pct']*100:.0f}%)])"
    if dist_top < 0:
        return f"broken out (dist {dist_top*100:.1f}% < 0)"

    post_top = hist.loc[base_top_idx:]
    lowest_low = float(post_top["low"].min())
    base_depth = (base_top - lowest_low) / base_top if base_top > 0 else 1.0
    if base_depth > p_ipo["max_base_depth"]:
        return f"base_depth ({base_depth*100:.1f}%) > {p_ipo['max_base_depth']*100:.1f}%"

    sessions_since_top = len(post_top) - 1
    if sessions_since_top < p_ipo.get("min_sessions_since_base_top", 2):
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
    print("SCREENER CALIBRATION — Last 10 Trading Dates & Reference IPOs")
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
    print("Computing screener indicators (EMAs, ATR(14), Median ATR(20), RS raw)...")
    df = compute_screener_indicators(df)

    all_dates_sorted = df["trade_date"].apply(to_date).drop_duplicates().sort_values().tolist()
    earliest_session_idx = SCREENER_PARAMS["ipo_base"]["earliest_store_session_idx"]
    earliest_cutoff_date = all_dates_sorted[min(earliest_session_idx, len(all_dates_sorted) - 1)]

    last_10_dates = all_dates_sorted[-10:]
    print(f"Evaluating across last 10 dates: {[str(d) for d in last_10_dates]}\n")

    per_date_counts = []
    latest_passing_symbols = {}
    latest_eval_details = {}

    p_trad = SCREENER_PARAMS["tradability"]
    max_ipo_cap = SCREENER_PARAMS["ipo_base"].get("max_results", 40)

    for eval_date in last_10_dates:
        df_hist = df[df["trade_date"].apply(to_date) <= eval_date].copy()
        df_day = df_hist[df_hist["trade_date"].apply(to_date) == eval_date].copy()

        tradable_mask = (
            (df_day["close"] >= p_trad["min_close"]) &
            (df_day["vol_sma_50"] >= p_trad["min_vol_sma_50"]) &
            ((df_day["close"] * df_day["vol_sma_50"]) >= p_trad["min_traded_value"]) &
            (df_day["session_idx"] >= p_trad["min_history_sessions"])
        )
        df_day["rs_rank"] = calculate_rs_rank(df_day, tradable_mask)
        df_day["tt_pass"] = df_day.apply(lambda row: evaluate_trend_template(row, SCREENER_PARAMS), axis=1)

        hist_by_token = {tok: g.sort_values(by="trade_date") for tok, g in df_hist.groupby("token")}

        day_candidates = {
            "ipo_base": [],
            "stage2_breakout": [],
            "vcp": [],
            "near_pivot": [],
            "ema50_pullback": [],
        }

        for _, row in df_day.iterrows():
            tok = int(row["token"])
            sym = str(row["symbol"]).upper()
            h = hist_by_token.get(tok)
            if h is None or h.empty:
                continue

            res_ipo = eval_ipo_base(row, h, earliest_cutoff_date, SCREENER_PARAMS)
            if res_ipo:
                day_candidates["ipo_base"].append({"sym": sym, "dist": res_ipo["dist_to_pivot_pct"]})
            if eval_stage2_breakout(row, h, SCREENER_PARAMS):
                day_candidates["stage2_breakout"].append(sym)
            if eval_vcp(row, h, SCREENER_PARAMS):
                day_candidates["vcp"].append(sym)
            if eval_near_pivot(row, h, SCREENER_PARAMS):
                day_candidates["near_pivot"].append(sym)
            if eval_ema50_pullback(row, h, SCREENER_PARAMS):
                day_candidates["ema50_pullback"].append(sym)

        # Apply ipo_base sort & cap
        day_candidates["ipo_base"].sort(key=lambda x: x["dist"])
        uncapped_ipo = len(day_candidates["ipo_base"])
        day_candidates["ipo_base"] = day_candidates["ipo_base"][:max_ipo_cap]

        counts_row = {
            "date": str(eval_date),
            "ipo_base": len(day_candidates["ipo_base"]),
            "ipo_base_uncapped": uncapped_ipo,
            "stage2_breakout": len(day_candidates["stage2_breakout"]),
            "vcp": len(day_candidates["vcp"]),
            "near_pivot": len(day_candidates["near_pivot"]),
            "ema50_pullback": len(day_candidates["ema50_pullback"]),
        }
        per_date_counts.append(counts_row)

        if eval_date == last_10_dates[-1]:
            latest_passing_symbols = {
                "IPO Base": {c["sym"] for c in day_candidates["ipo_base"]},
                "Stage 2 Breakout": set(day_candidates["stage2_breakout"]),
                "VCP": set(day_candidates["vcp"]),
                "Near Pivot": set(day_candidates["near_pivot"]),
                "50 EMA Pullback": set(day_candidates["ema50_pullback"]),
            }
            latest_eval_details = {
                "df_day": df_day,
                "hist_by_token": hist_by_token,
                "sym_to_token": {str(row["symbol"]).upper(): int(row["token"]) for _, row in df_day.iterrows()}
            }

    # Print 10-date table
    print("-----------------------------------------------------------------------------------------")
    print(f"{'Date':<12} | {'IPO Base':<10} | {'Stage 2 BO':<10} | {'VCP':<8} | {'Near Pivot':<10} | {'50 EMA PB':<10}")
    print("-----------------------------------------------------------------------------------------")
    for cr in per_date_counts:
        print(f"{cr['date']:<12} | {cr['ipo_base']:<10} | {cr['stage2_breakout']:<10} | {cr['vcp']:<8} | {cr['near_pivot']:<10} | {cr['ema50_pullback']:<10}")
    print("-----------------------------------------------------------------------------------------\n")

    # Evaluate 27 reference IPOs on latest date
    print(f"Latest Date ({last_10_dates[-1]}) Reference IPO Evaluation (27 stocks):")
    print("----------------------------------------------------------------------")
    sym_to_token = latest_eval_details["sym_to_token"]
    df_day = latest_eval_details["df_day"]
    hist_by_token = latest_eval_details["hist_by_token"]

    ipo_pass_set = latest_passing_symbols["IPO Base"]
    for sym in REFERENCE_IPOS:
        if sym in ipo_pass_set:
            print(f"  {sym:<12} -> PASS")
        else:
            tok = sym_to_token.get(sym)
            if tok is None:
                print(f"  {sym:<12} -> NOT IN STORE")
            else:
                row = df_day[df_day["token"] == tok].iloc[0]
                h = hist_by_token[tok]
                reason = explain_ipo_base_failure(row, h, earliest_cutoff_date, SCREENER_PARAMS)
                print(f"  {sym:<12} -> FAILED: {reason}")


if __name__ == "__main__":
    main()
