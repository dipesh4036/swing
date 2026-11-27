"""Tests for RS_STS math, eligibility, corporate-action breaks, IPO handling, and 4-level grouping."""

import numpy as np
import pandas as pd

from pipeline.industry_strength import (
    RS_WINDOW,
    compute_adr_pct,
    compute_industry_strength_snapshot,
    equal_weight_rs_series,
    make_group_id,
    percentrank_inc,
)


def test_percentrank_inc_exact():
    arr = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert percentrank_inc(arr, 1.0) == 0.0
    assert percentrank_inc(arr, 3.0) == 0.5
    assert percentrank_inc(arr, 5.0) == 1.0
    assert abs(percentrank_inc(arr, 2.5) - 0.375) < 1e-9
    # Flat series edge case -> 1.0
    assert percentrank_inc([2.0, 2.0, 2.0], 2.0) == 1.0


def test_equal_weight_rs_series():
    dates = [f"2026-10-{d:02d}" for d in range(1, 6)]
    bench = {d: 100.0 + i for i, d in enumerate(dates)}
    s1 = {d: 50.0 + i * 2.0 for i, d in enumerate(dates)}
    s2 = {d: 200.0 + i * 4.0 for i, d in enumerate(dates)}
    rs, n_used = equal_weight_rs_series([s1, s2], bench, dates)
    assert n_used == 2
    assert rs is not None
    assert rs[0] == 1.0
    assert rs[-1] > 1.0  # outperformed benchmark


def test_adr_pct_skips_zero_range_bars():
    highs = np.array([105.0, 100.0, 106.0] * 5)
    lows = np.array([100.0, 100.0, 100.0] * 5)  # middle bar is flat H==L
    adr = compute_adr_pct(highs, lows, period=10)
    assert adr is not None
    # Mean of 1.05 and 1.06 is 1.055 -> ADR = 5.5%
    assert abs(adr - 5.5) < 1e-6


def test_4_level_snapshot_with_ipo_and_corp_action_break():
    # Build 30 sessions
    dates = pd.date_range("2026-09-01", periods=30, freq="B").strftime("%Y-%m-%d").tolist()
    bench = {d: 20000.0 + i * 20.0 for i, d in enumerate(dates)}

    rows = []
    # Token 1: Normal full-window stock in Banks
    for i, d in enumerate(dates):
        rows.append({"token": 1, "symbol": "HDFCBANK", "trade_date": d, "open": 100+i, "high": 102+i, "low": 99+i, "close": 100.0 + i, "volume": 100000})
    # Token 2: Fresh IPO (only last 10 sessions) in Banks
    for i, d in enumerate(dates[-10:]):
        rows.append({"token": 2, "symbol": "NEWBANKIPO", "trade_date": d, "open": 50+i, "high": 52+i, "low": 49+i, "close": 50.0 + i, "volume": 100000})
    # Token 3: Corporate-action jump (> 40%) inside window in IT
    for i, d in enumerate(dates):
        c = 100.0 + i if i < 20 else (100.0 + i) * 2.0
        rows.append({"token": 3, "symbol": "CORPIT", "trade_date": d, "open": c, "high": c * 1.02, "low": c * 0.98, "close": c, "volume": 100000})

    df = pd.DataFrame(rows)
    cls_map = {
        1: {"symbol": "HDFCBANK", "name": "HDFC Bank", "isin": "INE1", "macro": "Financial Services", "sector": "Financial Services", "industry": "Banks", "basic_industry": "Private Sector Bank"},
        2: {"symbol": "NEWBANKIPO", "name": "New Bank IPO", "isin": "INE2", "macro": "Financial Services", "sector": "Financial Services", "industry": "Banks", "basic_industry": "Private Sector Bank"},
        3: {"symbol": "CORPIT", "name": "Corp IT", "isin": "INE3", "macro": "Information Technology", "sector": "Information Technology", "industry": "IT - Software", "basic_industry": "Computers - Software & Consulting"},
    }

    snap = compute_industry_strength_snapshot(df, cls_map, bench)
    assert snap.trade_date == dates[-1]
    assert snap.classified_stocks == 3
    # 4 levels * 1 path for FinServ + 4 levels * 1 path for IT = 8 groups
    assert len(snap.groups) == 8
    assert len({g["group_id"] for g in snap.groups}) == 8

    by_sym = {r["symbol"]: r for r in snap.stock_metric_rows}
    # IPO is shown immediately as new listing, has null 1M/3M returns & null 50/200 DMA
    assert by_sym["NEWBANKIPO"]["is_new_listing"] is True
    assert by_sym["NEWBANKIPO"]["ret_1m"] is None
    assert by_sym["NEWBANKIPO"]["above_50dma"] is None
    # CorpIT has a >40% break so 1M return across break is None
    assert by_sym["CORPIT"]["ret_1m"] is None

    # In Private Sector Bank, n_stocks=2 (HDFCBANK + NEWBANKIPO), n_eligible=1 (IPO excluded from group EW RS)
    pvb_id = make_group_id("basic_industry", "Financial Services > Financial Services > Banks > Private Sector Bank")
    pvb_all = [r for r in snap.daily_strength_rows if r["group_id"] == pvb_id and r["universe"] == "all"][0]
    assert pvb_all["n_stocks"] == 2
    assert pvb_all["n_eligible"] == 1
    assert pvb_all["rs_sts"] is not None
    # Zero denominator on 200DMA -> None
    assert pvb_all["n_valid_200dma"] == 0
    assert pvb_all["pct_above_200dma"] is None


def test_trend_rank_math_fixture():
    from pipeline.industry_strength import compute_trend_ranks

    rows = [
        {
            "group_id": "g1", "n_stocks": 10, "n_eligible": 10,
            "median_1m": 8.0, "median_3m": 15.0, "median_6m": 25.0,
            "pct_above_50dma": 80.0, "pct_above_200dma": 75.0, "_leader_share": 0.6,
        },
        {
            "group_id": "g2", "n_stocks": 8, "n_eligible": 8,
            "median_1m": 4.0, "median_3m": 10.0, "median_6m": 12.0,
            "pct_above_50dma": 50.0, "pct_above_200dma": 45.0, "_leader_share": 0.3,
        },
        {
            "group_id": "g3_tie", "n_stocks": 12, "n_eligible": 10,
            "median_1m": 4.0, "median_3m": 10.0, "median_6m": 12.0,
            "pct_above_50dma": 50.0, "pct_above_200dma": 45.0, "_leader_share": 0.3,
        },
        {
            "group_id": "g4_small", "n_stocks": 3, "n_eligible": 3,
            "median_1m": 20.0, "median_3m": 40.0, "median_6m": 60.0,
            "pct_above_50dma": 100.0, "pct_above_200dma": 100.0, "_leader_share": 1.0,
        },
    ]
    labels = {"g1": "Strongest", "g2": "Alpha", "g3_tie": "Beta", "g4_small": "Tiny"}
    compute_trend_ranks(rows, labels)

    by_id = {r["group_id"]: r for r in rows}
    assert by_id["g1"]["rank_trend"] == 1
    # Tie on final -> n_stocks desc puts g3_tie (12) ahead of g2 (8)
    assert by_id["g3_tie"]["rank_trend"] == 2
    assert by_id["g2"]["rank_trend"] == 3
    # < 5 eligible rule: small group gets None even with highest returns
    assert by_id["g4_small"]["rank_trend"] is None


def test_20d_closing_high_low_ignores_intraday_wick():
    dates = pd.date_range("2026-10-01", periods=26, freq="B").strftime("%Y-%m-%d").tolist()
    bench = {d: 20000.0 for d in dates}
    rows = []
    # STKA: closes at its highest close of the 20D window even though an earlier day had a higher intraday wick
    for i, d in enumerate(dates):
        c = 100.0 + i
        h = c + 10.0 if i == 15 else c + 1.0
        rows.append({"token": 1, "symbol": "STKA", "trade_date": d, "open": c, "high": h, "low": c - 1.0, "close": c, "volume": 100000})
    # STKB: closes at its lowest close of the 20D window even though an earlier day had a lower intraday wick
    for i, d in enumerate(dates):
        c = 200.0 - i
        l = c - 10.0 if i == 15 else c - 1.0
        rows.append({"token": 2, "symbol": "STKB", "trade_date": d, "open": c, "high": c + 1.0, "low": l, "close": c, "volume": 100000})

    df = pd.DataFrame(rows)
    cls_map = {
        1: {"symbol": "STKA", "name": "A Ltd", "isin": "INE1", "macro": "M", "sector": "S", "industry": "I", "basic_industry": "B"},
        2: {"symbol": "STKB", "name": "B Ltd", "isin": "INE2", "macro": "M", "sector": "S", "industry": "I", "basic_industry": "B"},
    }
    snap = compute_industry_strength_snapshot(df, cls_map, bench)
    by_sym = {r["symbol"]: r for r in snap.stock_metric_rows}
    assert by_sym["STKA"]["at_20d_high"] is True
    assert by_sym["STKA"]["at_20d_low"] is False
    assert by_sym["STKB"]["at_20d_low"] is True
    assert by_sym["STKB"]["at_20d_high"] is False
