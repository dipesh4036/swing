import pytest
import numpy as np
import pandas as pd
from pipeline.compute import (
    compute_stock_indicators,
    compute_breadth_for_universe,
)

def test_r5_market_session_gap_no_fake_move():
    """
    R5: A stock absent for multiple market sessions (gap) and reappearing at +30%
    must NOT get a fake 1-day move, advance, or 4% mover.
    prev_close must be NaN, ret_1d must be NaN, advance=0, decline=0, mover_up_4pct=0, unchanged=1.
    Contiguous sessions must compute normal returns.
    """
    # 12 market dates
    dates = [f"2026-01-{i:02d}" for i in range(1, 13)]

    # Stock 1 has sessions on date 1, then absent for 10 sessions, reappears on date 12 at 130 (vs 100)
    # Stock 2 is present on all dates (contiguous)
    rows = []
    # Stock 1 (gap)
    rows.append({"token": "1001", "symbol": "GAPSTOCK", "trade_date": dates[0], "open": 100, "high": 105, "low": 99, "close": 100, "volume": 50000})
    rows.append({"token": "1001", "symbol": "GAPSTOCK", "trade_date": dates[11], "open": 130, "high": 135, "low": 128, "close": 130, "volume": 50000})

    # Stock 2 (contiguous)
    for i, d in enumerate(dates):
        c = 100 + i * 2
        rows.append({"token": "1002", "symbol": "NORMSTOCK", "trade_date": d, "open": c, "high": c + 2, "low": c - 2, "close": c, "volume": 50000})

    df = pd.DataFrame(rows)
    df_ind = compute_stock_indicators(df)

    gap_row_reappear = df_ind[(df_ind["token"] == "1001") & (df_ind["trade_date"] == dates[11])].iloc[0]
    assert pd.isna(gap_row_reappear["prev_close"]), "Reappearing row after gap must have NaN prev_close"
    assert pd.isna(gap_row_reappear["ret_1d"]), "Reappearing row after gap must have NaN ret_1d"
    assert gap_row_reappear["advance"] == 0, "Reappearing row after gap must have advance=0"
    assert gap_row_reappear["decline"] == 0, "Reappearing row after gap must have decline=0"
    assert gap_row_reappear["mover_up_4pct"] == 0, "Reappearing row after gap must have mover_up_4pct=0"
    assert gap_row_reappear["unchanged"] == 1, "Reappearing row after gap must be counted as unchanged"

    # Contiguous stock on date 11 (second to last) vs 12 (last)
    norm_last = df_ind[(df_ind["token"] == "1002") & (df_ind["trade_date"] == dates[11])].iloc[0]
    norm_prev = df_ind[(df_ind["token"] == "1002") & (df_ind["trade_date"] == dates[10])].iloc[0]
    assert norm_last["prev_close"] == norm_prev["close"]
    assert norm_last["advance"] == 1
    assert norm_last["decline"] == 0

def test_r6_52w_null_when_invalid_and_publish_floor():
    """
    R6: Rows without a valid 252-session window must have NULL/None for highs_52w, lows_52w, net_52w
    (never fabricated 0).
    A 300-session store's row at session index 252 (the 253rd session) has valid 52w metrics.
    """
    # 50 sessions (insufficient for 252-day window)
    dates_short = [f"2025-01-{i:02d}" for i in range(1, 30)]
    rows_short = []
    for d in dates_short:
        rows_short.append({"token": "1001", "symbol": "STK1", "trade_date": d, "open": 100, "high": 110, "low": 90, "close": 100, "volume": 50000})

    df_short = pd.DataFrame(rows_short)
    df_ind_short = compute_stock_indicators(df_short)
    records = compute_breadth_for_universe(df_ind_short, "all")

    # In short history, 52w values must be None (not 0)
    for r in records:
        assert r["highs_52w"] is None, f"Expected None highs_52w on {r['trade_date']}, got {r['highs_52w']}"
        assert r["lows_52w"] is None, f"Expected None lows_52w on {r['trade_date']}, got {r['lows_52w']}"
        assert r["net_52w"] is None, f"Expected None net_52w on {r['trade_date']}, got {r['net_52w']}"

    # 300 sessions: index 252 has valid 52w metrics
    all_dates = [f"D{i:04d}" for i in range(300)]
    rows_300 = []
    for i, d in enumerate(all_dates):
        # stock price oscillates
        c = 100 + (i % 20)
        rows_300.append({"token": "1001", "symbol": "STK1", "trade_date": d, "open": c, "high": c + 5, "low": c - 5, "close": c, "volume": 50000})

    df_300 = pd.DataFrame(rows_300)
    df_ind_300 = compute_stock_indicators(df_300)
    records_300 = compute_breadth_for_universe(df_ind_300, "all")
    rec_by_date = {r["trade_date"]: r for r in records_300}

    # Index 251: has 251 prior sessions (not yet 252), so valid_52w=0 -> None
    r251 = rec_by_date[all_dates[251]]
    assert r251["highs_52w"] is None
    assert r251["lows_52w"] is None
    assert r251["net_52w"] is None

    # Index 252: has 252 prior sessions -> valid_52w > 0 -> integers (not None)
    r252 = rec_by_date[all_dates[252]]
    assert r252["highs_52w"] is not None
    assert r252["lows_52w"] is not None
    assert r252["net_52w"] is not None

def test_r7_liquid_universe_strict_definition():
    """
    R7: Liquid universe requires close >= 20 and prior 50-day average volume >= 25000.
    Single-day volume spikes must NOT admit a low-average stock.
    Stocks with NaN vol_sma_50 (< 50 sessions) must NOT be admitted.
    """
    # 60 dates
    dates = [f"D{i:03d}" for i in range(60)]
    rows = []
    for i, d in enumerate(dates):
        # Stock 1: close=50, average vol = 5,000, but on last day volume spikes to 100,000
        vol1 = 100000 if i == 59 else 5000
        rows.append({"token": "1001", "symbol": "SPIKE", "trade_date": d, "open": 50, "high": 52, "low": 49, "close": 50, "volume": vol1})

        # Stock 2: close=50, average vol = 30,000
        rows.append({"token": "1002", "symbol": "GENUINE_LIQUID", "trade_date": d, "open": 50, "high": 52, "low": 49, "close": 50, "volume": 30000})

        # Stock 3: only listed for last 10 days, vol = 100,000 (vol_sma_50 is NaN)
        if i >= 50:
            rows.append({"token": "1003", "symbol": "NEW_LISTING", "trade_date": d, "open": 50, "high": 52, "low": 49, "close": 50, "volume": 100000})

    df = pd.DataFrame(rows)
    df_ind = compute_stock_indicators(df)
    records = compute_breadth_for_universe(df_ind, "liquid")
    rec_by_date = {r["trade_date"]: r for r in records}

    last_rec = rec_by_date[dates[59]]
    # Only GENUINE_LIQUID should be in liquid universe on day 59!
    # SPIKE has vol_sma_50 = 5000 < 25000 -> excluded despite 100,000 volume today
    # NEW_LISTING has NaN vol_sma_50 -> excluded
    assert last_rec["total_stocks"] == 1

def test_r8_zweig_breadth_thrust_rolling_min():
    """
    R8: Zweig Breadth Thrust triggers when 10-day EMA of advances/(advances+declines)
    rises above 0.615 AND rolling 10-session min was below 0.40.
    - EMA dipping to 0.35 6 sessions ago and 0.62 today -> True.
    - EMA staying above 0.40 across entire 10-session window -> False.
    """
    # 25 dates
    dates = [f"D{i:02d}" for i in range(25)]

    # Case A: Dip to < 0.40 six sessions ago, then surge to > 0.615 today
    rows_a = []
    # 100 fixed tokens
    tokens = [f"STK_{s}" for s in range(100)]
    prices_a = {t: 100.0 for t in tokens}

    for i, d in enumerate(dates):
        adv_count = 20 if i < 18 else 95
        for s, t in enumerate(tokens):
            if s < adv_count:
                prices_a[t] += 2.0  # Advance
            else:
                prices_a[t] -= 2.0  # Decline
            c = prices_a[t]
            rows_a.append({"token": t, "symbol": t, "trade_date": d, "open": c, "high": c + 1, "low": c - 1, "close": c, "volume": 30000})

    df_a = pd.DataFrame(rows_a)
    df_ind_a = compute_stock_indicators(df_a)
    rec_a = compute_breadth_for_universe(df_ind_a, "all")
    # Today's breadth thrust should be True
    assert rec_a[-1]["breadth_thrust"] is True, "Expected Zweig Thrust to be True after dip and surge"

    # Case B: EMA never dipped below 0.40 (steady 55/45, then surge)
    rows_b = []
    prices_b = {t: 100.0 for t in tokens}
    for i, d in enumerate(dates):
        adv_count = 55 if i < 18 else 95
        for s, t in enumerate(tokens):
            if s < adv_count:
                prices_b[t] += 2.0
            else:
                prices_b[t] -= 2.0
            c = prices_b[t]
            rows_b.append({"token": t, "symbol": t, "trade_date": d, "open": c, "high": c + 1, "low": c - 1, "close": c, "volume": 30000})

    df_b = pd.DataFrame(rows_b)
    df_ind_b = compute_stock_indicators(df_b)
    rec_b = compute_breadth_for_universe(df_ind_b, "all")
    # Today's breadth thrust should be False because it was never < 0.40
    assert rec_b[-1]["breadth_thrust"] is False, "Expected Zweig Thrust to be False when rolling min >= 0.40"
