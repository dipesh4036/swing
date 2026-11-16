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
        "max_extension_factor": 1.05,  # close <= 1.05 * high_20d
        "min_close_range_ratio": 0.6,  # (close - low) / (high - low) >= 0.6
        "min_volume_ratio": 1.5,       # volume >= 1.5 * vol_sma_50
    },
    "vcp": {
        "high_52w_factor": 0.85,      # close >= 0.85 * high_52w_incl
        "min_history_sessions": 45,   # 3 * 15
        "window_len": 15,             # w1: t-44..t-30, w2: t-29..t-15, w3: t-14..t
        "max_range_pct_w3": 0.10,     # range_pct(w3) <= 10%
        "max_vol_dryup_ratio": 0.85,  # vol_avg_10 <= 0.85 * vol_sma_50
        "max_dist_pivot_pct": 0.05,   # 0 <= (pivot_20 - close) / pivot_20 <= 0.05
        "pivot_window": 20,
    },
    "near_pivot": {
        "max_dist_pivot_pct": 0.03,   # 0 <= (pivot_20 - close) / pivot_20 <= 0.03
        "pivot_window": 20,
    },
    "ipo_base": {
        "max_listing_age_days": 365,
        "min_listing_sessions": 15,
        "earliest_store_session_idx": 5,  # 6th session in store (0-indexed 5)
        "avg_vol_window": 50,
        "min_avg_volume": 25000,
        "max_base_depth": 0.35,       # (listing_high - min_low_since_high) / listing_high <= 0.35
        "min_close_to_high": 0.90,    # close >= 0.90 * listing_high
        "tightness_window": 10,
        "max_10d_range_pct": 0.12,    # range_pct(last 10 sessions) <= 0.12
    },
    "ema50_pullback": {
        "min_history_sessions": 15,
        "slope_sessions": 10,         # ema_50 > ema_50 shifted 10 sessions
        "max_touch_factor": 1.02,     # low <= 1.02 * ema_50
        "min_close_factor": 0.99,     # close >= 0.99 * ema_50
        "min_prior_extension": 1.08,  # max close last 15 sessions >= 1.08 * ema_50
        "prior_window": 15,
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

def compute_screener_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Extends precomputed indicators with screener-specific metrics per spec section 2:
    ema_50, high_52w_incl, low_52w_incl, sma_200_21ago, pivot_20, vol_avg_10,
    sma_10, sma_20, rs_raw, first_candle_date.
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
    """Evaluates stage2_breakout screener criteria on row and hist."""
    p_s2 = params["stage2_breakout"]
    tt_pass = bool(row.get("tt_pass", False))
    stage_2 = int(row.get("stage_2", 0))
    breakout_20d = int(row.get("breakout_20d", 0))

    if not (tt_pass and stage_2 == 1 and breakout_20d == 1):
        return None

    high_20d_prior = float(row["high_20d"]) if pd.notna(row.get("high_20d")) else None
    close = float(row["close"])
    high = float(row["high"])
    low = float(row["low"])
    vol = float(row["volume"])
    vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0
    vol_ratio = round(vol / max(1.0, vol_sma_50), 2)

    if not (high_20d_prior and high > low):
        return None

    # Check volume expansion
    if vol < p_s2["min_volume_ratio"] * vol_sma_50:
        return None

    # Check close in upper 40% of range
    day_range_pos = (close - low) / (high - low)
    if day_range_pos < p_s2["min_close_range_ratio"]:
        return None

    # Check not extended beyond max factor
    if close > p_s2["max_extension_factor"] * high_20d_prior:
        return None

    # Find date of prior 20-session high
    prior_win = p_s2.get("pivot_window", 20)
    prior_slice = hist.iloc[-(prior_win + 1):-1]
    target_date = str(row["trade_date"])
    pivot_date = str(prior_slice.loc[prior_slice["high"].idxmax(), "trade_date"]) if not prior_slice.empty else target_date
    pivot_val = round(high_20d_prior, 2)
    dist_pivot = round((close - pivot_val) / pivot_val * 100, 2)

    ext_factor = p_s2["max_extension_factor"]
    ext_pct = int(round((ext_factor - 1.0) * 100))

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Pivot", "price": pivot_val, "from_date": pivot_date, "style": "solid"},
            {"id": "extension_limit", "label": f"Extension Limit ({ext_pct}%)", "price": round(ext_factor * pivot_val, 2), "from_date": pivot_date, "style": "dashed"},
        ],
        "segments": [],
        "markers": [
            {"date": target_date, "position": "belowBar", "text": "Breakout", "shape": "arrowUp"}
        ],
        "highlight_lines": ["sma_50", "sma_150", "sma_200"],
        "stats": {"vol_ratio": vol_ratio, "pct_above_pivot": dist_pivot}
    }

    return {
        "screener": "stage2_breakout",
        "pivot": pivot_val,
        "dist_to_pivot_pct": dist_pivot,
        "overlay": overlay,
        "sort_key": vol_ratio
    }

def eval_vcp(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates Volatility Contraction Pattern (VCP) criteria."""
    p_vcp = params["vcp"]
    tt_pass = bool(row.get("tt_pass", False))
    if not tt_pass:
        return None

    close = float(row["close"])
    high_52w = float(row["high_52w_incl"]) if pd.notna(row.get("high_52w_incl")) else None
    if not (high_52w and close >= p_vcp["high_52w_factor"] * high_52w):
        return None

    min_hist = p_vcp.get("min_history_sessions", 45)
    if len(hist) < min_hist:
        return None

    pivot_20 = float(row["pivot_20"]) if pd.notna(row.get("pivot_20")) else None
    sma_50 = float(row["sma_50"]) if pd.notna(row.get("sma_50")) else None
    vol_avg_10 = float(row["vol_avg_10"]) if pd.notna(row.get("vol_avg_10")) else None
    vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0

    if not (pivot_20 and sma_50 and vol_avg_10):
        return None

    if close < sma_50 or vol_avg_10 > p_vcp["max_vol_dryup_ratio"] * vol_sma_50:
        return None

    dist_pivot_pct = (pivot_20 - close) / pivot_20
    if not (0.0 <= dist_pivot_pct <= p_vcp["max_dist_pivot_pct"]):
        return None

    w_len = p_vcp.get("window_len", 15)
    w1 = hist.iloc[-(3 * w_len):-(2 * w_len)]
    w2 = hist.iloc[-(2 * w_len):-w_len]
    w3 = hist.iloc[-w_len:]

    def get_range(w):
        mx = w["high"].max()
        mn = w["low"].min()
        r_pct = (mx - mn) / mx if mx > 0 else 1.0
        h_idx = w["high"].idxmax()
        l_idx = w["low"].idxmin()
        h_date = w.loc[h_idx, "trade_date"]
        l_date = w.loc[l_idx, "trade_date"]
        return r_pct, mx, mn, str(h_date), str(l_date)

    r1, h1, l1, d_h1, d_l1 = get_range(w1)
    r2, h2, l2, d_h2, d_l2 = get_range(w2)
    r3, h3, l3, d_h3, d_l3 = get_range(w3)

    if not (r3 < r2 < r1 and r3 <= p_vcp["max_range_pct_w3"]):
        return None

    piv_win = p_vcp.get("pivot_window", 20)
    prior_slice = hist.iloc[-piv_win:]
    piv_date = str(prior_slice.loc[prior_slice["high"].idxmax(), "trade_date"])

    overlay = {
        "levels": [
            {"id": "pivot", "label": "Pivot", "price": round(pivot_20, 2), "from_date": piv_date, "style": "solid"}
        ],
        "segments": [
            {"id": "c1", "from": {"date": d_h1, "price": round(h1, 2)}, "to": {"date": d_l1, "price": round(l1, 2)}, "label": f"-{round(r1*100, 1)}%"},
            {"id": "c2", "from": {"date": d_h2, "price": round(h2, 2)}, "to": {"date": d_l2, "price": round(l2, 2)}, "label": f"-{round(r2*100, 1)}%"},
            {"id": "c3", "from": {"date": d_h3, "price": round(h3, 2)}, "to": {"date": d_l3, "price": round(l3, 2)}, "label": f"-{round(r3*100, 1)}%"},
        ],
        "markers": [],
        "highlight_lines": ["sma_50"],
        "stats": {
            "depth_w1": round(r1 * 100, 1),
            "depth_w2": round(r2 * 100, 1),
            "depth_w3": round(r3 * 100, 1),
            "vol_avg_10_vs_50": round(vol_avg_10 / max(1.0, vol_sma_50), 2),
            "dist_to_pivot_pct": round(dist_pivot_pct * 100, 2)
        }
    }

    return {
        "screener": "vcp",
        "pivot": round(pivot_20, 2),
        "dist_to_pivot_pct": round(dist_pivot_pct * 100, 2),
        "overlay": overlay,
        "sort_key": r3
    }

def eval_near_pivot(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates consolidation near 20-session pivot resistance."""
    p_np = params["near_pivot"]
    tt_pass = bool(row.get("tt_pass", False))
    if not tt_pass:
        return None

    pivot_20 = float(row["pivot_20"]) if pd.notna(row.get("pivot_20")) else None
    close = float(row["close"])

    if not (pivot_20 and pivot_20 > 0):
        return None

    dist_p = (pivot_20 - close) / pivot_20
    if not (0.0 <= dist_p <= p_np["max_dist_pivot_pct"]):
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
        "highlight_lines": ["sma_20", "sma_50"],
        "stats": {"dist_to_pivot_pct": round(dist_p * 100, 2)}
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
    """Evaluates IPO primary consolidation base pattern."""
    p_ipo = params["ipo_base"]
    p_trad = params["tradability"]

    first_date = row.get("first_candle_date")
    ema_20 = float(row["ema_20"]) if pd.notna(row.get("ema_20")) else None
    if not (first_date and ema_20):
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
    # Common tradability rule 1: close >= 20.0
    if close < p_trad["min_close"]:
        return None

    recent_n = min(hist_len, p_ipo.get("avg_vol_window", 50))
    avg_vol = hist["volume"].iloc[-recent_n:].mean()

    # Common tradability rule 2: average volume >= 25,000
    if avg_vol < p_ipo["min_avg_volume"]:
        return None

    # Common tradability rule 3: avg_volume * close >= min_traded_value (1e7)
    if (avg_vol * close) < p_trad["min_traded_value"]:
        return None

    # Price above 20 EMA
    if close <= ema_20:
        return None

    listing_high = float(hist["high"].max())
    h_idx = hist["high"].idxmax()
    h_date = str(hist.loc[h_idx, "trade_date"])
    post_high_slice = hist.loc[h_idx:]
    base_low = float(post_high_slice["low"].min()) if not post_high_slice.empty else float(hist["low"].min())
    base_depth = (listing_high - base_low) / listing_high if listing_high > 0 else 1.0

    if base_depth > p_ipo["max_base_depth"]:
        return None

    if close < p_ipo["min_close_to_high"] * listing_high:
        return None

    tightness_win = p_ipo.get("tightness_window", 10)
    last_10 = hist.iloc[-tightness_win:]
    mx_10 = last_10["high"].max()
    mn_10 = last_10["low"].min()
    r_10 = (mx_10 - mn_10) / mx_10 if mx_10 > 0 else 1.0

    if r_10 > p_ipo["max_10d_range_pct"]:
        return None

    dist_listing_high = (listing_high - close) / listing_high
    overlay = {
        "levels": [
            {"id": "listing_high", "label": "Listing High", "price": round(listing_high, 2), "from_date": h_date, "style": "solid"},
            {"id": "base_low", "label": "Base Low", "price": round(base_low, 2), "from_date": h_date, "style": "dashed"},
        ],
        "segments": [],
        "markers": [
            {"date": str(first_date_val), "position": "aboveBar", "text": "Listing", "shape": "circle"}
        ],
        "highlight_lines": ["sma_20"],
        "stats": {
            "base_depth_pct": round(base_depth * 100, 1),
            "sessions_since_listing": hist_len,
            "pct_from_listing_high": round(dist_listing_high * 100, 2)
        }
    }

    return {
        "screener": "ipo_base",
        "pivot": round(listing_high, 2),
        "dist_to_pivot_pct": round(dist_listing_high * 100, 2),
        "overlay": overlay,
        "sort_key": dist_listing_high
    }

def eval_ema50_pullback(row: pd.Series, hist: pd.DataFrame, params: dict = SCREENER_PARAMS) -> Optional[Dict[str, Any]]:
    """Evaluates pullbacks to a rising 50 EMA after prior extension."""
    p_pb = params["ema50_pullback"]
    tt_pass = bool(row.get("tt_pass", False))
    if not tt_pass:
        return None

    ema_50 = float(row["ema_50"]) if pd.notna(row.get("ema_50")) else None
    ema_50_10ago = float(row["ema_50_10ago"]) if pd.notna(row.get("ema_50_10ago")) else None
    if not (ema_50 and ema_50_10ago and ema_50 > ema_50_10ago):
        return None

    min_hist = p_pb.get("min_history_sessions", 15)
    if len(hist) < min_hist:
        return None

    low = float(row["low"])
    close = float(row["close"])
    vol = float(row["volume"])
    vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0

    # low touched zone (<= 1.02 * ema_50) and close held (>= 0.99 * ema_50)
    if not (low <= p_pb["max_touch_factor"] * ema_50 and close >= p_pb["min_close_factor"] * ema_50):
        return None

    prior_win = p_pb.get("prior_window", 15)
    last_15 = hist.iloc[-prior_win:]
    max_close_15 = float(last_15["close"].max())

    if not (max_close_15 >= p_pb["min_prior_extension"] * ema_50 and vol <= vol_sma_50):
        return None

    swing_idx = last_15["close"].idxmax()
    swing_date = str(last_15.loc[swing_idx, "trade_date"])

    touch_slice = last_15[last_15["low"] <= p_pb["max_touch_factor"] * last_15["ema_50"]]
    target_date = str(row["trade_date"])
    touch_date = str(touch_slice.iloc[-1]["trade_date"]) if not touch_slice.empty else target_date

    pct_above_ema50 = (close - ema_50) / ema_50 * 100
    rs_rank = int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else 0

    overlay = {
        "levels": [
            {"id": "swing_high", "label": "Swing High", "price": round(max_close_15, 2), "from_date": swing_date, "style": "dashed"}
        ],
        "segments": [],
        "markers": [
            {"date": touch_date, "position": "belowBar", "text": "Touched 50 EMA", "shape": "circle"}
        ],
        "highlight_lines": ["ema_50"],
        "stats": {"pct_above_ema50": round(pct_above_ema50, 2)}
    }

    return {
        "screener": "ema50_pullback",
        "pivot": round(ema_50, 2),
        "dist_to_pivot_pct": round(pct_above_ema50, 2),
        "overlay": overlay,
        "sort_key": -rs_rank
    }

def make_candidate_record(row: pd.Series, res: Dict[str, Any], in_nifty500: bool) -> Dict[str, Any]:
    """Helper to assemble a screener candidate record for daily_screener_results."""
    close = float(row["close"])
    vol = float(row["volume"])
    vol_sma_50 = float(row["vol_sma_50"]) if pd.notna(row.get("vol_sma_50")) else 1.0
    vol_ratio = round(vol / max(1.0, vol_sma_50), 2)
    ret_1d_pct = round(float(row["ret_1d"]) * 100, 2) if pd.notna(row.get("ret_1d")) else None
    high_52w = float(row["high_52w_incl"]) if pd.notna(row.get("high_52w_incl")) else None
    pct_from_52w_high = round((close - high_52w) / high_52w * 100, 2) if high_52w and high_52w > 0 else None
    stage = int(row.get("stage_2") == 1 and 2 or row.get("stage_1") == 1 and 1 or row.get("stage_3") == 1 and 3 or row.get("stage_4") == 1 and 4 or 0)
    rs_rank = int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else None

    return {
        "trade_date": row["trade_date"],
        "screener": res["screener"],
        "token": int(row["token"]),
        "symbol": str(row["symbol"]),
        "close": close,
        "ret_1d_pct": ret_1d_pct,
        "vol_ratio": vol_ratio,
        "pct_from_52w_high": pct_from_52w_high,
        "pivot": res["pivot"],
        "dist_to_pivot_pct": res["dist_to_pivot_pct"],
        "rs_rank": rs_rank,
        "stage": stage,
        "in_nifty500": in_nifty500,
        "extra": {
            "overlay": res["overlay"],
            "sort_key": res["sort_key"]
        }
    }

# -----------------------------------------------------------------------------
# Main Screener Pipeline
# -----------------------------------------------------------------------------

def run_screeners(
    df_all: pd.DataFrame,
    target_date: Any,
    conn=None
) -> Dict[str, Any]:
    """
    Executes the 5 screeners on target_date, stores results in daily_screener_results,
    stores 260-session chart candles in screener_candles, and enforces retention.
    """
    target_date_val = to_date(target_date)
    target_date_str = target_date_val.strftime("%Y-%m-%d")

    logger.info(f"Executing screener pipeline for trade_date={target_date_str}...")
    close_conn = False
    if conn is None:
        conn = get_connection()
        close_conn = True

    try:
        # 1. Fetch Nifty 500 active constituent symbols for in_nifty500 flag
        with conn.cursor() as cur:
            cur.execute("""
                SELECT symbol FROM index_constituents
                WHERE index_name = 'nifty500' AND (is_active = TRUE OR effective_to IS NULL);
            """)
            nifty500_symbols = {r[0] for r in cur.fetchall()}

        # 2. Add screener indicators across all historical data
        df = compute_screener_indicators(df_all)

        # Slice target date (matching string)
        df_target = df[df["trade_date"].astype(str) == target_date_str].copy()
        if df_target.empty:
            logger.warning(f"No records found for target_date={target_date_str} in parquet store.")
            return {"status": "empty", "trade_date": target_date_str, "counts": {}}

        # Compute earliest-store cutoff ONCE before the token loop, as the date of the 6th session in the store
        store_dates_raw = sorted(df["trade_date"].unique())
        session_idx_6th = min(SCREENER_PARAMS["ipo_base"]["earliest_store_session_idx"], len(store_dates_raw) - 1)
        earliest_cutoff_date = to_date(store_dates_raw[session_idx_6th])

        # 3. Common eligibility filter
        trad = SCREENER_PARAMS["tradability"]
        df_target["traded_value"] = df_target["close"] * df_target["vol_sma_50"]

        base_eligible = (
            (df_target["close"] >= trad["min_close"]) &
            (df_target["vol_sma_50"] >= trad["min_vol_sma_50"]) &
            (df_target["traded_value"] >= trad["min_traded_value"])
        )
        std_eligible = base_eligible & (df_target["session_idx"] >= trad["min_history_sessions"])

        # 4. Calculate RS rank across eligible universe
        df_target["rs_rank"] = calculate_rs_rank(df_target, std_eligible)

        # 5. Evaluate Trend Template
        df_target["tt_pass"] = False
        for idx, row in df_target[std_eligible].iterrows():
            df_target.at[idx, "tt_pass"] = evaluate_trend_template(row, SCREENER_PARAMS)

        screener_candidates: Dict[str, List[Dict[str, Any]]] = {
            "stage2_breakout": [],
            "vcp": [],
            "near_pivot": [],
            "ipo_base": [],
            "ema50_pullback": [],
        }

        # Token historical cache for quick slice evaluations
        token_groups = {token: group for token, group in df.groupby("token")}

        # 6. Evaluate Screeners for each token on target_date
        for idx, row in df_target.iterrows():
            token = int(row["token"])
            symbol = str(row["symbol"])
            in_nifty500 = symbol in nifty500_symbols

            stock_hist = token_groups.get(token)
            if stock_hist is None or stock_hist.empty:
                continue

            # Prior rows up to target_date (including target_date as last row)
            stock_up_to_today = stock_hist[stock_hist["trade_date"].astype(str) <= target_date_str]

            # 6.1 Stage 2 Breakout
            res_s2 = eval_stage2_breakout(row, stock_up_to_today, SCREENER_PARAMS)
            if res_s2:
                screener_candidates["stage2_breakout"].append(make_candidate_record(row, res_s2, in_nifty500))

            # 6.2 VCP
            res_vcp = eval_vcp(row, stock_up_to_today, SCREENER_PARAMS)
            if res_vcp:
                screener_candidates["vcp"].append(make_candidate_record(row, res_vcp, in_nifty500))

            # 6.3 Near Pivot
            res_np = eval_near_pivot(row, stock_up_to_today, SCREENER_PARAMS)
            if res_np:
                screener_candidates["near_pivot"].append(make_candidate_record(row, res_np, in_nifty500))

            # 6.4 IPO Base (Skips TT, uses cutoff date and tradability floor)
            res_ipo = eval_ipo_base(row, stock_up_to_today, earliest_cutoff_date, SCREENER_PARAMS)
            if res_ipo:
                screener_candidates["ipo_base"].append(make_candidate_record(row, res_ipo, in_nifty500))

            # 6.5 50 EMA Pullback
            res_pb = eval_ema50_pullback(row, stock_up_to_today, SCREENER_PARAMS)
            if res_pb:
                screener_candidates["ema50_pullback"].append(make_candidate_record(row, res_pb, in_nifty500))

        # 7. Sort candidates per spec rules
        # stage2_breakout: vol_ratio desc
        screener_candidates["stage2_breakout"].sort(key=lambda x: x["extra"]["sort_key"], reverse=True)
        # vcp: range_pct(w3) asc
        screener_candidates["vcp"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)
        # near_pivot: dist_to_pivot asc
        screener_candidates["near_pivot"].sort(key=lambda x: x["extra"]["sort_key"], reverse=False)
        # ipo_base: dist_from_listing_high asc
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

        # 8. Write to database in a single idempotent transaction
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

        # 9. Extract and store chart candles for tokens that passed today
        # Cap at 300 tokens by RS rank (tokens with NaN rs_rank sort as 0)
        cap = SCREENER_PARAMS["candle_stock_cap"]
        token_rs_map = {}
        for _, row in df_target.iterrows():
            t = int(row["token"])
            rk = row.get("rs_rank")
            token_rs_map[t] = int(rk) if pd.notna(rk) else 0

        tokens_ordered = sorted(
            tokens_passed_today,
            key=lambda t: token_rs_map.get(t, 0),
            reverse=True
        )[:cap]

        logger.info(f"Storing last 260 chart candles for {len(tokens_ordered)} tokens (capped at {cap})...")

        candle_records = []
        for t in tokens_ordered:
            stock_data = token_groups.get(t)
            if stock_data is None or stock_data.empty:
                continue
            # Filter up to target_date and take last 260 sessions
            stock_window = stock_data[stock_data["trade_date"].astype(str) <= target_date_str].iloc[-SCREENER_PARAMS["candle_window_sessions"]:]
            for _, r in stock_window.iterrows():
                candle_records.append((
                    int(t),
                    r["trade_date"],
                    float(r["open"]) if pd.notna(r["open"]) else None,
                    float(r["high"]) if pd.notna(r["high"]) else None,
                    float(r["low"]) if pd.notna(r["low"]) else None,
                    float(r["close"]),
                    int(r["volume"]) if pd.notna(r["volume"]) else None,
                    float(r["sma_10"]) if pd.notna(r["sma_10"]) else None,
                    float(r["sma_20"]) if pd.notna(r["sma_20"]) else None,
                    float(r["sma_50"]) if pd.notna(r["sma_50"]) else None,
                    float(r["sma_150"]) if pd.notna(r["sma_150"]) else None,
                    float(r["sma_200"]) if pd.notna(r["sma_200"]) else None,
                    float(r["ema_50"]) if pd.notna(r["ema_50"]) else None,
                ))

        with conn.cursor() as cur:
            # Delete tokens not in today's active set
            if tokens_ordered:
                cur.execute("""
                    DELETE FROM screener_candles
                    WHERE token NOT IN %s;
                """, (tuple(tokens_ordered),))
            else:
                cur.execute("DELETE FROM screener_candles;")

            if candle_records:
                from psycopg2.extras import execute_batch
                insert_candles_sql = """
                    INSERT INTO screener_candles (
                        token, trade_date, open, high, low, close, volume,
                        sma_10, sma_20, sma_50, sma_150, sma_200, ema_50
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (token, trade_date) DO UPDATE
                    SET open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume,
                        sma_10 = EXCLUDED.sma_10,
                        sma_20 = EXCLUDED.sma_20,
                        sma_50 = EXCLUDED.sma_50,
                        sma_150 = EXCLUDED.sma_150,
                        sma_200 = EXCLUDED.sma_200,
                        ema_50 = EXCLUDED.ema_50;
                """
                execute_batch(cur, insert_candles_sql, candle_records, page_size=1000)

            # Delete rows older than the 260-session window per token
            cur.execute("""
                DELETE FROM screener_candles
                WHERE (token, trade_date) NOT IN (
                    SELECT token, trade_date
                    FROM (
                        SELECT token, trade_date,
                               ROW_NUMBER() OVER (PARTITION BY token ORDER BY trade_date DESC) as rn
                        FROM screener_candles
                    ) t
                    WHERE rn <= %s
                );
            """, (SCREENER_PARAMS["candle_window_sessions"],))

        conn.commit()
        logger.info(f"Screener pipeline complete for {target_date_str}: {len(all_results_to_insert)} results, {len(candle_records)} candles.")

        return {
            "status": "success",
            "trade_date": target_date_str,
            "counts": counts,
            "candidates": screener_candidates,
            "tokens_saved": len(tokens_ordered),
            "candles_saved": len(candle_records)
        }

    except Exception as e:
        logger.error(f"Screener execution failed: {e}", exc_info=True)
        if conn:
            conn.rollback()
        raise e
    finally:
        if close_conn and conn:
            conn.close()
