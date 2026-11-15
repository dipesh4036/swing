import os
import json
import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

from pipeline.compute import (
    compute_seeded_ema20,
    compute_weinstein_stages,
    compute_stock_indicators,
    compute_breadth_for_universe
)

# ==========================================
# 1. EMA20 seeded with first-20 SMA (Spec 4.0)
# ==========================================
def test_ema20_seeded_with_first_20_sma():
    """Verify EMA20 has NaN for first 19 sessions, seeds with first 20 SMA at session 20, and iterates with alpha 2/21."""
    closes = np.full(30, 100.0)
    # Give session 20 (index 20) a jump to 121.0
    closes[20] = 121.0

    ema = compute_seeded_ema20(closes)
    # First 19 sessions (index 0..18) must be NaN
    assert np.isnan(ema[:19]).all()
    # 20th session (index 19) must be exactly SMA of first 20 closes (100.0)
    assert ema[19] == 100.0
    # 21st session (index 20): close * (2/21) + prev_EMA * (19/21) = 121 * (2/21) + 100 * (19/21) = 102.0
    expected_20 = 121.0 * (2.0 / 21.0) + 100.0 * (19.0 / 21.0)
    assert abs(ema[20] - expected_20) < 1e-9

# ==========================================
# 2. Strict min_periods on Rolling Windows
# ==========================================
def test_strict_min_periods_no_relaxed_windows():
    """Verify moving averages and high/low windows require the full window (no relaxed min_periods)."""
    # 45 sessions for a stock: SMA50, SMA150, SMA200 must all be NaN
    dates = pd.bdate_range(start="2024-01-01", periods=45)
    records = []
    for d in dates:
        records.append({
            "token": 1,
            "isin": "INE001",
            "symbol": "NEW_IPO",
            "series": "EQ",
            "trade_date": d.strftime("%Y-%m-%d"),
            "open": 100.0, "high": 105.0, "low": 98.0, "close": 102.0,
            "volume": 50000, "turnover_cr_est": 0.51, "adj_factor": 1.0,
        })
    df = pd.DataFrame(records)
    df_ind = compute_stock_indicators(df)

    # All SMA50, SMA150, SMA200 values must be NaN
    assert df_ind["sma_50"].isna().all()
    assert df_ind["sma_150"].isna().all()
    assert df_ind["sma_200"].isna().all()
    assert (df_ind["has_valid_50sma"] == 0).all()
    assert (df_ind["has_valid_200sma"] == 0).all()

# ==========================================
# 3. 4% Movers and Breakouts Filter (close >= 20, 50d vol >= 25,000)
# ==========================================
def test_4pct_movers_and_breakouts_filters():
    """Verify 4% movers and breakouts require close >= 20 and 50-day average volume >= 25,000."""
    dates = pd.bdate_range(start="2024-01-01", periods=60)
    records = []
    for d in dates:
        d_str = d.strftime("%Y-%m-%d")
        # Stock 1: close=50, vol=30000 -> eligible
        records.append({"token": 1, "isin": "INE1", "symbol": "ELIGIBLE", "series": "EQ", "trade_date": d_str, "open": 50, "high": 55, "low": 48, "close": 50, "volume": 30000, "turnover_cr_est": 0.15, "adj_factor": 1.0})
        # Stock 2: close=10 (< 20) -> ineligible
        records.append({"token": 2, "isin": "INE2", "symbol": "PENNY", "series": "EQ", "trade_date": d_str, "open": 10, "high": 11, "low": 9, "close": 10, "volume": 50000, "turnover_cr_est": 0.05, "adj_factor": 1.0})
        # Stock 3: vol=5000 (< 25000) -> ineligible
        records.append({"token": 3, "isin": "INE3", "symbol": "ILLIQUID", "series": "EQ", "trade_date": d_str, "open": 50, "high": 55, "low": 48, "close": 50, "volume": 5000, "turnover_cr_est": 0.025, "adj_factor": 1.0})

    # On the last day, give each stock a +6% jump
    for r in records:
        if r["trade_date"] == dates[-1].strftime("%Y-%m-%d"):
            r["close"] = r["close"] * 1.06
            r["high"] = r["close"] * 1.01

    df_ind = compute_stock_indicators(pd.DataFrame(records))
    last_day = df_ind[df_ind["trade_date"] == dates[-1].strftime("%Y-%m-%d")].set_index("symbol")

    # Only Stock 1 should be eligible and counted as mover_up_4pct
    assert last_day.loc["ELIGIBLE", "mover_up_4pct"] == 1
    assert last_day.loc["PENNY", "mover_up_4pct"] == 0
    assert last_day.loc["ILLIQUID", "mover_up_4pct"] == 0

# ==========================================
# 4. Weinstein Stages per Spec 4.6
# ==========================================
def test_weinstein_stages_spec_4_6():
    """Verify Weinstein stages slope threshold 1%, 120-session memory, >=170 history, and exhaustive classification."""
    n = 200
    closes = np.full(n, 100.0)
    sma150 = np.full(n, 100.0)
    slope = np.zeros(n)

    # Test 1: Sessions < 170 must be unclassified
    st = compute_weinstein_stages(closes, sma150, slope)
    assert st["stage_unclass"][:169].all() == 1
    assert st["stage_1"][:169].sum() == 0

    # Test 2: Slope >= +1.0
    # Session 170: slope = +1.5, close = 105 > sma150 (100) -> Stage 2
    slope[170] = 1.5
    closes[170] = 105.0
    # Session 171: slope = +1.5, close = 95 < sma150 (100) -> Stage 3
    slope[171] = 1.5
    closes[171] = 95.0

    # Test 3: Slope <= -1.0
    # Session 172: slope = -1.5, close = 90 < sma150 (100) -> Stage 4
    slope[172] = -1.5
    closes[172] = 90.0
    # Session 173: slope = -1.5, close = 105 > sma150 (100) -> Stage 1
    slope[173] = -1.5
    closes[173] = 105.0

    # Test 4: Flat slope |slope| < 1.0 with memory
    # Prior trend in session 170 was Stage 2.
    # At session 174: slope = 0.2 (flat). Most recent trend was 4 (from 172) -> Stage 1
    slope[174] = 0.2
    closes[174] = 100.0

    st_res = compute_weinstein_stages(closes, sma150, slope)
    assert st_res["stage_2"][170] == 1, "slope >= +1.0 & close > sma150 must be Stage 2"
    assert st_res["stage_3"][171] == 1, "slope >= +1.0 & close < sma150 must be Stage 3"
    assert st_res["stage_4"][172] == 1, "slope <= -1.0 & close < sma150 must be Stage 4"
    assert st_res["stage_1"][173] == 1, "slope <= -1.0 & close > sma150 must be Stage 1"
    assert st_res["stage_1"][174] == 1, "Flat slope with prior trend 4 must be Stage 1"

    # Verify every classified session sums to 1
    for i in range(169, 175):
        assert st_res["stage_1"][i] + st_res["stage_2"][i] + st_res["stage_3"][i] + st_res["stage_4"][i] == 1

# ==========================================
# 5. Regime Rules & 6 Market Read Indicators (Spec 4.8)
# ==========================================
def test_regime_and_market_read_indicators_spec_4_8():
    """Verify Spec 4.8: Confirmed uptrend conditions, 6 market read indicators status rules, and ad_line=None."""
    # Build 260 sessions for 5 stocks
    dates = pd.bdate_range(start="2023-01-01", periods=260)
    records = []
    for tok in range(1, 6):
        for d in dates:
            records.append({
                "token": tok,
                "isin": f"INE{tok}",
                "symbol": f"SYM{tok}",
                "series": "EQ",
                "trade_date": d.strftime("%Y-%m-%d"),
                "open": 100.0, "high": 105.0, "low": 98.0, "close": 102.0,
                "volume": 50000, "turnover_cr_est": 0.51, "adj_factor": 1.0,
            })
    df_ind = compute_stock_indicators(pd.DataFrame(records))

    # Mock Nifty 500 DataFrame with bullish conditions
    nifty_records = []
    for d in dates:
        nifty_records.append({
            "trade_date": d.strftime("%Y-%m-%d"),
            "close": 24000.0,
            "sma_50": 23500.0,
            "sma_200": 22000.0,
            "ema_20": 23800.0,
            "change_pct": 0.2,
            "had_20d_low_last_10": False,
            "up_last_3": True,
        })
    nifty500_df = pd.DataFrame(nifty_records).set_index("trade_date")

    breadth = compute_breadth_for_universe(
        df_ind=df_ind,
        universe="all",
        nifty500_df=nifty500_df
    )

    last_record = breadth[-1]
    # Verify ad_line is None (Spec 4.2 / 8)
    assert last_record["ad_line"] is None
    # Verify regime_score is deleted (None)
    assert last_record["regime_score"] is None
    # Verify read_indicators is a valid JSON string containing exactly the 6 spec indicators
    assert last_record["read_indicators"] is not None
    indicators = json.loads(last_record["read_indicators"])
    assert len(indicators) == 6
    indicator_ids = {ind["id"] for ind in indicators}
    assert indicator_ids == {"long_term", "medium_term", "short_term", "ad_momentum", "highs_vs_lows", "participation"}

    # N >= SMA200 (24000 >= 22000) -> Positive
    lt = next(ind for ind in indicators if ind["id"] == "long_term")
    assert lt["status"] == "Positive"

