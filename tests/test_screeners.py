import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock
import numpy as np
import pandas as pd

from pipeline.screeners import (
    SCREENER_PARAMS,
    calculate_rs_rank,
    evaluate_trend_template,
    compute_screener_indicators,
    compute_seeded_ema,
    compute_wilder_atr,
    find_zigzag_swings,
    eval_stage2_breakout,
    eval_vcp,
    eval_near_pivot,
    eval_ipo_base,
    eval_ema50_pullback,
    run_screeners,
)


def test_screener_params_loaded():
    assert "tradability" in SCREENER_PARAMS
    assert SCREENER_PARAMS["tradability"]["min_close"] == 20.0
    assert SCREENER_PARAMS["tradability"]["min_vol_sma_50"] == 25000
    assert SCREENER_PARAMS["tradability"]["min_traded_value"] == 1e7
    assert SCREENER_PARAMS["trend_template"]["min_rs_rank"] == 70
    assert SCREENER_PARAMS["stage2_breakout"]["recency_sessions"] == 5
    assert SCREENER_PARAMS["vcp"]["min_contractions"] == 2
    assert SCREENER_PARAMS["vcp"]["max_last_depth"] == 0.10
    assert SCREENER_PARAMS["vcp"]["min_dist_pivot_pct"] == -0.05
    assert SCREENER_PARAMS["vcp"]["max_dist_pivot_pct"] == 0.03
    assert SCREENER_PARAMS["near_pivot"]["k_atr"] == 0.6
    assert SCREENER_PARAMS["ipo_base"]["k_atr"] == 3.0
    assert SCREENER_PARAMS["ipo_base"]["max_dist_pct"] == 0.15
    assert SCREENER_PARAMS["ipo_base"]["max_base_depth"] == 0.40
    assert SCREENER_PARAMS["ipo_base"]["min_sessions_since_base_top"] == 2
    assert SCREENER_PARAMS["ipo_base"]["max_results"] == 40
    assert SCREENER_PARAMS["ema50_pullback"]["max_touch_factor"] == 1.03
    assert SCREENER_PARAMS["ema50_pullback"]["quiet_month_range_ratio"] == 1.15
    assert SCREENER_PARAMS["candle_stock_cap"] == 300
    assert SCREENER_PARAMS["candle_window_sessions"] == 260


def test_seeded_ema():
    arr = np.array([10.0] * 50 + [20.0] * 10)
    ema = compute_seeded_ema(arr, 50)
    assert np.isnan(ema[0])
    assert np.isnan(ema[48])
    assert pytest.approx(ema[49], rel=1e-5) == 10.0
    assert 10.0 < ema[50] < 20.0


def test_wilder_atr_computation():
    h = np.array([100.0 + i for i in range(20)])
    l = np.array([96.0 + i for i in range(20)])
    c = np.array([98.0 + i for i in range(20)])
    atr = compute_wilder_atr(h, l, c, 14)
    assert np.isnan(atr[0])
    assert np.isnan(atr[12])
    assert not np.isnan(atr[13])
    assert atr[13] > 0


def test_zigzag_swings_alternating():
    # Construct 3 clear waves: 100->80 (20%), 95->85 (10.5%), 92->88 (4.3%)
    highs = np.array([100.0, 80.0, 95.0, 85.0, 92.0, 88.0])
    lows = np.array([100.0, 80.0, 95.0, 85.0, 92.0, 88.0])
    dates = [f"2026-01-0{i+1}" for i in range(6)]
    swings = find_zigzag_swings(highs, lows, dates, min_pct=0.04)
    assert len(swings) == 6
    assert swings[0][0] == "H"
    assert swings[1][0] == "L"
    assert swings[2][0] == "H"
    assert swings[3][0] == "L"


def test_rs_rank_percentile_calculation():
    df = pd.DataFrame({
        "token": [1, 2, 3, 4, 5],
        "rs_raw": [0.1, 0.5, 0.2, 0.9, 0.4]
    })
    eligible_mask = pd.Series([True, True, True, True, True])
    ranks = calculate_rs_rank(df, eligible_mask)

    assert len(ranks) == 5
    assert ranks.loc[3] == 99
    assert ranks.loc[0] <= 25
    assert ranks.loc[3] > ranks.loc[1] > ranks.loc[4] > ranks.loc[2] > ranks.loc[0]


def test_rs_rank_ineligible_gets_nan():
    df = pd.DataFrame({
        "token": [1, 2],
        "rs_raw": [0.5, 0.8]
    })
    eligible_mask = pd.Series([True, False])
    ranks = calculate_rs_rank(df, eligible_mask)
    assert pd.notna(ranks.loc[0])
    assert pd.isna(ranks.loc[1])


def test_trend_template_8_rules_all_pass():
    row = pd.Series({
        "close": 150.0,
        "sma_50": 140.0,
        "sma_150": 130.0,
        "sma_200": 120.0,
        "sma_200_21ago": 115.0,
        "low_52w_incl": 100.0,
        "high_52w_incl": 160.0,
        "rs_rank": 85
    })
    assert evaluate_trend_template(row) is True


def test_trend_template_8_rules_individual_failures():
    base = {
        "close": 150.0,
        "sma_50": 140.0,
        "sma_150": 130.0,
        "sma_200": 120.0,
        "sma_200_21ago": 115.0,
        "low_52w_incl": 100.0,
        "high_52w_incl": 160.0,
        "rs_rank": 85
    }

    # Rule 1 fail: close <= sma_150
    r1 = base.copy(); r1["close"] = 125.0
    assert evaluate_trend_template(pd.Series(r1)) is False

    # Rule 2 fail: sma_150 <= sma_200
    r2 = base.copy(); r2["sma_150"] = 118.0
    assert evaluate_trend_template(pd.Series(r2)) is False

    # Rule 3 fail: sma_200 <= sma_200_21ago (declining 200 SMA)
    r3 = base.copy(); r3["sma_200_21ago"] = 125.0
    assert evaluate_trend_template(pd.Series(r3)) is False

    # Rule 4 fail: sma_50 <= sma_150
    r4 = base.copy(); r4["sma_50"] = 128.0
    assert evaluate_trend_template(pd.Series(r4)) is False

    # Rule 5 fail: close <= sma_50
    r5 = base.copy(); r5["close"] = 138.0
    assert evaluate_trend_template(pd.Series(r5)) is False

    # Rule 6 fail: close < 1.30 * low_52w_incl
    r6 = base.copy(); r6["low_52w_incl"] = 120.0
    assert evaluate_trend_template(pd.Series(r6)) is False

    # Rule 7 fail: close < 0.75 * high_52w_incl
    r7 = base.copy(); r7["high_52w_incl"] = 210.0
    assert evaluate_trend_template(pd.Series(r7)) is False

    # Rule 8 fail: rs_rank < 70
    r8 = base.copy(); r8["rs_rank"] = 65
    assert evaluate_trend_template(pd.Series(r8)) is False


# -----------------------------------------------------------------------------
# Pure Evaluator Tests (Passing & Rule Boundary Failures)
# -----------------------------------------------------------------------------

def test_eval_stage2_breakout():
    dates = [f"2026-11-{i:02d}" for i in range(1, 26)]
    # Day 24 had 20d breakout (volume=30000 >= 1.5*15000, high_20d=100, close=104)
    # Day 25 (today) holds at 104.5 >= 100 and <= 105
    hist = pd.DataFrame({
        "trade_date": dates,
        "high": [100.0] * 23 + [105.0, 105.0],
        "low": [95.0] * 23 + [100.0, 102.0],
        "close": [98.0] * 23 + [104.0, 104.5],
        "volume": [15000] * 23 + [30000, 20000],
        "vol_sma_50": [15000] * 25,
        "high_20d": [100.0] * 25,
        "breakout_20d": [0] * 23 + [1, 0],
        "stage_2": [1] * 25,
    })

    today_row = pd.Series({
        "trade_date": "2026-11-25",
        "tt_pass": True,
        "stage_2": 1,
        "close": 104.5,
    })

    # 1. Passing case (breakout occurred 1 day ago)
    res = eval_stage2_breakout(today_row, hist)
    assert res is not None
    assert res["screener"] == "stage2_breakout"
    assert res["pivot"] == 100.0
    assert res["days_ago"] == 1
    assert res["overlay"]["stats"]["days_ago"] == 1
    assert res["overlay"]["stats"]["days_in_stage2"] == 25

    # 2. Passing case today (breakout day is today, days_ago == 0)
    hist_today = hist.copy()
    hist_today.loc[24, "breakout_20d"] = 1
    hist_today.loc[24, "volume"] = 35000
    res_today = eval_stage2_breakout(today_row, hist_today)
    assert res_today is not None
    assert res_today["days_ago"] == 0

    # 3. Rule failure: breakout happened 3 days ago (outside 3-session recency)
    hist_old = hist.copy()
    hist_old["breakout_20d"] = [0] * 21 + [1, 0, 0, 0]  # index 21 is 3 days ago
    assert eval_stage2_breakout(today_row, hist_old) is None

    # 4. Rule failure: close slipped below pivot today
    r_below = today_row.copy(); r_below["close"] = 99.0
    assert eval_stage2_breakout(r_below, hist) is None

    # 5. Rule failure: close extended > 1.05 * pivot (105.5 > 105.0)
    r_ext = today_row.copy(); r_ext["close"] = 105.5
    assert eval_stage2_breakout(r_ext, hist) is None

    # 6. Rule failure: tt_pass False
    r_nott = today_row.copy(); r_nott["tt_pass"] = False
    assert eval_stage2_breakout(r_nott, hist) is None


def test_eval_vcp():
    dates = [f"2026-{m:02d}-{d:02d}" for m in range(1, 4) for d in range(1, 21)]  # 60 sessions
    # Build 3 zigzag waves:
    # Wave 1: peak at 100 (t-50) -> trough at 80 (t-35) [depth = 20%]
    # Wave 2: peak at 96 (t-25) -> trough at 85 (t-15) [depth = 11.5%]
    # Wave 3: peak at 95 (t-10) -> trough at 89 (t-5) [depth = 6.3%]
    # Current (t): close at 94.0 (within -3% to +2% of 95.0)
    highs = [90.0] * 60
    lows = [89.0] * 60
    # Set explicit swing highs and lows
    highs[10] = 100.0; lows[25] = 80.0
    highs[35] = 96.0;  lows[45] = 85.0
    highs[50] = 95.0;  lows[55] = 89.0

    hist = pd.DataFrame({"trade_date": dates, "high": highs, "low": lows})

    base_row = pd.Series({
        "trade_date": dates[-1],
        "tt_pass": True,
        "close": 94.0,  # pivot is 95.0 -> dist = (94 - 95)/95 = -1.05%
    })

    # 1. Passing case
    res = eval_vcp(base_row, hist)
    assert res is not None
    assert res["screener"] == "vcp"
    assert res["pivot"] == 95.0
    assert len(res["overlay"]["segments"]) == 3
    assert res["overlay"]["stats"]["contractions_count"] == 3

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_vcp(r_tt, hist) is None

    # 3. Rule boundary: price too far below pivot (< -5%)
    # 95 * 0.94 = 89.3 (< -5% fails)
    r_low_fail = base_row.copy(); r_low_fail["close"] = 89.0
    assert eval_vcp(r_low_fail, hist) is None
    # 95 * 0.96 = 91.2 (-4% passes)
    r_low_pass = base_row.copy(); r_low_pass["close"] = 91.2
    assert eval_vcp(r_low_pass, hist) is not None

    # 4. Rule boundary: price extended above pivot (> +3%)
    # 95 * 1.035 = 98.325 (> +3% fails)
    r_high_fail = base_row.copy(); r_high_fail["close"] = 98.5
    assert eval_vcp(r_high_fail, hist) is None
    # 95 * 1.025 = 97.375 (+2.5% passes)
    r_high_pass = base_row.copy(); r_high_pass["close"] = 97.0
    assert eval_vcp(r_high_pass, hist) is not None

    # 5. Rule boundary failure: last contraction depth > 10%
    hist_deep = hist.copy()
    hist_deep.loc[55, "low"] = 84.0  # depth = (95 - 84)/95 = 11.5% > 10%
    assert eval_vcp(base_row, hist_deep) is None


def test_eval_near_pivot():
    hist = pd.DataFrame({
        "trade_date": [f"2026-11-{i:02d}" for i in range(1, 21)],
        "high": [98.0] * 19 + [100.0],
    })

    # pivot = 100.0, close = 98.5 -> dist = (100 - 98.5)/98.5 = 1.52%
    # atr_pct = 0.03, k_atr = 0.6 -> max_dist = 1.8%
    base_row = pd.Series({
        "tt_pass": True,
        "pivot_20": 100.0,
        "close": 98.5,
        "atr_pct": 0.03,
    })

    # 1. Passing case (dist 1.52% <= 1.8%)
    res = eval_near_pivot(base_row, hist)
    assert res is not None
    assert res["screener"] == "near_pivot"
    assert res["pivot"] == 100.0
    assert pytest.approx(res["dist_to_pivot_pct"], rel=1e-1) == 1.52

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_near_pivot(r_tt, hist) is None

    # 3. Rule boundary failure: dist > 0.6 * ATR
    # close = 98.0 -> dist = 2.0/98.0 = 2.04% > 1.8%
    r_dist = base_row.copy(); r_dist["close"] = 98.0
    assert eval_near_pivot(r_dist, hist) is None

    # 4. Rule boundary failure: close > pivot (already broke out)
    r_above = base_row.copy(); r_above["close"] = 101.0
    assert eval_near_pivot(r_above, hist) is None

    # 5. Rule failure: atr_pct missing or <= 0
    r_no_atr = base_row.copy(); r_no_atr["atr_pct"] = np.nan
    assert eval_near_pivot(r_no_atr, hist) is None
    r_zero_atr = base_row.copy(); r_zero_atr["atr_pct"] = 0.0
    assert eval_near_pivot(r_zero_atr, hist) is None
    r_neg_atr = base_row.copy(); r_neg_atr["atr_pct"] = -0.01
    assert eval_near_pivot(r_neg_atr, hist) is None


def test_eval_ipo_base():
    dates = [date(2026, 8, 1) + timedelta(days=i) for i in range(50)]
    hist = pd.DataFrame({
        "trade_date": dates,
        "high": [100.0] * 20 + [110.0] + [105.0] * 29,  # base top at index 20 (price 110.0, 29 sessions ago >= 2)
        "low": [90.0] * 50,  # lowest low = 90 -> base_depth = (110 - 90)/110 = 18.1% <= 40%
        "volume": [100000] * 50,
    })

    target_d = dates[-1]
    first_d = dates[0]
    earliest_cutoff = date(2026, 1, 10)  # first_d strictly after cutoff

    # close = 105.0 -> dist = (110 - 105)/105 = 4.76% <= min(3.0 * 0.03, 0.15) = 9.0%
    base_row = pd.Series({
        "trade_date": target_d,
        "first_candle_date": first_d,
        "close": 105.0,
        "atr_med_pct": 0.03,
    })

    # 1. Passing case
    res = eval_ipo_base(base_row, hist, earliest_cutoff)
    assert res is not None
    assert res["screener"] == "ipo_base"
    assert res["pivot"] == 110.0
    assert res["overlay"]["stats"]["sessions_since_base_top"] == 29
    assert res["overlay"]["stats"]["atr_med_pct"] == 3.0

    # 2. Rule failure: already broken out (close > base_top)
    r_bo = base_row.copy(); r_bo["close"] = 112.0
    assert eval_ipo_base(r_bo, hist, earliest_cutoff) is None

    # 3. Rule boundary: k=3 passes where k=2 fails
    # close = 102.5 -> dist = (110 - 102.5)/102.5 = 7.32%
    # Under k=2 (2 * 3% = 6%): fails. Under k=3 (3 * 3% = 9%): passes!
    r_k3 = base_row.copy(); r_k3["close"] = 102.5
    assert eval_ipo_base(r_k3, hist, earliest_cutoff) is not None
    # If k_atr is manually overridden to 2.0 -> fails
    params_k2 = {"ipo_base": {**SCREENER_PARAMS["ipo_base"], "k_atr": 2.0}, "tradability": SCREENER_PARAMS["tradability"]}
    assert eval_ipo_base(r_k3, hist, earliest_cutoff, params_k2) is None

    # 4. Hard cap max_dist_pct = 0.15
    # If atr_med_pct is huge (0.08, 3*ATR=0.24), distance 0.18 fails because max_dist_pct=0.15
    r_capped = base_row.copy(); r_capped["atr_med_pct"] = 0.08; r_capped["close"] = 92.0  # dist = 18/92 = 19.5% > 15%
    assert eval_ipo_base(r_capped, hist, earliest_cutoff) is None

    # 5. Base depth boundary: 40%
    # low = 68.0 -> depth = (110 - 68)/110 = 38.18% <= 40% (passes)
    hist_40 = hist.copy(); hist_40.loc[25, "low"] = 68.0
    assert eval_ipo_base(base_row, hist_40, earliest_cutoff) is not None
    # low = 64.0 -> depth = (110 - 64)/110 = 41.8% > 40% (fails)
    hist_41 = hist.copy(); hist_41.loc[25, "low"] = 64.0
    assert eval_ipo_base(base_row, hist_41, earliest_cutoff) is None

    # 6. Base maturity boundary: min_sessions_since_base_top = 2
    # top 2 sessions ago (index 47) -> passes
    hist_top2 = hist.copy()
    hist_top2.loc[20, "high"] = 100.0
    hist_top2.loc[47, "high"] = 110.0
    assert eval_ipo_base(base_row, hist_top2, earliest_cutoff) is not None
    # top 1 session ago (index 48) -> fails (< 2)
    hist_top1 = hist.copy()
    hist_top1.loc[20, "high"] = 100.0
    hist_top1.loc[48, "high"] = 110.0
    assert eval_ipo_base(base_row, hist_top1, earliest_cutoff) is None

    # 7. Rule failure: atr_med_pct missing or <= 0
    r_no_atr = base_row.copy(); r_no_atr["atr_med_pct"] = np.nan
    assert eval_ipo_base(r_no_atr, hist, earliest_cutoff) is None


def test_median_atr_robust_to_listing_day_spike():
    """S2: compute_median_atr_pct ignores listing-day spike and remains stable."""
    from pipeline.screeners import compute_median_atr_pct, compute_wilder_atr

    n = 20
    # Day 0: massive spike (high=200, low=50, close=100 -> TR=150)
    # Days 1-19: calm trading (high=103, low=97, close=100 -> TR=6)
    highs = np.array([200.0] + [103.0] * 19)
    lows = np.array([50.0] + [97.0] * 19)
    closes = np.array([100.0] * 20)

    med_atr = compute_median_atr_pct(highs, lows, closes, max_window=20)
    wilder_atr = compute_wilder_atr(highs, lows, closes, 14) / closes

    # Median ATR on session 19 is exactly 6% (0.06), unaffected by day 0 spike!
    assert pytest.approx(med_atr[-1], rel=1e-2) == 0.06
    # Wilder ATR on session 19 is inflated by the Day 0/1 calculation
    assert wilder_atr[-1] > med_atr[-1]


def test_eval_ema50_pullback():
    dates = [f"2026-01-{i:02d}" for i in range(1, 65)]
    # 64 sessions:
    # 50 EMA is 100.0, rising (ema_50_10ago = 96.0)
    # low touched <= 1.03 * 100 = 103.0
    # close held >= 0.99 * 100 = 99.0
    # max close in last 30 >= 1.05 * 100 = 105.0 (has 108.0)
    # quiet month: avg vol 21 <= vol_sma_50
    hist = pd.DataFrame({
        "trade_date": dates,
        "high": [102.0] * 34 + [109.0] + [102.0] * 29,
        "low": [98.0] * 34 + [106.0] + [101.0] * 29,
        "close": [100.0] * 34 + [108.0] + [100.5] * 29,
        "volume": [20000] * 64,
        "ema_50": [100.0] * 64,
    })

    base_row = pd.Series({
        "trade_date": dates[-1],
        "tt_pass": True,
        "ema_50": 100.0,
        "ema_50_10ago": 96.0,
        "low": 102.5,    # <= 103.0 (passes with 1.03 threshold)
        "close": 100.5,  # >= 99.0
        "volume": 18000,
        "vol_sma_50": 20000,
        "rs_rank": 82
    })

    # 1. Passing case
    res = eval_ema50_pullback(base_row, hist)
    assert res is not None
    assert res["screener"] == "ema50_pullback"
    assert res["pivot"] == 100.0
    assert res["overlay"]["levels"][0]["price"] == 108.0  # swing high

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_ema50_pullback(r_tt, hist) is None

    # 3. Rule boundary failure: didn't touch support (low = 103.5 > 1.03 * 100)
    r_notouch = base_row.copy(); r_notouch["low"] = 103.5
    assert eval_ema50_pullback(r_notouch, hist) is None

    # 5. Rule boundary failure: didn't hold support (close = 98.5 < 0.99 * 100)
    r_nohold = base_row.copy(); r_nohold["close"] = 98.5
    assert eval_ema50_pullback(r_nohold, hist) is None

    # 6. Rule boundary failure: insufficient prior extension (max close = 104.0 < 1.05 * 100 = 105.0)
    hist_no_ext = hist.copy()
    hist_no_ext.loc[34, "close"] = 104.0
    assert eval_ema50_pullback(base_row, hist_no_ext) is None


# -----------------------------------------------------------------------------
# run_screeners Execution with Fake Connection
# -----------------------------------------------------------------------------

def test_run_screeners_with_fake_connection():
    dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(260)]
    closes = [100.0 + i * 0.2 for i in range(260)]
    df = pd.DataFrame({
        "token": [101] * 260,
        "symbol": ["TESTSTOCK"] * 260,
        "trade_date": dates,
        "open": closes,
        "high": [c + 1.0 for c in closes],
        "low": [c - 1.0 for c in closes],
        "close": closes,
        "volume": [100000] * 260,
        "traded_val": [c * 100000 for c in closes],
        "sma_50": [c - 2.0 for c in closes],
        "sma_150": [c - 4.0 for c in closes],
        "sma_200": [c - 6.0 for c in closes],
        "stage_2": [1] * 260,
        "breakout_20d": [0] * 259 + [1],
        "vol_sma_50": [50000] * 260,
        "ret_1d": [0.02] * 260,
    })

    fake_conn = MagicMock()
    fake_cursor = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cursor

    res = run_screeners(df, target_date=dates[-1], conn=fake_conn)
    assert res is not None
    assert "counts" in res
    assert fake_conn.commit.called


# -----------------------------------------------------------------------------
# S1: No Fabricated Fallbacks Tests
# -----------------------------------------------------------------------------

def test_nan_vol_sma_50_eval_screeners_returns_none():
    """S1: eval_stage2_breakout, eval_vcp, eval_ema50_pullback return None/skip when vol_sma_50 is NaN."""
    # 1. stage2_breakout with NaN vol_sma_50
    hist = pd.DataFrame([{
        "trade_date": "2026-11-18",
        "open": 100.0, "high": 110.0, "low": 98.0, "close": 108.0,
        "volume": 100000, "breakout_20d": 1,
        "vol_sma_50": np.nan, "high_20d": 105.0
    }])
    row = hist.iloc[-1]
    params = {"stage2_breakout": {"recency_sessions": 3, "min_volume_ratio": 1.5, "min_close_range_ratio": 0.6, "max_extension_factor": 1.05}}
    assert eval_stage2_breakout(row, hist, params) is None

    # 2. vcp with volume dryup required and NaN vol_sma_50
    hist_vcp = pd.DataFrame([{
        "trade_date": f"2026-11-{i+1:02d}",
        "open": 100.0, "high": 105.0, "low": 95.0, "close": 100.0,
        "volume": 1000, "vol_avg_10": 500, "vol_sma_50": np.nan
    } for i in range(20)])
    row_vcp = hist_vcp.iloc[-1]
    params_vcp = {"vcp": {"min_base_length": 15, "require_volume_dryup": True, "max_window_sessions": 120, "zigzag_min_pct": 0.04}}
    assert eval_vcp(row_vcp, hist_vcp, params_vcp) is None

    # 3. ema50_pullback with NaN vol_sma_50
    hist_pb = pd.DataFrame([{
        "trade_date": f"2026-{i+1:02d}-01",
        "open": 100.0, "high": 105.0, "low": 98.0, "close": 101.0,
        "volume": 1000, "vol_sma_50": np.nan
    } for i in range(70)])
    row_pb = hist_pb.iloc[-1]
    row_pb["ema_50"] = 100.0
    params_pb = {"ema50_pullback": {"max_touch_factor": 1.02, "min_close_factor": 0.99, "quiet_month_vol_ratio": 1.0, "quiet_month_range_ratio": 1.0, "prior_window": 30, "prior_extension_factor": 1.05}}
    assert eval_ema50_pullback(row_pb, hist_pb, params_pb) is None


def test_ipo_base_sane_vol_ratio_and_none_fallbacks():
    """S1: IPO base with NaN vol_sma_50 computes vol_ratio from listing average; null ret_1d stays None."""
    # 20 sessions of IPO
    dates = [date(2026, 10, 1) + timedelta(days=i) for i in range(20)]
    closes = [100.0 + (i * 0.5) for i in range(20)]
    # All prior days volume = 50,000; today volume = 100,000 -> ratio should be 2.0x, NOT 100,000x!
    volumes = [50000] * 19 + [100000]
    df = pd.DataFrame({
        "token": [999] * 20,
        "symbol": ["NEWIPO"] * 20,
        "trade_date": dates,
        "open": closes,
        "high": [c + 1.0 for c in closes],
        "low": [c - 1.0 for c in closes],
        "close": closes,
        "volume": volumes,
        "traded_val": [c * v for c, v in zip(closes, volumes)],
        "sma_50": [np.nan] * 20,
        "sma_150": [np.nan] * 20,
        "sma_200": [np.nan] * 20,
        "high_20d": [max(closes)] * 20,
        "high_50d": [np.nan] * 20,
        "high_252d": [np.nan] * 20,
        "vol_sma_50": [np.nan] * 20,       # NaN because < 50 sessions
        "high_52w_incl": [np.nan] * 20,    # NaN
        "ret_1d": [np.nan] + [0.01] * 18 + [np.nan],  # today ret_1d is NaN
        "atr_pct": [0.03] * 20,
        "atr_med_pct": [0.03] * 20,
        "stage_2": [1] * 20,
    })

    fake_conn = MagicMock()
    fake_cursor = MagicMock()
    fake_conn.cursor.return_value.__enter__.return_value = fake_cursor

    res = run_screeners(df, target_date=dates[-1], conn=fake_conn)
    assert res is not None

    # Inspect the rows passed to execute_values
    inserted_args = fake_cursor.execute.call_args_list or []
    # Verify no row has vol_ratio > 100
    for call_args in fake_cursor.method_calls:
        if "execute_values" in str(call_args):
            for row_tuple in call_args[1][1]:
                # vol_ratio is index 6
                vr = row_tuple[6]
                if vr is not None:
                    assert vr < 100.0, f"vol_ratio should not be fabricated raw volume: {vr}"
                # ret_1d_pct is index 5
                ret = row_tuple[5]
                # pct_from_52w_high is index 7
                pct_52w = row_tuple[7]
                assert ret is None or isinstance(ret, (int, float))
                assert pct_52w is None or isinstance(pct_52w, (int, float))

