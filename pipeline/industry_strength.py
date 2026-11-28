"""
Vectorized Industry Strength (4-level NSE hierarchy) & RS_STS computation.

Methodology rules (`rs_sts_v1`):
- WINDOW = 26 sessions for RS_STS% (equal-weight group index vs NIFTY 500, Excel PERCENTRANK.INC)
- EMA 20/50/200 (SMA-seeded) and RS line vs 21-day EMA
- Corporate-action break guard (|daily_ret| > 40%)
- ADR% (20-session high/low ratio excluding zero-range bars)
- New listing / IPO window (< 26 sessions): shown in group, excluded from full-window EW RS
"""

import hashlib
import logging
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from pipeline.liquidity import is_liquid_from_series

logger = logging.getLogger("pipeline.industry_strength")

RS_WINDOW = 26
EMA_PERIODS = (20, 50, 200)
RS_EMA_PERIOD = 21
ADR_PERIOD = 20
CORP_ACTION_JUMP = 0.40
METHODOLOGY_VERSION = "rs_sts_v1"

LEVELS = ("macro", "sector", "industry", "basic_industry")


def compute_ibd_rs_score(closes, brk_date: Optional[str]) -> Optional[float]:
    """Compute raw IBD-style RS score (2*3M + 6M + 9M + 12M) if >63 sessions and no break."""
    if len(closes) <= 63 or brk_date is not None:
        return None
    last_close = float(closes[-1])
    if last_close <= 0:
        return None
    r3 = last_close / float(closes[-64]) - 1.0
    r6 = (last_close / float(closes[-127]) - 1.0) if len(closes) > 126 else r3
    r9 = (last_close / float(closes[-190]) - 1.0) if len(closes) > 189 else r3
    r12 = (last_close / float(closes[-253]) - 1.0) if len(closes) > 252 else r3
    return 2.0 * r3 + r6 + r9 + r12


def make_group_id(level: str, full_path: str) -> str:
    """Deterministic collision-free group ID from (level, full_path)."""
    digest = hashlib.sha256(f"{level}|{full_path}".encode("utf-8")).hexdigest()[:16]
    prefix = {
        "macro": "mac",
        "sector": "sec",
        "industry": "ind",
        "basic_industry": "bas",
    }.get(level, "grp")
    return f"{prefix}_{digest}"


def percentrank_inc(arr: List[float], x: float) -> float:
    """Excel PERCENTRANK.INC(array, x) in [0.0, 1.0]."""
    a = sorted(v for v in arr if v is not None and np.isfinite(v))
    n = len(a)
    if n < 2:
        return 0.0
    if x >= a[-1]:
        return 1.0
    if x <= a[0]:
        return 0.0
    for i in range(n - 1):
        if a[i] == x:
            return i / (n - 1)
        if a[i] < x < a[i + 1]:
            frac = (x - a[i]) / (a[i + 1] - a[i])
            return (i + frac) / (n - 1)
    return 1.0


def sma_seeded_ema_flag(closes: np.ndarray, period: int) -> Optional[bool]:
    """True if latest close >= SMA-seeded EMA(period), False if below, None if < period bars."""
    if len(closes) < period:
        return None
    k = 2.0 / (period + 1)
    e = float(np.mean(closes[:period]))
    for c in closes[period:]:
        e = float(c) * k + e * (1.0 - k)
    return bool(float(closes[-1]) >= e)


def compute_rs_ema_flag(ratios: np.ndarray, period: int = RS_EMA_PERIOD) -> Optional[bool]:
    """True if latest RS ratio >= SMA-seeded EMA(21) of RS ratios, None if < period points."""
    if len(ratios) < period:
        return None
    k = 2.0 / (period + 1)
    e = float(np.mean(ratios[:period]))
    for r in ratios[period:]:
        e = float(r) * k + e * (1.0 - k)
    return bool(float(ratios[-1]) >= e)


def last_break_index(closes: np.ndarray, dates: List[str], lookback: int = 252) -> Optional[str]:
    """Most recent date within trailing `lookback` sessions where |daily_ret| > CORP_ACTION_JUMP."""
    if len(closes) < 2:
        return None
    start = max(0, len(closes) - lookback)
    brk = None
    for i in range(start + 1, len(closes)):
        prev_c = closes[i - 1]
        cur_c = closes[i]
        if prev_c > 0:
            ratio = cur_c / prev_c
            if ratio > 1.0 + CORP_ACTION_JUMP or ratio < 1.0 - CORP_ACTION_JUMP:
                brk = dates[i]
    return brk


def compute_adr_pct(highs: np.ndarray, lows: np.ndarray, period: int = ADR_PERIOD) -> Optional[float]:
    """100 * (mean(high / low) - 1) over last `period` non-zero-range bars."""
    ratios = []
    for i in range(len(highs) - 1, -1, -1):
        h = float(highs[i])
        l = float(lows[i])
        if l > 0 and h > l:
            ratios.append(h / l)
            if len(ratios) >= period:
                break
    if len(ratios) < max(2, period // 2):
        return None
    return (sum(ratios) / len(ratios) - 1.0) * 100.0


def compute_period_return(
    dates: List[str],
    closes: np.ndarray,
    sessions: int,
    calendar: List[str],
) -> Optional[float]:
    """% change over `sessions` market sessions; None if insufficient history or break in window."""
    if len(calendar) <= sessions or len(dates) < 2:
        return None
    start_cal = calendar[-(sessions + 1)]
    end_cal = calendar[-1]

    # Find last stock date <= start_cal
    base_idx = None
    for idx in range(len(dates) - 1, -1, -1):
        if dates[idx] <= start_cal:
            base_idx = idx
            break
    if base_idx is None:
        return None

    end_idx = None
    for idx in range(len(dates) - 1, -1, -1):
        if dates[idx] <= end_cal:
            end_idx = idx
            break
    if end_idx is None or end_idx <= base_idx:
        return None

    # Check corporate action break inside [base_idx, end_idx]
    for i in range(base_idx + 1, end_idx + 1):
        a, b = closes[i - 1], closes[i]
        if a > 0:
            r = b / a
            if r > 1.0 + CORP_ACTION_JUMP or r < 1.0 - CORP_ACTION_JUMP:
                return None

    a = float(closes[base_idx])
    b = float(closes[end_idx])
    return ((b / a) - 1.0) * 100.0 if a > 0 else None


def compute_ytd_return(
    dates: List[str],
    closes: np.ndarray,
    latest_date: str,
) -> Optional[float]:
    """% change from last close of prior calendar year to latest close; None if break or listed this year."""
    if len(dates) < 2:
        return None
    cur_year = latest_date[:4]
    base_idx = None
    for idx in range(len(dates) - 1, -1, -1):
        if dates[idx][:4] < cur_year:
            base_idx = idx
            break
    if base_idx is None or base_idx >= len(dates) - 1:
        return None
    for i in range(base_idx + 1, len(dates)):
        a, b = closes[i - 1], closes[i]
        if a > 0:
            r = b / a
            if r > 1.0 + CORP_ACTION_JUMP or r < 1.0 - CORP_ACTION_JUMP:
                return None
    a = float(closes[base_idx])
    b = float(closes[-1])
    return ((b / a) - 1.0) * 100.0 if a > 0 else None


def compute_trend_ranks(
    rows_for_level: List[Dict[str, Any]],
    labels_by_gid: Dict[str, str],
) -> None:
    """
    Blog-style Trend Rank across groups of the same level with >= 5 eligible stocks:
      trend = mean(percentrank_inc(median_1m), percentrank_inc(median_3m), percentrank_inc(median_6m))
      breadth = mean(percentrank_inc(pct_above_50dma), percentrank_inc(pct_above_200dma))
      leaders = percentrank_inc(leader_share)  [eligible stocks with rs_rating >= 70]
      final = (trend + breadth + leaders) / 3
    Sets `rank_trend` (1..N) in-place; groups with < 5 eligible stocks get None.
    Never persists or exposes `final`.
    """
    eligible = [r for r in rows_for_level if (r.get("n_eligible") or 0) >= 5]
    for r in rows_for_level:
        r["rank_trend"] = None
    if not eligible:
        return

    def rank_field(field: str) -> Dict[str, float]:
        vals = [float(r[field]) for r in eligible if r.get(field) is not None]
        if not vals:
            return {}
        return {
            r["group_id"]: percentrank_inc(vals, float(r[field]))
            for r in eligible
            if r.get(field) is not None
        }

    r_1m = rank_field("median_1m")
    r_3m = rank_field("median_3m")
    r_6m = rank_field("median_6m")
    r_50 = rank_field("pct_above_50dma")
    r_200 = rank_field("pct_above_200dma")
    r_lead = rank_field("_leader_share")

    scored: List[Tuple[float, int, str, Dict[str, Any]]] = []
    for r in eligible:
        gid = r["group_id"]
        t_parts = [m[gid] for m in (r_1m, r_3m, r_6m) if gid in m]
        b_parts = [m[gid] for m in (r_50, r_200) if gid in m]
        if not t_parts or not b_parts or gid not in r_lead:
            continue
        trend = sum(t_parts) / len(t_parts)
        breadth = sum(b_parts) / len(b_parts)
        leaders = r_lead[gid]
        final = (trend + breadth + leaders) / 3.0
        scored.append((-final, -(r.get("n_stocks") or 0), labels_by_gid.get(gid, gid), r))

    scored.sort(key=lambda item: (item[0], item[1], item[2]))
    for idx, (_neg_f, _neg_n, _lbl, r) in enumerate(scored, start=1):
        r["rank_trend"] = idx


def equal_weight_rs_series(
    member_maps: List[Dict[str, float]],
    bench_map: Dict[str, float],
    ref_dates: List[str],
) -> Tuple[Optional[List[float]], int]:
    """
    Compute equal-weight group index / normalized benchmark series over `ref_dates`.
    Returns (rs_series, n_members_used) or (None, 0).
    """
    if not ref_dates or not member_maps:
        return None, 0
    d0 = ref_dates[0]
    if d0 not in bench_map or not bench_map[d0]:
        return None, 0
    bench_base = bench_map[d0]
    bench_norm = []
    for d in ref_dates:
        bv = bench_map.get(d)
        if not bv:
            return None, 0
        bench_norm.append(bv / bench_base * 100.0)

    valid = [s for s in member_maps if s.get(d0)]
    if not valid:
        return None, 0

    ewi = []
    for d in ref_dates:
        vals = [s[d] / s[d0] * 100.0 for s in valid if s.get(d)]
        if not vals:
            return None, 0
        ewi.append(sum(vals) / len(vals))

    rs = [ewi[i] / bench_norm[i] for i in range(len(ref_dates))]
    return rs, len(valid)


@dataclass
class ComputedIndustrySnapshot:
    trade_date: str
    total_stocks: int
    classified_stocks: int
    eligible_stocks: int
    groups: List[Dict[str, Any]]
    daily_strength_rows: List[Dict[str, Any]]
    stock_metric_rows: List[Dict[str, Any]]


def _build_group_hierarchy(
    stock_rows: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[Tuple[str, str], str]]:
    """Build deterministic 4-level industry_groups entries and lookup map."""
    groups_by_id: Dict[str, Dict[str, Any]] = {}
    key_to_id: Dict[Tuple[str, str], str] = {}

    for st in stock_rows:
        m = st.get("macro")
        s = st.get("sector")
        i = st.get("industry")
        b = st.get("basic_industry")
        if not (m and s and i and b):
            continue

        m_path = m
        m_id = make_group_id("macro", m_path)
        if m_id not in groups_by_id:
            groups_by_id[m_id] = {
                "group_id": m_id,
                "level": "macro",
                "label": m,
                "parent_id": None,
                "macro_label": m,
                "sector_label": None,
                "industry_label": None,
                "basic_industry_label": None,
                "full_path": m_path,
            }
        key_to_id[("macro", m_path)] = m_id

        s_path = f"{m} > {s}"
        s_id = make_group_id("sector", s_path)
        if s_id not in groups_by_id:
            groups_by_id[s_id] = {
                "group_id": s_id,
                "level": "sector",
                "label": s,
                "parent_id": m_id,
                "macro_label": m,
                "sector_label": s,
                "industry_label": None,
                "basic_industry_label": None,
                "full_path": s_path,
            }
        key_to_id[("sector", s_path)] = s_id

        i_path = f"{m} > {s} > {i}"
        i_id = make_group_id("industry", i_path)
        if i_id not in groups_by_id:
            groups_by_id[i_id] = {
                "group_id": i_id,
                "level": "industry",
                "label": i,
                "parent_id": s_id,
                "macro_label": m,
                "sector_label": s,
                "industry_label": i,
                "basic_industry_label": None,
                "full_path": i_path,
            }
        key_to_id[("industry", i_path)] = i_id

        b_path = f"{m} > {s} > {i} > {b}"
        b_id = make_group_id("basic_industry", b_path)
        if b_id not in groups_by_id:
            groups_by_id[b_id] = {
                "group_id": b_id,
                "level": "basic_industry",
                "label": b,
                "parent_id": i_id,
                "macro_label": m,
                "sector_label": s,
                "industry_label": i,
                "basic_industry_label": b,
                "full_path": b_path,
            }
        key_to_id[("basic_industry", b_path)] = b_id

    return list(groups_by_id.values()), key_to_id


def prepare_stock_arrays(
    df_ohlcv: pd.DataFrame,
    classifications: Dict[int, Dict[str, Any]],
) -> Dict[int, Dict[str, Any]]:
    """Pre-extract sorted per-token numpy arrays once for fast multi-date backfills."""
    df = df_ohlcv.copy()
    df["trade_date"] = df["trade_date"].astype(str).str.slice(0, 10)
    df = df.sort_values(["token", "trade_date"])

    prepared: Dict[int, Dict[str, Any]] = {}
    for token, grp in df.groupby("token", sort=False):
        tok_int = int(token)
        cls_info = classifications.get(tok_int) or {}
        dates = grp["trade_date"].tolist()
        closes = grp["close"].to_numpy(dtype=float)
        highs = grp["high"].to_numpy(dtype=float) if "high" in grp else closes
        lows = grp["low"].to_numpy(dtype=float) if "low" in grp else closes
        vols = grp["volume"].to_numpy(dtype=float) if "volume" in grp else np.zeros_like(closes)
        prepared[tok_int] = {
            "token": tok_int,
            "symbol": str(grp["symbol"].iloc[-1]).strip().upper(),
            "dates": dates,
            "closes": closes,
            "highs": highs,
            "lows": lows,
            "vols": vols,
            "cls": cls_info,
        }
    return prepared


def compute_industry_strength_snapshot(
    df_ohlcv: Optional[pd.DataFrame],
    classifications: Dict[int, Dict[str, Any]],
    bench_series: Dict[str, float],
    mcap_by_symbol: Optional[Dict[str, float]] = None,
    as_of_date: Optional[str] = None,
    prepared_stocks: Optional[Dict[int, Dict[str, Any]]] = None,
) -> ComputedIndustrySnapshot:
    """
    Compute per-stock metrics once and aggregate across all 4 hierarchy levels
    for both 'all' and 'liquid' universes on `as_of_date` (or max available date).
    """
    if not bench_series:
        raise ValueError("bench_series (NIFTY 500) is required for RS_STS computation")

    if prepared_stocks is None:
        if df_ohlcv is None or df_ohlcv.empty:
            raise ValueError("df_ohlcv is empty")
        prepared_stocks = prepare_stock_arrays(df_ohlcv, classifications)

    mcap_map = mcap_by_symbol or {}
    if as_of_date:
        latest_date = as_of_date[:10]
    else:
        latest_date = max(d for item in prepared_stocks.values() for d in item["dates"][-1:])

    # Market calendar aligned to benchmark dates <= latest_date
    calendar = sorted(d for d in bench_series.keys() if d <= latest_date)
    if len(calendar) < 2:
        raise ValueError("Insufficient benchmark dates for computation")
    ref_dates = calendar[-RS_WINDOW:]
    prev_ref_dates = calendar[-(RS_WINDOW + 1):-1] if len(calendar) > RS_WINDOW else []

    # 1. Compute per-stock metrics once
    stock_rows: List[Dict[str, Any]] = []
    stock_close_maps: Dict[int, Dict[str, float]] = {}
    rs_rating_scores: Dict[int, float] = {}

    for tok_int, item in prepared_stocks.items():
        all_dates = item["dates"]
        end_pos = bisect_right(all_dates, latest_date)
        if end_pos == 0 or all_dates[end_pos - 1] != latest_date:
            continue  # only stocks active on latest_date enter snapshot

        dates = all_dates[:end_pos]
        closes = item["closes"][:end_pos]
        highs = item["highs"][:end_pos]
        lows = item["lows"][:end_pos]
        vols = item["vols"][:end_pos]

        sym = item["symbol"]
        cls_info = item["cls"]
        macro = cls_info.get("macro")
        sector = cls_info.get("sector")
        industry = cls_info.get("industry")
        basic_industry = cls_info.get("basic_industry")
        name = cls_info.get("name") or sym
        isin = cls_info.get("isin")

        close_map = {d: float(c) for d, c in zip(dates[-RS_WINDOW - 5 :], closes[-RS_WINDOW - 5 :]) if c > 0}
        stock_close_maps[tok_int] = close_map

        last_close = float(closes[-1])
        is_liquid = is_liquid_from_series(closes, vols)

        # Corporate-action discontinuity guard
        brk_date = last_break_index(closes, dates, lookback=252)
        if brk_date:
            brk_idx = dates.index(brk_date)
            post_closes = closes[brk_idx:]
            post_highs = highs[brk_idx:]
            post_lows = lows[brk_idx:]
            post_dates = dates[brk_idx:]
        else:
            post_closes = closes
            post_highs = highs
            post_lows = lows
            post_dates = dates

        above_20ema = sma_seeded_ema_flag(post_closes, 20)
        above_50dma = sma_seeded_ema_flag(post_closes, 50)
        above_200dma = sma_seeded_ema_flag(post_closes, 200)

        # 20D Closing High / Low on full per-token sequence
        at_20d_high = bool(len(closes) >= 20 and last_close >= float(np.max(closes[-20:])))
        at_20d_low = bool(len(closes) >= 20 and last_close <= float(np.min(closes[-20:])))

        # 52W off-high from trailing 252 intraday highs (post corporate break)
        hi_window = post_highs[-252:]
        hi52 = float(np.max(hi_window)) if len(hi_window) > 0 else 0.0
        pct_from_52w_high = ((hi52 - last_close) / hi52 * 100.0) if hi52 > 0 else None

        adr = compute_adr_pct(post_highs, post_lows, period=ADR_PERIOD)

        ret_1d = compute_period_return(dates, closes, 1, calendar)
        ret_1w = compute_period_return(dates, closes, 5, calendar)
        ret_1m = compute_period_return(dates, closes, 20, calendar)
        ret_3m = compute_period_return(dates, closes, 63, calendar)
        ret_6m = compute_period_return(dates, closes, 126, calendar)
        ret_1y = compute_period_return(dates, closes, 252, calendar)
        ret_ytd = compute_ytd_return(dates, closes, latest_date)

        # Avg turnover in Rs Cr (20 sessions)
        if len(vols) >= 10:
            tail_n = min(20, len(vols))
            avg_turnover_cr = float(np.mean(closes[-tail_n:] * vols[-tail_n:]) / 1e7)
        else:
            avg_turnover_cr = None

        # RS line EMA21 on common benchmark dates (post break)
        common_ratios = np.array(
            [float(c) / bench_series[d] for d, c in zip(post_dates, post_closes) if d in bench_series and bench_series[d] > 0],
            dtype=float,
        )
        rs_above_ema21 = compute_rs_ema_flag(common_ratios, period=RS_EMA_PERIOD)

        # New listing check: listed inside the RS_WINDOW
        first_date = dates[0]
        is_new_listing = bool(len(ref_dates) > 0 and first_date > ref_dates[0])
        eval_dates = [d for d in ref_dates if d >= first_date] if is_new_listing else ref_dates
        listing_sessions = len([d for d in dates[-RS_WINDOW - 5 :] if d in bench_series])

        rs_sts = None
        if len(eval_dates) >= 2 and all(d in close_map for d in eval_dates):
            srs, _ = equal_weight_rs_series([close_map], bench_series, eval_dates)
            if srs is not None:
                rs_sts = percentrank_inc(srs, srs[-1]) * 100.0

        # IBD-style RS rating score (2*3M + 6M + 9M + 12M)
        rs_sc = compute_ibd_rs_score(closes, brk_date)
        if rs_sc is not None:
            rs_rating_scores[tok_int] = rs_sc

        stock_rows.append({
            "trade_date": latest_date,
            "token": tok_int,
            "symbol": sym,
            "name": name,
            "isin": isin,
            "macro": macro,
            "sector": sector,
            "industry": industry,
            "basic_industry": basic_industry,
            "in_universe": bool(macro and sector and industry and basic_industry),
            "is_liquid": is_liquid,
            "is_new_listing": is_new_listing,
            "listing_sessions": listing_sessions,
            "close": round(last_close, 4),
            "ret_1d": round(ret_1d, 4) if ret_1d is not None else None,
            "ret_1w": round(ret_1w, 4) if ret_1w is not None else None,
            "ret_1m": round(ret_1m, 4) if ret_1m is not None else None,
            "ret_3m": round(ret_3m, 4) if ret_3m is not None else None,
            "ret_6m": round(ret_6m, 4) if ret_6m is not None else None,
            "ret_1y": round(ret_1y, 4) if ret_1y is not None else None,
            "ret_ytd": round(ret_ytd, 4) if ret_ytd is not None else None,
            "at_20d_high": at_20d_high,
            "at_20d_low": at_20d_low,
            "pct_from_52w_high": round(pct_from_52w_high, 2) if pct_from_52w_high is not None else None,
            "adr_pct": round(adr, 2) if adr is not None else None,
            "above_20ema": above_20ema,
            "above_50dma": above_50dma,
            "above_200dma": above_200dma,
            "rs_sts": round(rs_sts, 4) if rs_sts is not None else None,
            "rs_above_ema21": rs_above_ema21,
            "rs_rating": None,
            "avg_turnover_cr": round(avg_turnover_cr, 2) if avg_turnover_cr is not None else None,
            "mcap_cr": round(float(mcap_map[sym]), 2) if sym in mcap_map and mcap_map[sym] else None,
            "_has_break_in_window": bool(brk_date and len(ref_dates) > 0 and brk_date >= ref_dates[0]),
        })

    # Assign 1..99 RS ratings across rated stocks
    if rs_rating_scores:
        ordered = sorted(rs_rating_scores, key=rs_rating_scores.get)
        n_rated = len(ordered)
        rating_by_tok = {
            tok: max(1, min(99, round(100 * (idx + 1) / n_rated)))
            for idx, tok in enumerate(ordered)
        }
        for st in stock_rows:
            st["rs_rating"] = rating_by_tok.get(st["token"])

    # 2. Build 4-level hierarchy groups
    groups, key_to_id = _build_group_hierarchy(stock_rows)

    # 3. Aggregate across all 4 levels for 'all' and 'liquid' universes
    daily_strength_rows: List[Dict[str, Any]] = []

    for universe_name in ("all", "liquid"):
        members_by_group: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for st in stock_rows:
            if not st["in_universe"]:
                continue
            if universe_name == "liquid" and not st["is_liquid"]:
                continue
            m, s, i, b = st["macro"], st["sector"], st["industry"], st["basic_industry"]
            members_by_group[key_to_id[("macro", m)]].append(st)
            members_by_group[key_to_id[("sector", f"{m} > {s}")]].append(st)
            members_by_group[key_to_id[("industry", f"{m} > {s} > {i}")]].append(st)
            members_by_group[key_to_id[("basic_industry", f"{m} > {s} > {i} > {b}")]].append(st)

        level_rows_for_rank: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        group_level_by_id = {g["group_id"]: g["level"] for g in groups}
        group_label_by_id = {g["group_id"]: g["label"] for g in groups}

        for gid, members in members_by_group.items():
            eligible_members = [
                st for st in members
                if not st["is_new_listing"] and not st["_has_break_in_window"]
            ]
            eligible_series = [stock_close_maps[st["token"]] for st in eligible_members]
            rs_series, n_elig = equal_weight_rs_series(eligible_series, bench_series, ref_dates)
            rs_sts = (percentrank_inc(rs_series, rs_series[-1]) * 100.0) if rs_series else None
            rs_line_val = rs_series[-1] if rs_series else None
            rs_above_ema21 = (
                compute_rs_ema_flag(np.array(rs_series, dtype=float), period=RS_EMA_PERIOD)
                if rs_series else None
            )

            rs_sts_prev = None
            if prev_ref_dates and eligible_series:
                prev_rs_series, _ = equal_weight_rs_series(eligible_series, bench_series, prev_ref_dates)
                if prev_rs_series:
                    rs_sts_prev = percentrank_inc(prev_rs_series, prev_rs_series[-1]) * 100.0

            def mean_valid(field: str) -> Optional[float]:
                vals = [st[field] for st in members if st[field] is not None]
                return round(sum(vals) / len(vals), 4) if vals else None

            def median_valid(field: str) -> Optional[float]:
                vals = [float(st[field]) for st in members if st[field] is not None]
                return round(float(np.median(vals)), 4) if vals else None

            def pct_true(field: str) -> Tuple[Optional[float], int]:
                vals = [st[field] for st in members if st[field] is not None]
                if not vals:
                    return None, 0
                return round(sum(1 for v in vals if v) / len(vals) * 100.0, 2), len(vals)

            adv = sum(1 for st in members if st["ret_1d"] is not None and st["ret_1d"] > 0)
            dec = sum(1 for st in members if st["ret_1d"] is not None and st["ret_1d"] < 0)
            unch = sum(1 for st in members if st["ret_1d"] is not None and st["ret_1d"] == 0)
            n_20d_high = sum(1 for st in members if st.get("at_20d_high"))
            n_20d_low = sum(1 for st in members if st.get("at_20d_low"))

            n_leaders = sum(1 for st in eligible_members if (st.get("rs_rating") or 0) >= 70)
            leader_share = (n_leaders / n_elig) if n_elig > 0 else None

            pct_20, n_20 = pct_true("above_20ema")
            pct_50, n_50 = pct_true("above_50dma")
            pct_200, n_200 = pct_true("above_200dma")

            mcaps = [st["mcap_cr"] for st in members if st["mcap_cr"] is not None]

            row_dict = {
                "trade_date": latest_date,
                "group_id": gid,
                "universe": universe_name,
                "n_stocks": len(members),
                "n_eligible": n_elig,
                "adv": adv,
                "dec": dec,
                "unch": unch,
                "n_20d_high": n_20d_high,
                "n_20d_low": n_20d_low,
                "ret_1d": mean_valid("ret_1d"),
                "ret_1w": mean_valid("ret_1w"),
                "ret_1m": mean_valid("ret_1m"),
                "ret_3m": mean_valid("ret_3m"),
                "ret_6m": mean_valid("ret_6m"),
                "median_1d": median_valid("ret_1d"),
                "median_1w": median_valid("ret_1w"),
                "median_1m": median_valid("ret_1m"),
                "median_3m": median_valid("ret_3m"),
                "median_6m": median_valid("ret_6m"),
                "median_1y": median_valid("ret_1y"),
                "median_ytd": median_valid("ret_ytd"),
                "rs_sts": round(rs_sts, 4) if rs_sts is not None else None,
                "rs_sts_prev": round(rs_sts_prev, 4) if rs_sts_prev is not None else None,
                "rs_line": round(rs_line_val, 6) if rs_line_val is not None else None,
                "rs_above_ema21": rs_above_ema21,
                "pct_above_20ema": pct_20,
                "pct_above_50dma": pct_50,
                "pct_above_200dma": pct_200,
                "n_valid_20ema": n_20,
                "n_valid_50dma": n_50,
                "n_valid_200dma": n_200,
                "mcap_cr": round(sum(mcaps), 2) if mcaps else None,
                "rank": None,
                "rank_trend": None,
                "rank_trend_prev5": None,
                "rank_trend_change": None,
                "_leader_share": leader_share,
            }
            level_rows_for_rank[group_level_by_id[gid]].append(row_dict)

        # Rank groups per level by rs_sts desc AND compute blog-style rank_trend
        for lvl, rows_list in level_rows_for_rank.items():
            rankable = [r for r in rows_list if r["rs_sts"] is not None]
            rankable.sort(key=lambda r: (-r["rs_sts"], -(r["ret_1m"] or -999.0), r["group_id"]))
            for idx, r in enumerate(rankable, start=1):
                r["rank"] = idx

            compute_trend_ranks(rows_list, group_label_by_id)
            for r in rows_list:
                r.pop("_leader_share", None)
            daily_strength_rows.extend(rows_list)

    # Clean internal keys from stock_rows
    for st in stock_rows:
        st.pop("_has_break_in_window", None)

    classified_cnt = sum(1 for st in stock_rows if st["in_universe"])
    eligible_cnt = sum(1 for st in stock_rows if st["in_universe"] and not st["is_new_listing"])

    return ComputedIndustrySnapshot(
        trade_date=latest_date,
        total_stocks=len(stock_rows),
        classified_stocks=classified_cnt,
        eligible_stocks=eligible_cnt,
        groups=groups,
        daily_strength_rows=daily_strength_rows,
        stock_metric_rows=stock_rows,
    )
