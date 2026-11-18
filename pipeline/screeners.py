import logging
import json
from datetime import datetime, date
from typing import Dict, Any, List, Optional, Set
import numpy as np
import pandas as pd
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.screeners")

# Single source of truth for all screener parameters per spec
SCREENER_PARAMS = {
    "tradability": {
        "min_close": 20.0,
        "min_vol_sma_50": 25000,
        "min_traded_value": 1e7,  # 1 crore INR (close * vol_sma_50 or close * avg_vol)
        "min_history_sessions": 252,
    },
    "trend_template": {
        "min_rs_rank": 70,
        "low_52w_factor": 1.30,   # close >= 1.30 * low_52w_incl
        "high_52w_factor": 0.75,  # close >= 0.75 * high_52w_incl
        "sma200_slope_sessions": 21,
    },
    "stage2_breakout": {
        "pivot_window": 20,
        "recency_sessions": 3,         # 0, 1, or 2 sessions ago
        "max_extension_factor": 1.05,  # close <= 1.05 * pivot
        "min_close_range_ratio": 0.6,  # (close - low) / (high - low) >= 0.6
        "min_volume_ratio": 1.5,       # volume >= 1.5 * vol_sma_50
        "require_tt": True,
    },
    "vcp": {
        "zigzag_min_pct": 0.04,        # 4% swing moves for peaks and troughs
        "max_window_sessions": 120,
        "min_contractions": 2,
        "max_contractions": 5,
        "min_first_depth": 0.08,       # 8%
        "max_last_depth": 0.10,        # 10%
        "min_base_length": 15,
        "max_base_length": 120,
        "min_dist_pivot_pct": -0.03,   # Up to 3% below pivot (close >= 0.97 * pivot)
        "max_dist_pivot_pct": 0.02,    # Up to 2% above pivot (close <= 1.02 * pivot)
        "require_tt": True,
        "require_volume_dryup": False,
    },
    "near_pivot": {
        "pivot_window": 20,
        "k_atr": 1.0,                  # 0 <= (pivot - close) / close <= k_atr * atr_pct
        "require_tt": True,
    },
    "ipo_base": {
        "max_listing_age_days": 365,
        "min_listing_sessions": 15,
        "earliest_store_session_idx": 5,  # 6th session in store (0-indexed 5)
        "avg_vol_window": 50,
        "min_avg_volume": 25000,
        "min_traded_value": 1e7,          # 1 crore
        "k_atr": 2.0,                     # 0 <= (base_top - close) / close <= k_atr * atr_pct
        "max_base_depth": 0.35,           # 35%
        "min_sessions_since_base_top": 5,
    },
    "ema50_pullback": {
        "slope_sessions": 10,             # ema_50 rising over 10 sessions
        "max_touch_factor": 1.02,         # low <= 1.02 * ema_50
        "min_close_factor": 0.99,         # close >= 0.99 * ema_50
        "quiet_month_vol_ratio": 1.0,     # avg volume last 21 <= 1.0 * vol_sma_50
        "quiet_month_range_ratio": 1.0,   # mean range last 21 <= 1.0 * mean range last 63
        "prior_extension_factor": 1.05,   # max close last 30 sessions >= 1.05 * ema_50
        "prior_window": 30,
        "require_tt": True,
    },
    "candle_stock_cap": 300,
    "retention_dates": 10,
    "candle_window_sessions": 260,
}

def to_date(val: Any) -> date:
    """Helper to convert str, date, datetime or Timestamp to datetime.date."""
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, (datetime, pd.Timestamp)):
        return val.date()
    return datetime.strptime(str(val).split("T")[0], "%Y-%m-%d").date()

def compute_seeded_ema(arr: np.ndarray, span: int) -> np.ndarray:
    """Computes EMA seeded with SMA of the first span elements."""
    n = len(arr)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < span:
        return out
    out[span - 1] = np.mean(arr[:span])
    alpha = 2.0 / (span + 1.0)
    for i in range(span, n):
        out[i] = alpha * arr[i] + (1.0 - alpha) * out[i - 1]
    return out

def compute_wilder_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Computes J. Welles Wilder's 14-session ATR."""
    n = len(close)
    atr = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return atr
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    tr[0] = high[0] - low[0]
    atr[period - 1] = np.mean(tr[:period])
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr

def find_zigzag_swings(highs: np.ndarray, lows: np.ndarray, dates: List[str], min_pct: float = 0.04) -> List[tuple]:
    """
    Finds alternating swing highs and swing lows using a zigzag filter.
    Returns list of ('H'|'L', index_in_slice, price, date_str).
    """
    n = len(highs)
    if n < 2:
        return []
    swings = []
    peak_idx = 0
    trough_idx = 0
    direction = 0  # +1 for up (seeking peak), -1 for down (seeking trough)

    for i in range(1, n):
        h = highs[i]
        l = lows[i]
        if direction == 0:
            if lows[trough_idx] > 0 and (h - lows[trough_idx]) / lows[trough_idx] >= min_pct:
                direction = 1
                swings.append(("L", trough_idx, lows[trough_idx], dates[trough_idx]))
                peak_idx = i
            elif highs[peak_idx] > 0 and (highs[peak_idx] - l) / highs[peak_idx] >= min_pct:
                direction = -1
                swings.append(("H", peak_idx, highs[peak_idx], dates[peak_idx]))
                trough_idx = i
            else:
                if h > highs[peak_idx]: peak_idx = i
                if l < lows[trough_idx]: trough_idx = i
        elif direction == 1:
            if h > highs[peak_idx]:
                peak_idx = i
            elif highs[peak_idx] > 0 and (highs[peak_idx] - l) / highs[peak_idx] >= min_pct:
                swings.append(("H", peak_idx, highs[peak_idx], dates[peak_idx]))
                direction = -1
                trough_idx = i
        elif direction == -1:
            if l < lows[trough_idx]:
                trough_idx = i
            elif lows[trough_idx] > 0 and (h - lows[trough_idx]) / lows[trough_idx] >= min_pct:
                swings.append(("L", trough_idx, lows[trough_idx], dates[trough_idx]))
                direction = 1
                peak_idx = i

    if direction == 1:
        swings.append(("H", peak_idx, highs[peak_idx], dates[peak_idx]))
    elif direction == -1:
        swings.append(("L", trough_idx, lows[trough_idx], dates[trough_idx]))

    return swings

def compute_screener_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Extends precomputed indicators with screener-specific metrics per spec section 2:
    ema_50, high_52w_incl, low_52w_incl, sma_200_21ago, pivot_20, vol_avg_10,
    sma_10, sma_20, rs_raw, first_candle_date, atr_pct.
    """
    logger.info("Computing screener-specific indicators across equity history...")
    df = df.sort_values(by=["token", "trade_date"]).copy()
    grouped = df.groupby("token")

    # 1. Moving Averages needed for charts & screeners
    df["sma_10"] = grouped["close"].transform(lambda s: s.rolling(10, min_periods=10).mean())
    df["sma_20"] = grouped["close"].transform(lambda s: s.rolling(20, min_periods=20).mean())
    df["ema_50"] = grouped["close"].transform(lambda s: compute_seeded_ema(s.values, 50))
    df["ema_50_10ago"] = grouped["ema_50"].shift(SCREENER_PARAMS["ema50_pullback"]["slope_sessions"])

    # 2. 52-Week Highs/Lows INCLUDING today
    df["high_52w_incl"] = grouped["high"].transform(lambda s: s.rolling(252, min_periods=252).max())
    df["low_52w_incl"] = grouped["low"].transform(lambda s: s.rolling(252, min_periods=252).min())

    # 3. 200 SMA 21 sessions ago (1 month)
    df["sma_200_21ago"] = grouped["sma_200"].shift(SCREENER_PARAMS["trend_template"]["sma200_slope_sessions"])

    # 4. Pivot 20 (max high of last 20 sessions including today)
    df["pivot_20"] = grouped["high"].transform(lambda s: s.rolling(20, min_periods=20).max())

    # 5. Volume 10-session average including today
    df["vol_avg_10"] = grouped["volume"].transform(lambda s: s.rolling(10, min_periods=10).mean())

    # 6. Listing details
    df["first_candle_date"] = grouped["trade_date"].transform("min")
    df["session_idx"] = grouped.cumcount() + 1  # 1-based session count

    # 7. Relative Strength components (r63, r126, r189, r252)
    close_63 = grouped["close"].shift(63)
    close_126 = grouped["close"].shift(126)
    close_189 = grouped["close"].shift(189)
    close_252 = grouped["close"].shift(252)

    r63 = (df["close"] / close_63) - 1.0
    r126 = (df["close"] / close_126) - 1.0
    r189 = (df["close"] / close_189) - 1.0
    r252 = (df["close"] / close_252) - 1.0

    df["rs_raw"] = 0.4 * r63 + 0.2 * r126 + 0.2 * r189 + 0.2 * r252

    # 8. Wilder ATR(14) and atr_pct
    atr_pct_series = pd.Series(index=df.index, dtype=float)
    for _, g in grouped:
        h = g["high"].values.astype(np.float64)
        l = g["low"].values.astype(np.float64)
        c = g["close"].values.astype(np.float64)
        atr = compute_wilder_atr(h, l, c, 14)
        atr_pct_series.loc[g.index] = atr / np.maximum(1e-6, c)
    df["atr_pct"] = atr_pct_series

    return df

def calculate_rs_rank(df_latest: pd.DataFrame, eligible_mask: pd.Series) -> pd.Series:
    """
    Computes percentile rank (1-99) of rs_raw among all eligible stocks on that date.
    Non-eligible stocks or stocks without 252 sessions get NaN.
    """
    rs_rank = pd.Series(np.nan, index=df_latest.index, dtype=float)
    valid_rs = df_latest.loc[eligible_mask & df_latest["rs_raw"].notna(), "rs_raw"]
    if len(valid_rs) > 0:
        pct = valid_rs.rank(pct=True, method="min")
        ranks = np.clip(np.round(pct * 98 + 1), 1, 99).astype(int)
        rs_rank.loc[valid_rs.index] = ranks
    return rs_rank

def evaluate_trend_template(row: pd.Series, params: dict = SCREENER_PARAMS) -> bool:
    """Evaluates the 8 Trend Template rules."""
    close = row.get("close")
    sma_50 = row.get("sma_50")
    sma_150 = row.get("sma_150")
    sma_200 = row.get("sma_200")
    sma_200_21ago = row.get("sma_200_21ago")
    low_52w_incl = row.get("low_52w_incl")
    high_52w_incl = row.get("high_52w_incl")
    rs_rank = row.get("rs_rank")

    if pd.isna(close) or pd.isna(sma_50) or pd.isna(sma_150) or pd.isna(sma_200) or pd.isna(sma_200_21ago) \
       or pd.isna(low_52w_incl) or pd.isna(high_52w_incl) or pd.isna(rs_rank):
        return False

    p_tt = params["trend_template"]
    c1 = (close > sma_150) and (close > sma_200)
    c2 = (sma_150 > sma_200)
    c3 = (sma_200 > sma_200_21ago)
    c4 = (sma_50 > sma_150) and (sma_50 > sma_200)
    c5 = (close > sma_50)
    c6 = (close >= p_tt["low_52w_factor"] * low_52w_incl)
    c7 = (close >= p_tt["high_52w_factor"] * high_52w_incl)
    c8 = (rs_rank >= p_tt["min_rs_rank"])

    return bool(c1 and c2 and c3 and c4 and c5 and c6 and c7 and c8)

# -----------------------------------------------------------------------------
# Pure Screener Evaluation Functions
# -----------------------------------------------------------------------------

def eval_stage2_breakout(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates stage2_breakout screener criteria with 3-session recency."""
    p_s2 = params["stage2_breakout"]
    if p_s2.get("require_tt", True):
        if not bool(row.get("tt_pass", False)):
            return None

    if int(row.get("stage_2", 0)) != 1:
        return None

    today_close = float(row["close"])
    recency = p_s2.get("recency_sessions", 3)
    n_hist = len(hist)

    # Check breakout on any of the last recency sessions (0, 1, or 2 sessions ago)
    matched_breakout = None
    for days_ago in range(min(recency, n_hist)):
        b_idx = n_hist - 1 - days_ago
        b_row = hist.iloc[b_idx]

        if int(b_row.get("breakout_20d", 0)) != 1:
            continue

        b_close = float(b_row["close"])
        b_high = float(b_row["high"])
        b_low = float(b_row["low"])
        b_vol = float(b_row["volume"])
        b_vol_sma_50 = float(b_row["vol_sma_50"]) if pd.notna(b_row.get("vol_sma_50")) else 1.0
        b_pivot = float(b_row["high_20d"]) if pd.notna(b_row.get("high_20d")) else None

        if not (b_pivot and b_high > b_low):
            continue

        # Volume expansion on breakout day
        if b_vol < p_s2["min_volume_ratio"] * b_vol_sma_50:
            continue

        # Close in upper 40% of range on breakout day
        if (b_close - b_low) / (b_high - b_low) < p_s2["min_close_range_ratio"]:
            continue

        # Not extended > 5% above pivot on breakout day
        if b_close > p_s2["max_extension_factor"] * b_pivot:
            continue

        # Today's close must still be holding above that pivot (and <= 1.05 * pivot)
        if not (b_pivot <= today_close <= p_s2["max_extension_factor"] * b_pivot):
            continue

        b_date = str(b_row["trade_date"])
        vol_ratio = round(b_vol / max(1.0, b_vol_sma_50), 2)
        matched_breakout = {
            "days_ago": days_ago,
            "b_date": b_date,
            "b_pivot": b_pivot,
            "vol_ratio": vol_ratio,
        }
        break

    if not matched_breakout:
        return None

    # Length of current consecutive stage_2 == 1 run ending today
    days_in_stage2 = 0
    for i in range(n_hist - 1, -1, -1):
        if int(hist.iloc[i].get("stage_2", 0)) == 1:
            days_in_stage2 += 1
        else:
            break

    pivot_val = round(matched_breakout["b_pivot"], 2)
    dist_pivot = round((today_close - pivot_val) / pivot_val * 100, 2)
    days_ago = matched_breakout["days_ago"]
    vol_ratio = matched_breakout["vol_ratio"]
    ext_factor = p_s2["max_extension_factor"]
    ext_pct = int(round((ext_factor - 1.0) * 100))

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Pivot", "price": pivot_val, "from_date": matched_breakout["b_date"], "style": "solid"},
            {"id": "extension_limit", "label": f"Extension Limit ({ext_pct}%)", "price": round(ext_factor * pivot_val, 2), "from_date": matched_breakout["b_date"], "style": "dashed"},
        ],
        "segments": [],
        "markers": [
            {"date": matched_breakout["b_date"], "position": "belowBar", "text": "Breakout", "shape": "arrowUp"}
        ],
        "stats": {
            "days_ago": days_ago,
            "days_in_stage2": days_in_stage2,
            "vol_ratio": vol_ratio,
            "pct_above_pivot": dist_pivot
        }
    }

    return {
        "screener": "stage2_breakout",
        "pivot": pivot_val,
        "dist_to_pivot_pct": dist_pivot,
        "days_ago": days_ago,
        "overlay": overlay,
        "sort_key": (days_ago, -vol_ratio)
    }

def eval_vcp(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates swing-based Volatility Contraction Pattern (VCP) criteria."""
    p_vcp = params["vcp"]
    if p_vcp.get("require_tt", True):
        if not bool(row.get("tt_pass", False)):
            return None

    close = float(row["close"])
    n_hist = len(hist)
    if n_hist < p_vcp.get("min_base_length", 15):
        return None

    # Optional volume dry-up
    if p_vcp.get("require_volume_dryup", False):
        vol_avg_10 = float(row["vol_avg_10"]) if pd.notna(row.get("vol_avg_10")) else None
        vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0
        if not vol_avg_10 or vol_avg_10 > 0.85 * vol_sma_50:
            return None

    # Slice last 120 sessions for zigzag swing analysis
    max_win = p_vcp.get("max_window_sessions", 120)
    win_slice = hist.iloc[-max_win:]
    highs = win_slice["high"].values.astype(np.float64)
    lows = win_slice["low"].values.astype(np.float64)
    dates = [str(d) for d in win_slice["trade_date"].values]

    swings = find_zigzag_swings(highs, lows, dates, min_pct=p_vcp.get("zigzag_min_pct", 0.04))
    if len(swings) < 4:
        return None

    # Extract all (H -> L) pullbacks
    all_contractions = []
    for i in range(len(swings) - 1):
        if swings[i][0] == "H" and swings[i + 1][0] == "L":
            h_idx, h_val, h_date = swings[i][1], float(swings[i][2]), swings[i][3]
            l_idx, l_val, l_date = swings[i + 1][1], float(swings[i + 1][2]), swings[i + 1][3]
            depth = (h_val - l_val) / h_val if h_val > 0 else 0.0
            all_contractions.append({
                "h_idx": h_idx, "h_val": h_val, "h_date": h_date,
                "l_idx": l_idx, "l_val": l_val, "l_date": l_date,
                "depth": depth
            })

    if len(all_contractions) < p_vcp.get("min_contractions", 2):
        return None

    # Test contraction counts from max down to min
    min_k = p_vcp.get("min_contractions", 2)
    max_k = min(p_vcp.get("max_contractions", 5), len(all_contractions))

    selected_contractions = None
    for k in range(max_k, min_k - 1, -1):
        cand = all_contractions[-k:]
        depths = [c["depth"] for c in cand]
        # 1. Strictly decreasing depths
        if not all(depths[j] > depths[j + 1] for j in range(len(depths) - 1)):
            continue
        # 2. First depth >= 8%, last depth <= 10%
        if cand[0]["depth"] < p_vcp.get("min_first_depth", 0.08):
            continue
        if cand[-1]["depth"] > p_vcp.get("max_last_depth", 0.10):
            continue
        # 3. Base length 15 to 120 sessions
        first_h_date = cand[0]["h_date"]
        first_matches = win_slice.index[win_slice["trade_date"].astype(str) == first_h_date].tolist()
        if not first_matches:
            continue
        base_len = (len(win_slice) - 1) - win_slice.index.get_loc(first_matches[0])
        if not (p_vcp.get("min_base_length", 15) <= base_len <= p_vcp.get("max_base_length", 120)):
            continue

        # 4. Pivot = swing high before final contraction
        pivot = cand[-1]["h_val"]
        dist_pivot_pct = (close - pivot) / pivot
        if not (p_vcp.get("min_dist_pivot_pct", -0.03) <= dist_pivot_pct <= p_vcp.get("max_dist_pivot_pct", 0.02)):
            continue

        selected_contractions = cand
        break

    if not selected_contractions:
        return None

    pivot_val = round(selected_contractions[-1]["h_val"], 2)
    piv_date = selected_contractions[-1]["h_date"]
    dist_pct = round((close - pivot_val) / pivot_val * 100, 2)
    last_depth = selected_contractions[-1]["depth"]

    segments = []
    for idx, c in enumerate(selected_contractions):
        segments.append({
            "id": f"c{idx + 1}",
            "from": {"date": c["h_date"], "price": round(c["h_val"], 2)},
            "to": {"date": c["l_date"], "price": round(c["l_val"], 2)},
            "label": f"-{round(c['depth'] * 100, 1)}%"
        })

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Pivot", "price": pivot_val, "from_date": piv_date, "style": "solid"}
        ],
        "segments": segments,
        "markers": [],
        "stats": {
            "contractions_count": len(selected_contractions),
            "last_depth_pct": round(last_depth * 100, 1),
            "dist_to_pivot_pct": dist_pct,
        }
    }

    return {
        "screener": "vcp",
        "pivot": pivot_val,
        "dist_to_pivot_pct": dist_pct,
        "overlay": overlay,
        "sort_key": last_depth
    }

def eval_near_pivot(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates consolidation near 20-session pivot resistance with ATR scaling."""
    p_np = params["near_pivot"]
    if p_np.get("require_tt", True):
        if not bool(row.get("tt_pass", False)):
            return None

    pivot_20 = float(row["pivot_20"]) if pd.notna(row.get("pivot_20")) else None
    close = float(row["close"])

    if not (pivot_20 and pivot_20 > 0 and close > 0):
        return None

    atr_val = row.get("atr_pct")
    if pd.isna(atr_val) or float(atr_val) <= 0:
        return None
    atr_pct = float(atr_val)
    max_dist = p_np.get("k_atr", 1.0) * atr_pct

    # Closeness: 0 <= (pivot - close) / close <= near_pivot.k_atr * atr_pct
    dist_p = (pivot_20 - close) / close
    if not (0.0 <= dist_p <= max_dist):
        return None

    piv_win = p_np.get("pivot_window", 20)
    prior_slice = hist.iloc[-piv_win:]
    piv_date = str(prior_slice.loc[prior_slice["high"].idxmax(), "trade_date"])

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Pivot", "price": round(pivot_20, 2), "from_date": piv_date, "style": "solid"}
        ],
        "segments": [],
        "markers": [],
        "stats": {
            "dist_to_pivot_pct": round(dist_p * 100, 2),
            "atr_pct": round(atr_pct * 100, 2)
        }
    }

    return {
        "screener": "near_pivot",
        "pivot": round(pivot_20, 2),
        "dist_to_pivot_pct": round(dist_p * 100, 2),
        "overlay": overlay,
        "sort_key": dist_p
    }

def eval_ipo_base(
    row: pd.Series,
    hist: pd.DataFrame,
    earliest_cutoff_date: date,
    params: dict = SCREENER_PARAMS
) -> Optional[Dict[str, Any]]:
    """Evaluates IPO primary consolidation base pattern sitting just under base top."""
    p_ipo = params["ipo_base"]
    p_trad = params["tradability"]

    first_date = row.get("first_candle_date")
    if not first_date:
        return None

    first_date_val = to_date(first_date)
    target_date_val = to_date(row["trade_date"])

    listing_age_days = (target_date_val - first_date_val).days
    hist_len = len(hist)

    if listing_age_days > p_ipo["max_listing_age_days"] or hist_len < p_ipo["min_listing_sessions"]:
        return None

    # Real listing check: must be strictly after the 6th session of the store
    if first_date_val <= earliest_cutoff_date:
        return None

    close = float(row["close"])
    if close < p_trad["min_close"]:
        return None

    recent_n = min(hist_len, p_ipo.get("avg_vol_window", 50))
    avg_vol = float(hist["volume"].iloc[-recent_n:].mean())

    if avg_vol < p_ipo["min_avg_volume"]:
        return None

    if (avg_vol * close) < p_trad["min_traded_value"]:
        return None

    # base_top = max high from listing to the PREVIOUS session
    if hist_len < 2:
        return None
    prior_hist = hist.iloc[:-1]
    base_top = float(prior_hist["high"].max())
    base_top_idx = prior_hist["high"].idxmax()
    base_top_date = str(prior_hist.loc[base_top_idx, "trade_date"])

    # Not broken out: close <= base_top
    if close > base_top:
        return None

    # Just under: (base_top - close) / close <= ipo_base.k_atr * atr_pct (default k_atr = 2.0)
    atr_val = row.get("atr_pct")
    if pd.isna(atr_val) or float(atr_val) <= 0:
        return None
    atr_pct = float(atr_val)
    dist_top = (base_top - close) / close
    max_dist = p_ipo.get("k_atr", 2.0) * atr_pct
    if not (0.0 <= dist_top <= max_dist):
        return None

    # Base depth (base_top - lowest low since base_top date) / base_top <= 35%
    post_top_slice = hist.loc[base_top_idx:]
    lowest_low = float(post_top_slice["low"].min())
    base_depth = (base_top - lowest_low) / base_top if base_top > 0 else 1.0
    if base_depth > p_ipo["max_base_depth"]:
        return None

    # At least 5 sessions since base_top date
    sessions_since_base_top = len(post_top_slice) - 1
    if sessions_since_base_top < p_ipo.get("min_sessions_since_base_top", 5):
        return None

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Base top", "price": round(base_top, 2), "from_date": base_top_date, "style": "solid"},
            {"id": "base_low", "label": "Base low", "price": round(lowest_low, 2), "from_date": base_top_date, "style": "dashed"},
        ],
        "segments": [],
        "markers": [
            {"date": str(first_date_val), "position": "aboveBar", "text": "Listing", "shape": "circle"}
        ],
        "stats": {
            "base_depth_pct": round(base_depth * 100, 1),
            "sessions_since_listing": hist_len,
            "sessions_since_base_top": sessions_since_base_top,
            "pct_from_base_top": round(dist_top * 100, 2),
            "atr_pct": round(atr_pct * 100, 2)
        }
    }

    return {
        "screener": "ipo_base",
        "pivot": round(base_top, 2),
        "dist_to_pivot_pct": round(dist_top * 100, 2),
        "overlay": overlay,
        "sort_key": dist_top
    }

def eval_ema50_pullback(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates pullbacks to a rising 50 EMA after quiet consolidation."""
    p_pb = params["ema50_pullback"]
    if p_pb.get("require_tt", True):
        if not bool(row.get("tt_pass", False)):
            return None

    ema_50 = float(row["ema_50"]) if pd.notna(row.get("ema_50")) else None
    ema_50_10ago = float(row["ema_50_10ago"]) if pd.notna(row.get("ema_50_10ago")) else None
    if not (ema_50 and ema_50_10ago and ema_50 > ema_50_10ago):
        return None

    low = float(row["low"])
    close = float(row["close"])

    # Resting on 50 EMA: low <= 1.02 * ema_50 and close >= 0.99 * ema_50
    if not (low <= p_pb["max_touch_factor"] * ema_50 and close >= p_pb["min_close_factor"] * ema_50):
        return None

    n_hist = len(hist)
    if n_hist < 63:
        return None

    # Quiet month:
    vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0
    last_21 = hist.iloc[-21:]
    last_63 = hist.iloc[-63:]
    avg_vol_21 = float(last_21["volume"].mean())
    if avg_vol_21 > p_pb.get("quiet_month_vol_ratio", 1.0) * vol_sma_50:
        return None

    range_21 = ((last_21["high"] - last_21["low"]) / last_21["close"]).mean()
    range_63 = ((last_63["high"] - last_63["low"]) / last_63["close"]).mean()
    if range_21 > p_pb.get("quiet_month_range_ratio", 1.0) * range_63:
        return None

    # Prior extension: max close of last 30 sessions >= 1.05 * ema_50
    prior_win = p_pb.get("prior_window", 30)
    last_30 = hist.iloc[-min(prior_win, n_hist):]
    max_close_30 = float(last_30["close"].max())
    if max_close_30 < p_pb.get("prior_extension_factor", 1.05) * ema_50:
        return None

    swing_idx = last_30["close"].idxmax()
    swing_date = str(last_30.loc[swing_idx, "trade_date"])

    touch_slice = last_30[last_30["low"] <= p_pb["max_touch_factor"] * last_30["ema_50"]]
    target_date = str(row["trade_date"])
    touch_date = str(touch_slice.iloc[-1]["trade_date"]) if not touch_slice.empty else target_date

    pct_above_ema50 = (close - ema_50) / ema_50 * 100
    rs_rank = int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else 0

    overlay = {
        "levels": [
            {"id": "swing_high", "label": "Swing High", "price": round(max_close_30, 2), "from_date": swing_date, "style": "dashed"}
        ],
        "segments": [],
        "markers": [
            {"date": touch_date, "position": "belowBar", "text": "Touched 50 EMA", "shape": "circle"}
        ],
        "stats": {
            "pct_above_ema50": round(pct_above_ema50, 2),
            "vol_21_vs_50": round(avg_vol_21 / max(1.0, vol_sma_50), 2),
            "range_ratio_21_63": round(range_21 / max(1e-6, range_63), 2)
        }
    }

    return {
        "screener": "ema50_pullback",
        "pivot": round(ema_50, 2),
        "dist_to_pivot_pct": round(pct_above_ema50, 2),
        "overlay": overlay,
        "sort_key": -rs_rank
    }

def run_screeners(
    df: pd.DataFrame,
    target_date: Any,
    nifty500_tokens: Optional[Set[int]] = None,
    conn=None
) -> Dict[str, Any]:
    """
    Executes the 5 institutional momentum screeners against historical equity data.
    """
    target_date_val = to_date(target_date)
    target_date_str = target_date_val.strftime("%Y-%m-%d")

    close_connection_at_end = False
    if conn is None:
        conn = get_connection()
        close_connection_at_end = True

    try:
        # Precompute indicators across full history if not already present
        required_cols = {"sma_10", "sma_20", "ema_50", "high_52w_incl", "pivot_20", "vol_avg_10", "atr_pct"}
        if not required_cols.issubset(df.columns):
            df = compute_screener_indicators(df)

        # Filter store to history up to target_date
        df_target_history = df[df["trade_date"].apply(to_date) <= target_date_val].copy()
        df_target = df_target_history[df_target_history["trade_date"].apply(to_date) == target_date_val].copy()

        if df_target.empty:
            logger.warning(f"No records found for target trade date {target_date_str}")
            return {}

        # Earliest store cutoff date (date of 6th session in store)
        all_dates_sorted = df["trade_date"].apply(to_date).drop_duplicates().sort_values().tolist()
        earliest_session_idx = SCREENER_PARAMS["ipo_base"]["earliest_store_session_idx"]
        earliest_cutoff_date = all_dates_sorted[min(earliest_session_idx, len(all_dates_sorted) - 1)]

        # 1. Tradability filter
        p_trad = SCREENER_PARAMS["tradability"]
        tradable_mask = (
            (df_target["close"] >= p_trad["min_close"]) &
            (df_target["vol_sma_50"] >= p_trad["min_vol_sma_50"]) &
            ((df_target["close"] * df_target["vol_sma_50"]) >= p_trad["min_traded_value"]) &
            (df_target["session_idx"] >= p_trad["min_history_sessions"])
        )

        # 2. Compute Relative Strength Rank (1-99)
        df_target["rs_rank"] = calculate_rs_rank(df_target, tradable_mask)

        # 3. Evaluate Trend Template (8 rules)
        df_target["tt_pass"] = df_target.apply(lambda row: evaluate_trend_template(row, SCREENER_PARAMS), axis=1)

        # 4. Group history by token
        history_grouped = {tok: g.sort_values(by="trade_date") for tok, g in df_target_history.groupby("token")}

        n500_set = nifty500_tokens if nifty500_tokens is not None else set()

        screener_candidates: Dict[str, List[Dict[str, Any]]] = {
            "stage2_breakout": [],
            "vcp": [],
            "near_pivot": [],
            "ipo_base": [],
            "ema50_pullback": [],
        }

        def make_candidate_record(row, result_dict, in_n500):
            vol = float(row["volume"])
            vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0
            high_52w = float(row["high_52w_incl"]) if pd.notna(row.get("high_52w_incl")) else float(row["close"])
            pct_52w = round((float(row["close"]) - high_52w) / high_52w * 100, 2)
            ret_1d = round(float(row["ret_1d"]) * 100, 2) if pd.notna(row.get("ret_1d")) else 0.0

            return {
                "trade_date": target_date_val,
                "screener": result_dict["screener"],
                "token": int(row["token"]),
                "symbol": str(row["symbol"]),
                "close": round(float(row["close"]), 2),
                "ret_1d_pct": ret_1d,
                "vol_ratio": round(vol / max(1.0, vol_sma_50), 2),
                "pct_from_52w_high": pct_52w,
                "pivot": result_dict["pivot"],
                "dist_to_pivot_pct": result_dict["dist_to_pivot_pct"],
                "rs_rank": int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else None,
                "stage": int(row.get("stage_2", 0)),
                "in_nifty500": in_n500,
                "extra": {
                    "overlay": result_dict["overlay"],
                    "sort_key": result_dict["sort_key"],
                    "days_ago": result_dict.get("days_ago", 0)
                }
            }

        # 5. Evaluate all stocks across all screeners
        for idx, row in df_target.iterrows():
            tok = int(row["token"])
            stock_up_to_today = history_grouped.get(tok)
            if stock_up_to_today is None or stock_up_to_today.empty:
                continue

            in_nifty500 = tok in n500_set

            # 5.1 Stage 2 Breakout
            res_s2 = eval_stage2_breakout(row, stock_up_to_today, SCREENER_PARAMS)
            if res_s2:
                screener_candidates["stage2_breakout"].append(make_candidate_record(row, res_s2, in_nifty500))

            # 5.2 VCP
            res_vcp = eval_vcp(row, stock_up_to_today, SCREENER_PARAMS)
            if res_vcp:
                screener_candidates["vcp"].append(make_candidate_record(row, res_vcp, in_nifty500))

            # 5.3 Near Pivot
            res_np = eval_near_pivot(row, stock_up_to_today, SCREENER_PARAMS)
            if res_np:
                screener_candidates["near_pivot"].append(make_candidate_record(row, res_np, in_nifty500))

            # 5.4 IPO Base
            res_ipo = eval_ipo_base(row, stock_up_to_today, earliest_cutoff_date, SCREENER_PARAMS)
            if res_ipo:
                screener_candidates["ipo_base"].append(make_candidate_record(row, res_ipo, in_nifty500))

            # 5.5 50 EMA Pullback
            res_pb = eval_ema50_pullback(row, stock_up_to_today, SCREENER_PARAMS)
            if res_pb:
                screener_candidates["ema50_pullback"].append(make_candidate_record(row, res_pb, in_nifty500))

        # 6. Sort candidates per spec rules
        # stage2_breakout: days_ago asc, vol_ratio desc
        screener_candidates["stage2_breakout"].sort(key=lambda x: (x["extra"]["days_ago"], -x["vol_ratio"]))
        # vcp: last contraction depth asc
        screener_candidates["vcp"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)
        # near_pivot: dist_to_pivot asc
        screener_candidates["near_pivot"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)
        # ipo_base: dist_from_top asc
        screener_candidates["ipo_base"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)
        # ema50_pullback: rs_rank desc
        screener_candidates["ema50_pullback"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)

        # Flatten records for DB insert
        all_results_to_insert = []
        counts = {}
        tokens_passed_today: Set[int] = set()

        for s_name, c_list in screener_candidates.items():
            counts[s_name] = len(c_list)
            for c in c_list:
                tokens_passed_today.add(c["token"])
                all_results_to_insert.append((
                    c["trade_date"],
                    c["screener"],
                    c["token"],
                    c["symbol"],
                    c["close"],
                    c["ret_1d_pct"],
                    c["vol_ratio"],
                    c["pct_from_52w_high"],
                    c["pivot"],
                    c["dist_to_pivot_pct"],
                    c["rs_rank"],
                    c["stage"],
                    c["in_nifty500"],
                    json.dumps(c["extra"])
                ))

        logger.info(f"Screener counts for {target_date_str}: {counts}")

        # 7. Write to database in a single idempotent transaction
        with conn.cursor() as cur:
            # Delete today's rows for all 5 screeners
            cur.execute("""
                DELETE FROM daily_screener_results
                WHERE trade_date = %s AND screener IN ('stage2_breakout', 'vcp', 'near_pivot', 'ipo_base', 'ema50_pullback');
            """, (target_date_val,))

            if all_results_to_insert:
                from psycopg2.extras import execute_batch
                insert_results_sql = """
                    INSERT INTO daily_screener_results (
                        trade_date, screener, token, symbol, close, ret_1d_pct, vol_ratio,
                        pct_from_52w_high, pivot, dist_to_pivot_pct, rs_rank, stage, in_nifty500, extra
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (trade_date, screener, token) DO UPDATE
                    SET close = EXCLUDED.close,
                        ret_1d_pct = EXCLUDED.ret_1d_pct,
                        vol_ratio = EXCLUDED.vol_ratio,
                        pct_from_52w_high = EXCLUDED.pct_from_52w_high,
                        pivot = EXCLUDED.pivot,
                        dist_to_pivot_pct = EXCLUDED.dist_to_pivot_pct,
                        rs_rank = EXCLUDED.rs_rank,
                        stage = EXCLUDED.stage,
                        in_nifty500 = EXCLUDED.in_nifty500,
                        extra = EXCLUDED.extra;
                """
                execute_batch(cur, insert_results_sql, all_results_to_insert, page_size=500)

            # Retention: keep only latest 10 trade dates in daily_screener_results
            cur.execute("""
                DELETE FROM daily_screener_results
                WHERE trade_date NOT IN (
                    SELECT DISTINCT trade_date
                    FROM daily_screener_results
                    ORDER BY trade_date DESC
                    LIMIT %s
                );
            """, (SCREENER_PARAMS["retention_dates"],))

        # 8. Extract and store chart fallback candles for tokens that passed today
        # Cap at 300 tokens by RS rank (tokens with NaN rs_rank sort as 0)
        token_rs_dict = {
            int(row["token"]): (int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else 0)
            for _, row in df_target.iterrows()
        }
        tokens_sorted_by_rs = sorted(
            tokens_passed_today,
            key=lambda t: token_rs_dict.get(t, 0),
            reverse=True
        )[:SCREENER_PARAMS["candle_stock_cap"]]

        candles_to_insert = []
        for tok in tokens_sorted_by_rs:
            stock_data = history_grouped.get(tok)
            if stock_data is None:
                continue
            stock_window = stock_data[stock_data["trade_date"].apply(to_date) <= target_date_val].iloc[-SCREENER_PARAMS["candle_window_sessions"]:]
            for _, c_row in stock_window.iterrows():
                candles_to_insert.append((
                    int(tok),
                    to_date(c_row["trade_date"]),
                    round(float(c_row["open"]), 2) if pd.notna(c_row.get("open")) else None,
                    round(float(c_row["high"]), 2) if pd.notna(c_row.get("high")) else None,
                    round(float(c_row["low"]), 2) if pd.notna(c_row.get("low")) else None,
                    round(float(c_row["close"]), 2),
                    int(c_row["volume"]) if pd.notna(c_row.get("volume")) else None,
                    round(float(c_row["sma_50"]), 2) if pd.notna(c_row.get("sma_50")) else None,
                    round(float(c_row["sma_150"]), 2) if pd.notna(c_row.get("sma_150")) else None,
                    round(float(c_row["sma_200"]), 2) if pd.notna(c_row.get("sma_200")) else None,
                ))

        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM screener_candles
                WHERE token NOT IN (
                    SELECT DISTINCT token
                    FROM daily_screener_results
                );
            """)

            if candles_to_insert:
                from psycopg2.extras import execute_batch
                insert_candles_sql = """
                    INSERT INTO screener_candles (
                        token, trade_date, open, high, low, close, volume,
                        sma_50, sma_150, sma_200
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (token, trade_date) DO UPDATE
                    SET open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume,
                        sma_50 = EXCLUDED.sma_50,
                        sma_150 = EXCLUDED.sma_150,
                        sma_200 = EXCLUDED.sma_200;
                """
                execute_batch(cur, insert_candles_sql, candles_to_insert, page_size=1000)

            cur.execute("""
                DELETE FROM screener_candles
                WHERE (token, trade_date) NOT IN (
                    SELECT token, trade_date
                    FROM (
                        SELECT token, trade_date,
                               ROW_NUMBER() OVER (PARTITION BY token ORDER BY trade_date DESC) as rn
                        FROM screener_candles
                    ) ranked
                    WHERE rn <= %s
                );
            """, (SCREENER_PARAMS["candle_window_sessions"],))

        conn.commit()
        return {
            "trade_date": target_date_str,
            "counts": counts,
            "total_candidates": len(all_results_to_insert),
            "stored_candle_tokens": len(tokens_sorted_by_rs)
        }

    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error in run_screeners: {e}", exc_info=True)
        raise
    finally:
        if close_connection_at_end and conn:
            conn.close()
