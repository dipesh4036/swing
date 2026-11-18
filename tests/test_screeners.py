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
    assert SCREENER_PARAMS["stage2_breakout"]["recency_sessions"] == 3
    assert SCREENER_PARAMS["vcp"]["min_contractions"] == 2
    assert SCREENER_PARAMS["vcp"]["max_last_depth"] == 0.10
    assert SCREENER_PARAMS["near_pivot"]["k_atr"] == 1.0
    assert SCREENER_PARAMS["ipo_base"]["k_atr"] == 2.0
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

    # 3. Rule boundary failure: price too far below pivot (< -3%)
    # 95 * 0.96 = 91.2 (< -3%)
    r_low = base_row.copy(); r_low["close"] = 91.0
    assert eval_vcp(r_low, hist) is None

    # 4. Rule boundary failure: price extended above pivot (> +2%)
    # 95 * 1.025 = 97.375 (> +2%)
    r_high = base_row.copy(); r_high["close"] = 97.5
    assert eval_vcp(r_high, hist) is None

    # 5. Rule boundary failure: last contraction depth > 10%
    hist_deep = hist.copy()
    hist_deep.loc[55, "low"] = 84.0  # depth = (95 - 84)/95 = 11.5% > 10%
    assert eval_vcp(base_row, hist_deep) is None


def test_eval_near_pivot():
    hist = pd.DataFrame({
        "trade_date": [f"2026-11-{i:02d}" for i in range(1, 21)],
        "high": [98.0] * 19 + [100.0],
    })

    # pivot = 100.0, close = 98.0 -> dist = (100 - 98)/98 = 2.04%
    # atr_pct = 0.03, k_atr = 1.0 -> max_dist = 3.0%
    base_row = pd.Series({
        "tt_pass": True,
        "pivot_20": 100.0,
        "close": 98.0,
        "atr_pct": 0.03,
    })

    # 1. Passing case
    res = eval_near_pivot(base_row, hist)
    assert res is not None
    assert res["screener"] == "near_pivot"
    assert res["pivot"] == 100.0
    assert pytest.approx(res["dist_to_pivot_pct"], rel=1e-1) == 2.04

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_near_pivot(r_tt, hist) is None

    # 3. Rule boundary failure: dist > 1.0 * ATR
    # close = 96.0 -> dist = 4.0/96 = 4.16% > 3.0%
    r_dist = base_row.copy(); r_dist["close"] = 96.0
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
        "high": [100.0] * 20 + [110.0] + [105.0] * 29,  # base top at index 20 (price 110.0, 29 sessions ago >= 5)
        "low": [90.0] * 50,  # lowest low = 90 -> base_depth = (110 - 90)/110 = 18.1% <= 35%
        "volume": [100000] * 50,
    })

    target_d = dates[-1]
    first_d = dates[0]
    earliest_cutoff = date(2026, 1, 10)  # first_d strictly after cutoff

    # close = 108.0 -> dist = (110 - 108)/108 = 1.85% <= 2.0 * atr_pct (0.02 * 2 = 4%)
    base_row = pd.Series({
        "trade_date": target_d,
        "first_candle_date": first_d,
        "close": 108.0,
        "atr_pct": 0.02,
    })

    # 1. Passing case
    res = eval_ipo_base(base_row, hist, earliest_cutoff)
    assert res is not None
    assert res["screener"] == "ipo_base"
    assert res["pivot"] == 110.0
    assert res["overlay"]["stats"]["sessions_since_base_top"] == 29

    # 2. Rule failure: already broken out (close > base_top)
    r_bo = base_row.copy(); r_bo["close"] = 112.0
    assert eval_ipo_base(r_bo, hist, earliest_cutoff) is None

    # 3. Rule failure: dist > 2.0 * atr_pct
    # close = 100.0 -> dist = 10/100 = 10% > 4%
    r_far = base_row.copy(); r_far["close"] = 100.0
    assert eval_ipo_base(r_far, hist, earliest_cutoff) is None

    # 4. Rule failure: base depth > 35% (low = 65 -> depth = 45/110 = 40.9%)
    hist_deep = hist.copy()
    hist_deep.loc[25, "low"] = 65.0
    assert eval_ipo_base(base_row, hist_deep, earliest_cutoff) is None

    # 5. Rule failure: atr_pct missing or <= 0
    r_no_atr = base_row.copy(); r_no_atr["atr_pct"] = np.nan
    assert eval_ipo_base(r_no_atr, hist, earliest_cutoff) is None
    r_zero_atr = base_row.copy(); r_zero_atr["atr_pct"] = 0.0
    assert eval_ipo_base(r_zero_atr, hist, earliest_cutoff) is None
    r_neg_atr = base_row.copy(); r_neg_atr["atr_pct"] = -0.02
    assert eval_ipo_base(r_neg_atr, hist, earliest_cutoff) is None

    # 5. Rule failure: sessions since base top < 5
    hist_recent_top = hist.copy()
    hist_recent_top.loc[48, "high"] = 120.0  # top was yesterday (1 session ago < 5)
    assert eval_ipo_base(base_row, hist_recent_top, earliest_cutoff) is None

    # 6. Rule failure: not real listing (first date <= cutoff)
    assert eval_ipo_base(base_row, hist, earliest_cutoff_date=first_d) is None


def test_eval_ema50_pullback():
    dates = [f"2026-01-{i:02d}" for i in range(1, 65)]
    # 64 sessions:
    # 50 EMA is 100.0, rising (ema_50_10ago = 96.0)
    # low touched <= 1.02 * 100 = 102.0
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
        "low": 101.0,    # <= 102.0
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

    # 3. Rule boundary failure: falling 50 EMA
    r_fall = base_row.copy(); r_fall["ema_50_10ago"] = 101.0
    assert eval_ema50_pullback(r_fall, hist) is None

    # 4. Rule boundary failure: didn't touch support (low = 102.5 > 1.02 * 100)
    r_notouch = base_row.copy(); r_notouch["low"] = 102.5
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
