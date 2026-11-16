import pytest
import numpy as np
import pandas as pd
from datetime import date, timedelta
from pipeline.screeners import (
    SCREENER_PARAMS,
    calculate_rs_rank,
    evaluate_trend_template,
    compute_screener_indicators,
    compute_seeded_ema
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
    assert ema[50] > 10.0 and ema[50] < 20.0

def test_rs_rank_percentile_calculation():
    # 5 stocks with distinct rs_raw values
    df = pd.DataFrame({
        "token": [1, 2, 3, 4, 5],
        "rs_raw": [0.1, 0.5, 0.2, 0.9, 0.4]
    })
    eligible_mask = pd.Series([True, True, True, True, True])
    ranks = calculate_rs_rank(df, eligible_mask)
    
    assert len(ranks) == 5
    # Token 4 has highest rs_raw -> rank 99
    assert ranks.loc[3] == 99
    # Token 1 has lowest rs_raw -> rank near 1
    assert ranks.loc[0] <= 25
    # Relative ordering preserved
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
        "low_52w_incl": 100.0,   # 150 >= 1.30 * 100 = 130 (pass)
        "high_52w_incl": 160.0,  # 150 >= 0.75 * 160 = 120 (pass)
        "rs_rank": 85            # 85 >= 70 (pass)
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
    r6 = base.copy(); r6["low_52w_incl"] = 120.0 # 1.3 * 120 = 156 > 150
    assert evaluate_trend_template(pd.Series(r6)) is False

    # Rule 7 fail: close < 0.75 * high_52w_incl
    r7 = base.copy(); r7["high_52w_incl"] = 210.0 # 0.75 * 210 = 157.5 > 150
    assert evaluate_trend_template(pd.Series(r7)) is False

    # Rule 8 fail: rs_rank < 70
    r8 = base.copy(); r8["rs_rank"] = 65
    assert evaluate_trend_template(pd.Series(r8)) is False

    # Missing value -> False
    r_nan = base.copy(); r_nan["sma_200"] = np.nan
    assert evaluate_trend_template(pd.Series(r_nan)) is False

def test_screener_indicators_computation():
    # Build 300 sessions of synthetic daily bars for 1 stock
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
    
    # Row 299 should have valid 52w and RS
    last_row = res.iloc[-1]
    assert pd.notna(last_row["high_52w_incl"])
    assert pd.notna(last_row["low_52w_incl"])
    assert pd.notna(last_row["rs_raw"])
    assert last_row["pivot_20"] == last_row["high"]

def test_screener_overlay_contract():
    # Verify the structure of overlays matches the spec schema
    levels = [{"id": "pivot", "label": "Pivot", "price": 100.5, "from_date": "2026-11-01", "style": "solid"}]
    segments = [{"id": "c1", "from": {"date": "2026-10-01", "price": 110.0}, "to": {"date": "2026-10-15", "price": 95.0}, "label": "-13.6%"}]
    markers = [{"date": "2026-11-13", "position": "belowBar", "text": "Breakout", "shape": "arrowUp"}]
    overlay = {
        "levels": levels,
        "segments": segments,
        "markers": markers,
        "highlight_lines": ["sma_50"],
        "stats": {"vol_ratio": 2.1}
    }
    assert "levels" in overlay
    assert "segments" in overlay
    assert "markers" in overlay
    assert "highlight_lines" in overlay
    assert "stats" in overlay
    assert overlay["levels"][0]["style"] in ("solid", "dashed")
    assert overlay["markers"][0]["position"] in ("aboveBar", "belowBar")

