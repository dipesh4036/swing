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
    assert SCREENER_PARAMS["vcp"]["max_range_pct_w3"] == 0.10
    assert SCREENER_PARAMS["candle_stock_cap"] == 300


def test_seeded_ema():
    arr = np.array([10.0] * 50 + [20.0] * 10)
    ema = compute_seeded_ema(arr, 50)
    assert np.isnan(ema[0])
    assert np.isnan(ema[48])
    assert pytest.approx(ema[49], rel=1e-5) == 10.0
    assert 10.0 < ema[50] < 20.0


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

    # Missing value -> False
    r_nan = base.copy(); r_nan["sma_200"] = np.nan
    assert evaluate_trend_template(pd.Series(r_nan)) is False


def test_screener_indicators_computation():
    dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(300)]
    closes = [100.0 + i * 0.5 for i in range(300)]
    df = pd.DataFrame({
        "token": [1] * 300,
        "symbol": ["TEST"] * 300,
        "trade_date": dates,
        "open": closes,
        "high": [c + 2.0 for c in closes],
        "low": [c - 2.0 for c in closes],
        "close": closes,
        "volume": [50000] * 300,
        "sma_200": [c - 10.0 for c in closes]
    })

    res = compute_screener_indicators(df)
    assert "sma_10" in res.columns
    assert "sma_20" in res.columns
    assert "ema_50" in res.columns
    assert "high_52w_incl" in res.columns
    assert "low_52w_incl" in res.columns
    assert "pivot_20" in res.columns
    assert "vol_avg_10" in res.columns
    assert "rs_raw" in res.columns
    assert "first_candle_date" in res.columns


# -----------------------------------------------------------------------------
# Pure Evaluator Tests (Passing & Rule Boundary Failures)
# -----------------------------------------------------------------------------

def test_eval_stage2_breakout():
    # 25 days history
    dates = [f"2026-11-{i:02d}" for i in range(1, 26)]
    hist = pd.DataFrame({
        "trade_date": dates,
        "high": [100.0] * 24 + [105.0],
        "low": [95.0] * 24 + [100.0],
        "close": [98.0] * 24 + [104.0],
    })

    base_row = pd.Series({
        "trade_date": "2026-11-25",
        "tt_pass": True,
        "stage_2": 1,
        "breakout_20d": 1,
        "high_20d": 100.0,
        "close": 104.0,  # <= 1.05 * 100 = 105.0
        "high": 105.0,
        "low": 100.0,    # range_pos = (104 - 100)/(105 - 100) = 0.8 >= 0.6
        "volume": 30000,
        "vol_sma_50": 15000,  # 30000 / 15000 = 2.0 >= 1.5
    })

    # 1. Passing case
    res = eval_stage2_breakout(base_row, hist)
    assert res is not None
    assert res["screener"] == "stage2_breakout"
    assert res["pivot"] == 100.0
    assert res["dist_to_pivot_pct"] == 4.0
    assert res["sort_key"] == 2.0
    # Overlay verification: matches exact rule values
    overlay = res["overlay"]
    assert overlay["levels"][0]["price"] == 100.0
    assert overlay["levels"][1]["price"] == 105.0
    assert overlay["stats"]["vol_ratio"] == 2.0
    assert overlay["stats"]["pct_above_pivot"] == 4.0

    # 2. Rule boundary failure: tt_pass is False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_stage2_breakout(r_tt, hist) is None

    # 3. Rule boundary failure: stage_2 != 1
    r_s2 = base_row.copy(); r_s2["stage_2"] = 0
    assert eval_stage2_breakout(r_s2, hist) is None

    # 4. Rule boundary failure: breakout_20d != 1
    r_brk = base_row.copy(); r_brk["breakout_20d"] = 0
    assert eval_stage2_breakout(r_brk, hist) is None

    # 5. Rule boundary failure: volume ratio < 1.5 (22400 / 15000 = 1.49x)
    r_vol = base_row.copy(); r_vol["volume"] = 22400
    assert eval_stage2_breakout(r_vol, hist) is None

    # 6. Rule boundary failure: close range ratio < 0.60 ((102.9 - 100)/(105 - 100) = 0.58)
    r_range = base_row.copy(); r_range["close"] = 102.9
    assert eval_stage2_breakout(r_range, hist) is None

    # 7. Rule boundary failure: extended > 1.05 * 100 (close = 105.1)
    r_ext = base_row.copy(); r_ext["close"] = 105.1
    assert eval_stage2_breakout(r_ext, hist) is None


def test_eval_vcp():
    dates = [f"2026-{m:02d}-{d:02d}" for m in range(1, 4) for d in range(1, 16)]
    # 45 sessions of data:
    # w1 (t-44..t-30): high=200, low=160 -> range = 0.20
    # w2 (t-29..t-15): high=200, low=172 -> range = 0.14
    # w3 (t-14..t): high=200, low=186 -> range = 0.07 (<= 0.10)
    highs = [200.0] * 45
    lows = [160.0] * 15 + [172.0] * 15 + [186.0] * 15
    hist = pd.DataFrame({"trade_date": dates, "high": highs, "low": lows})

    base_row = pd.Series({
        "trade_date": dates[-1],
        "tt_pass": True,
        "close": 195.0,
        "high_52w_incl": 200.0,  # 195 >= 0.85 * 200 = 170
        "pivot_20": 200.0,
        "sma_50": 180.0,         # close >= sma_50
        "vol_avg_10": 16000,
        "vol_sma_50": 20000,     # 16000 <= 0.85 * 20000 = 17000
    })

    # 1. Passing case
    res = eval_vcp(base_row, hist)
    assert res is not None
    assert res["screener"] == "vcp"
    assert res["pivot"] == 200.0
    assert pytest.approx(res["dist_to_pivot_pct"], rel=1e-2) == 2.5
    # Overlay verification: contracting segments
    overlay = res["overlay"]
    assert overlay["levels"][0]["price"] == 200.0
    assert overlay["stats"]["depth_w1"] == 20.0
    assert overlay["stats"]["depth_w2"] == 14.0
    assert overlay["stats"]["depth_w3"] == 7.0
    assert overlay["segments"][0]["label"] == "-20.0%"

    # 2. Rule boundary failure: close < 0.85 * high_52w (close = 169.0)
    r_52 = base_row.copy(); r_52["close"] = 169.0
    assert eval_vcp(r_52, hist) is None

    # 3. Rule boundary failure: close < sma_50 (close = 179.0, sma_50 = 180.0)
    r_ma = base_row.copy(); r_ma["close"] = 179.0
    assert eval_vcp(r_ma, hist) is None

    # 4. Rule boundary failure: vol dryup fails (17100 > 0.85 * 20000 = 17000)
    r_vol = base_row.copy(); r_vol["vol_avg_10"] = 17100
    assert eval_vcp(r_vol, hist) is None

    # 5. Rule boundary failure: pivot distance > 5% (close = 189.0 -> dist = 5.5%)
    r_piv = base_row.copy(); r_piv["close"] = 189.0
    assert eval_vcp(r_piv, hist) is None

    # 6. Rule boundary failure: w3 range > 10% (w3 low = 178 -> range = 22/200 = 11%)
    hist_fail_w3 = hist.copy()
    hist_fail_w3.loc[30:, "low"] = 178.0
    assert eval_vcp(base_row, hist_fail_w3) is None

    # 7. Rule boundary failure: non-contracting (w2 <= w3)
    hist_fail_noncontract = hist.copy()
    hist_fail_noncontract.loc[15:29, "low"] = 188.0  # w2 range = 12/200 = 0.06 < w3 range (0.07)
    assert eval_vcp(base_row, hist_fail_noncontract) is None

    # 8. Rule boundary failure: history < 45 sessions
    assert eval_vcp(base_row, hist.iloc[:40]) is None


def test_eval_near_pivot():
    hist = pd.DataFrame({
        "trade_date": [f"2026-11-{i:02d}" for i in range(1, 21)],
        "high": [98.0] * 19 + [100.0],
    })

    base_row = pd.Series({
        "tt_pass": True,
        "pivot_20": 100.0,
        "close": 98.0,  # dist = 2% <= 3%
    })

    # 1. Passing case
    res = eval_near_pivot(base_row, hist)
    assert res is not None
    assert res["screener"] == "near_pivot"
    assert res["pivot"] == 100.0
    assert res["dist_to_pivot_pct"] == 2.0
    assert res["overlay"]["levels"][0]["price"] == 100.0
    assert res["overlay"]["stats"]["dist_to_pivot_pct"] == 2.0

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_near_pivot(r_tt, hist) is None

    # 3. Rule boundary failure: dist > 3% (close = 96.9 -> dist = 3.1%)
    r_dist = base_row.copy(); r_dist["close"] = 96.9
    assert eval_near_pivot(r_dist, hist) is None

    # 4. Rule boundary failure: dist < 0 (close = 100.5 > pivot, already broke out)
    r_above = base_row.copy(); r_above["close"] = 100.5
    assert eval_near_pivot(r_above, hist) is None


def test_eval_ipo_base():
    dates = [date(2026, 8, 1) + timedelta(days=i) for i in range(50)]
    hist = pd.DataFrame({
        "trade_date": dates,
        "high": [105.0] * 50,
        "low": [80.0] * 40 + [96.0] * 10,  # base low = 80, last 10 range = (105-96)/105 = 8.5% <= 12%
        "volume": [100000] * 50,
    })

    target_d = dates[-1]
    first_d = dates[0]
    earliest_cutoff = date(2026, 1, 10)  # first_d is strictly after cutoff

    base_row = pd.Series({
        "trade_date": target_d,
        "first_candle_date": first_d,
        "ema_20": 95.0,
        "close": 100.0,  # >= 20, > ema_20, >= 0.90 * 105 = 94.5
    })

    # 1. Passing case
    res = eval_ipo_base(base_row, hist, earliest_cutoff)
    assert res is not None
    assert res["screener"] == "ipo_base"
    assert res["pivot"] == 105.0
    assert res["overlay"]["levels"][0]["price"] == 105.0
    assert res["overlay"]["levels"][1]["price"] == 80.0
    assert pytest.approx(res["overlay"]["stats"]["base_depth_pct"], rel=1e-1) == 23.8

    # 2. Rule boundary failure: listing age > 365 days
    r_old = base_row.copy(); r_old["first_candle_date"] = target_d - timedelta(days=366)
    assert eval_ipo_base(r_old, hist, earliest_cutoff) is None

    # 3. Rule boundary failure: history < 15 sessions
    assert eval_ipo_base(base_row, hist.iloc[:14], earliest_cutoff) is None

    # 4. Rule boundary failure: first_date <= earliest_cutoff (not real IPO)
    assert eval_ipo_base(base_row, hist, earliest_cutoff_date=first_d) is None

    # 5. Rule boundary failure: close < 20.0 (tradability)
    r_penny = base_row.copy(); r_penny["close"] = 19.5
    assert eval_ipo_base(r_penny, hist, earliest_cutoff) is None

    # 6. Rule boundary failure: avg_vol < 25000
    hist_low_vol = hist.copy(); hist_low_vol["volume"] = 24000
    assert eval_ipo_base(base_row, hist_low_vol, earliest_cutoff) is None

    # 7. Rule boundary failure: avg_vol * close < 1e7 (traded value)
    # close = 25, avg_vol = 30000 -> 750,000 < 1e7
    r_low_val = base_row.copy(); r_low_val["close"] = 25.0; r_low_val["ema_20"] = 24.0
    hist_val = hist.copy(); hist_val["volume"] = 30000
    assert eval_ipo_base(r_low_val, hist_val, earliest_cutoff) is None

    # 8. Rule boundary failure: close <= ema_20
    r_ema = base_row.copy(); r_ema["close"] = 94.0; r_ema["ema_20"] = 95.0
    assert eval_ipo_base(r_ema, hist, earliest_cutoff) is None

    # 9. Rule boundary failure: base depth > 35% (base_low = 65 -> depth = 40/105 = 38%)
    hist_deep = hist.copy(); hist_deep.loc[10, "low"] = 65.0
    assert eval_ipo_base(base_row, hist_deep, earliest_cutoff) is None

    # 10. Rule boundary failure: close < 0.90 * listing_high (close = 94.0 < 94.5)
    r_below_h = base_row.copy(); r_below_h["close"] = 94.0; r_below_h["ema_20"] = 90.0
    assert eval_ipo_base(r_below_h, hist, earliest_cutoff) is None

    # 11. Rule boundary failure: last 10 range > 12% (range = 14/105 = 13.3%)
    hist_loose = hist.copy(); hist_loose.loc[45:, "low"] = 91.0
    assert eval_ipo_base(base_row, hist_loose, earliest_cutoff) is None


def test_eval_ema50_pullback():
    dates = [f"2026-11-{i:02d}" for i in range(1, 26)]
    hist = pd.DataFrame({
        "trade_date": dates,
        "close": [100.0] * 15 + [110.0] + [100.5] * 9,  # max close in last 15 is 110.0 (>= 1.08 * 100)
        "low": [98.0] * 15 + [105.0] + [100.8] * 9,    # low 100.8 <= 1.02 * 100 = 102 (touched)
        "ema_50": [100.0] * 25
    })

    base_row = pd.Series({
        "trade_date": "2026-11-25",
        "tt_pass": True,
        "ema_50": 100.0,
        "ema_50_10ago": 96.0,    # rising 50 EMA
        "low": 101.0,            # touched <= 1.02 * 100 = 102
        "close": 100.5,          # held >= 0.99 * 100 = 99
        "volume": 18000,
        "vol_sma_50": 20000,     # quiet volume (<= 20000)
        "rs_rank": 82
    })

    # 1. Passing case
    res = eval_ema50_pullback(base_row, hist)
    assert res is not None
    assert res["screener"] == "ema50_pullback"
    assert res["pivot"] == 100.0
    assert res["overlay"]["levels"][0]["price"] == 110.0  # swing high
    assert pytest.approx(res["overlay"]["stats"]["pct_above_ema50"], rel=1e-2) == 0.5

    # 2. Rule boundary failure: tt_pass False
    r_tt = base_row.copy(); r_tt["tt_pass"] = False
    assert eval_ema50_pullback(r_tt, hist) is None

    # 3. Rule boundary failure: falling 50 EMA (ema_50 <= ema_50_10ago)
    r_fall = base_row.copy(); r_fall["ema_50_10ago"] = 101.0
    assert eval_ema50_pullback(r_fall, hist) is None

    # 4. Rule boundary failure: low didn't touch 50 EMA (low = 102.5 > 1.02 * 100)
    r_notouch = base_row.copy(); r_notouch["low"] = 102.5
    assert eval_ema50_pullback(r_notouch, hist) is None

    # 5. Rule boundary failure: close didn't hold 50 EMA (close = 98.5 < 0.99 * 100)
    r_nohold = base_row.copy(); r_nohold["close"] = 98.5
    assert eval_ema50_pullback(r_nohold, hist) is None

    # 6. Rule boundary failure: insufficient prior extension (max close = 107.0 < 1.08 * 100 = 108.0)
    hist_no_ext = hist.copy(); hist_no_ext.loc[15, "close"] = 107.0
    assert eval_ema50_pullback(base_row, hist_no_ext) is None

    # 7. Rule boundary failure: volume > vol_sma_50 (20500 > 20000)
    r_heavy = base_row.copy(); r_heavy["volume"] = 20500
    assert eval_ema50_pullback(r_heavy, hist) is None


# -----------------------------------------------------------------------------
# run_screeners Full Execution with Fake Connection
# -----------------------------------------------------------------------------

def test_run_screeners_with_fake_connection():
    # Build a synthetic 260-session history for 2 tokens
    dates = [date(2026, 1, 1) + timedelta(days=i) for i in range(260)]
    closes_1 = [100.0 + i * 0.5 for i in range(260)]
    closes_2 = [50.0 + i * 0.2 for i in range(260)]

    df1 = pd.DataFrame({
        "token": [1] * 260,
        "symbol": ["AAA"] * 260,
        "trade_date": dates,
        "open": closes_1,
        "high": [c + 2.0 for c in closes_1],
        "low": [c - 2.0 for c in closes_1],
        "close": closes_1,
        "volume": [60000] * 260,
        "vol_sma_50": [50000] * 260,
        "ret_1d": [0.01] * 260,
        "stage_1": [0] * 260,
        "stage_2": [1] * 260,
        "stage_3": [0] * 260,
        "stage_4": [0] * 260,
        "stage_unclass": [0] * 260,
        "breakout_20d": [0] * 259 + [1],
        "high_20d": [c + 1.0 for c in closes_1],
        "sma_50": [c - 5.0 for c in closes_1],
        "sma_150": [c - 15.0 for c in closes_1],
        "sma_200": [c - 20.0 for c in closes_1],
        "ema_20": [c - 2.0 for c in closes_1],
    })

    df2 = pd.DataFrame({
        "token": [2] * 260,
        "symbol": ["BBB"] * 260,
        "trade_date": dates,
        "open": closes_2,
        "high": [c + 1.0 for c in closes_2],
        "low": [c - 1.0 for c in closes_2],
        "close": closes_2,
        "volume": [40000] * 260,
        "vol_sma_50": [35000] * 260,
        "ret_1d": [0.005] * 260,
        "stage_1": [0] * 260,
        "stage_2": [1] * 260,
        "stage_3": [0] * 260,
        "stage_4": [0] * 260,
        "stage_unclass": [0] * 260,
        "breakout_20d": [0] * 260,
        "high_20d": [c + 2.0 for c in closes_2],
        "sma_50": [c - 3.0 for c in closes_2],
        "sma_150": [c - 8.0 for c in closes_2],
        "sma_200": [c - 12.0 for c in closes_2],
        "ema_20": [c - 1.0 for c in closes_2],
    })

    df_combined = pd.concat([df1, df2], ignore_index=True)

    # Mock DB connection
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.mogrify.side_effect = lambda sql, args: b"SQL"
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    # Constituents returns AAA in nifty500
    mock_cur.fetchall.return_value = [("AAA",)]

    target_date = dates[-1]

    # First run
    res = run_screeners(df_combined, target_date=target_date, conn=mock_conn)
    assert res["status"] == "success"
    assert res["trade_date"] == str(target_date)
    assert "counts" in res
    assert mock_conn.commit.called

    # Verify SQL calls made for retention to 10 dates and candle cap
    executed_sql = [
        call[0][0].decode("utf-8") if isinstance(call[0][0], bytes) else str(call[0][0])
        for call in mock_cur.execute.call_args_list
    ]
    retention_calls = [s for s in executed_sql if "DELETE FROM daily_screener_results" in s and "LIMIT" in s]
    assert len(retention_calls) > 0

    candle_window_calls = [s for s in executed_sql if "DELETE FROM screener_candles" in s and "rn <=" in s]
    assert len(candle_window_calls) > 0

    # Idempotent re-run on the same date succeeds
    mock_conn.reset_mock()
    mock_cur.reset_mock()
    mock_cur.mogrify.side_effect = lambda sql, args: b"SQL"
    mock_cur.fetchall.return_value = [("AAA",)]
    res2 = run_screeners(df_combined, target_date=target_date, conn=mock_conn)
    assert res2["status"] == "success"
    assert res2["trade_date"] == str(target_date)
    assert mock_conn.commit.called


def test_migrations_applied_by_init_db():
    from pipeline.db import run_migrations

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    # Simulate empty schema_migrations so all migrations run
    mock_cur.fetchall.return_value = []

    run_migrations(conn=mock_conn)

    # Check that schema_migrations inserts included versions 5 and 6
    inserted_versions = []
    for call in mock_cur.execute.call_args_list:
        args = call[0]
        if len(args) > 1 and isinstance(args[1], tuple) and len(args[1]) == 2:
            if "INSERT INTO schema_migrations" in args[0]:
                inserted_versions.append(args[1][0])

    assert 5 in inserted_versions
    assert 6 in inserted_versions
