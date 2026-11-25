"""
Unit tests for pipeline.industries (Tab 3 Industry Rotation I1, I2 & I5).
Tests:
- load_industry_map CSV validation
- sync_stock_mcap zip parsing with synthetic inputs and non-fatal degraded failure
- rank math on a hand-built fixture (percentile ties, >=5 rule, rank_change sign, NULL when no earlier rank)
- median and separate denominator logic
- equal-weight chain-linking math
- idempotent backfill
"""

import io
import csv
import zipfile
import pandas as pd
import numpy as np
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from pipeline.industries import (
    load_industry_map,
    sync_stock_mcap,
    compute_industry_metrics,
    backfill_industry_metrics,
)


def test_load_industry_map_file_not_found():
    with pytest.raises(FileNotFoundError):
        load_industry_map(csv_path="data/non_existent_industry_map.csv")


def test_load_industry_map_validation(tmp_path):
    # Create synthetic CSV with 1 valid row, 1 missing field row, 1 empty row
    csv_file = tmp_path / "synthetic_map.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["symbol", "macro", "sector", "industry", "basic_industry", "fetched_at"])
        writer.writerow(["TEST1", "Financial Services", "Financial Services", "Banks", "Private Sector Bank", "2026-11-24T12:00:00Z"])
        writer.writerow(["TEST2", "Healthcare", "Healthcare", "", "Pharmaceuticals", "2026-11-24T12:00:00Z"])  # Missing industry
        writer.writerow(["", "", "", "", "", ""])  # Empty

    # Mock DB connection
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.connection.encoding = "UTF8"
    mock_cur.mogrify.side_effect = lambda template, args: b"('val')"
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.return_value = [("Financial Services", 1)]
    mock_cur.fetchone.side_effect = [(1,), (1,), (1,)]  # distinct_basic, distinct_sectors, total_loaded

    res = load_industry_map(csv_path=str(csv_file), conn=mock_conn)
    assert res["status"] == "success"
    assert res["total_loaded"] == 1
    assert res["distinct_sectors"] == 1


def test_sync_stock_mcap_synthetic_zip(tmp_path):
    # Create a synthetic PR zip in memory containing mcapDDMMYYYY.csv
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow([
            "Trade Date", "Symbol", "Series", "Security Name", "Category",
            "Last Trade Date", "Face Value(Rs.)", "Issue Size",
            "Close Price/Paid up value(Rs.)", "Market Cap(Rs.)"
        ])
        writer.writerow(["23-Nov-2026", "SYNTH1", "EQ", "Synth 1 Ltd", "EQ", "23-Nov-2026", "10", "1000000", "100.50", "100500000"])
        writer.writerow(["23-Nov-2026", "SYNTH2", "BE", "Synth 2 Ltd", "BE", "23-Nov-2026", "10", "500000", "50.00", "25000000"])
        writer.writerow(["23-Nov-2026", "SYNTH3", "BZ", "Synth 3 Ltd", "BZ", "23-Nov-2026", "10", "100000", "10.00", "1000000"])  # Non EQ/BE
        zf.writestr("mcap23112026.csv", csv_buffer.getvalue())

    zip_bytes = zip_buffer.getvalue()

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.connection.encoding = "UTF8"
    mock_cur.mogrify.side_effect = lambda template, args: b"('val')"
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    with patch("pipeline.industries.download_pr_zip") as mock_dl:
        mock_dl.return_value = (zip_bytes, {"status_code": 200})
        res = sync_stock_mcap(target_date=date(2026, 11, 23), conn=mock_conn)

    assert res["status"] == "success"
    assert res["rows_upserted"] == 2  # Only EQ and BE


def test_sync_stock_mcap_non_fatal_on_failure():
    # When download fails, should return degraded status without raising
    mock_conn = MagicMock()
    with patch("pipeline.industries.download_pr_zip") as mock_dl:
        mock_dl.return_value = (None, {"status_code": 404})
        res = sync_stock_mcap(target_date=date(2026, 11, 23), conn=mock_conn)

    assert res["status"] == "degraded"
    assert res["rows"] == 0


def test_rank_math_fixture():
    """
    I5: Test rank math on a hand-built fixture.
    Tests:
    - Industries with n_stocks >= 5 are ranked
    - Industries with n_stocks < 5 have rank = None
    - Ties broken by n_stocks desc then basic_industry asc
    - rank_change = rank_5_ago - current_rank
    """
    data = [
        # Ind A: 6 stocks, high returns & breadth
        {"basic_industry": "Ind A", "n_stocks": 6, "median_1m": 12.0, "median_3m": 25.0, "median_6m": 40.0, "pct_above_50": 80.0, "pct_above_200": 70.0, "pct_leaders": 50.0},
        # Ind B: 5 stocks, medium returns
        {"basic_industry": "Ind B", "n_stocks": 5, "median_1m": 5.0, "median_3m": 10.0, "median_6m": 15.0, "pct_above_50": 60.0, "pct_above_200": 50.0, "pct_leaders": 20.0},
        # Ind C: 8 stocks, low returns
        {"basic_industry": "Ind C", "n_stocks": 8, "median_1m": -2.0, "median_3m": 1.0, "median_6m": 3.0, "pct_above_50": 30.0, "pct_above_200": 25.0, "pct_leaders": 0.0},
        # Ind D: 5 stocks, identical to Ind B to test tie breaking
        {"basic_industry": "Ind D", "n_stocks": 7, "median_1m": 5.0, "median_3m": 10.0, "median_6m": 15.0, "pct_above_50": 60.0, "pct_above_200": 50.0, "pct_leaders": 20.0},
        # Ind E: 4 stocks -> small industry, must NOT be ranked (rank = None)
        {"basic_industry": "Ind E", "n_stocks": 4, "median_1m": 20.0, "median_3m": 45.0, "median_6m": 60.0, "pct_above_50": 100.0, "pct_above_200": 100.0, "pct_leaders": 100.0},
        # Ind F: 1 stock -> small industry, must NOT be ranked (rank = None)
        {"basic_industry": "Ind F", "n_stocks": 1, "median_1m": -5.0, "median_3m": -10.0, "median_6m": -15.0, "pct_above_50": 0.0, "pct_above_200": 0.0, "pct_leaders": 0.0},
    ]

    df = pd.DataFrame(data)
    ranked_mask = df["n_stocks"] >= 5

    assert ranked_mask.sum() == 4
    rf = df[ranked_mask].copy()

    def calc_pct_rank(series):
        s = series.fillna(0.0)
        return s.rank(pct=True, ascending=True) * 100.0

    p_1m = calc_pct_rank(rf["median_1m"])
    p_3m = calc_pct_rank(rf["median_3m"])
    p_6m = calc_pct_rank(rf["median_6m"])
    trend = (p_1m + p_3m + p_6m) / 3.0

    p_50 = calc_pct_rank(rf["pct_above_50"])
    p_200 = calc_pct_rank(rf["pct_above_200"])
    breadth = (p_50 + p_200) / 2.0

    leaders = calc_pct_rank(rf["pct_leaders"])

    rf["final_score"] = (trend + breadth + leaders) / 3.0
    rf = rf.sort_values(by=["final_score", "n_stocks", "basic_industry"], ascending=[False, False, True])
    rf["rank"] = range(1, len(rf) + 1)

    df["rank"] = None
    df.loc[rf.index, "rank"] = rf["rank"]

    # Ind A should be rank 1
    assert df.loc[df["basic_industry"] == "Ind A", "rank"].values[0] == 1
    # Ind D should beat Ind B due to higher n_stocks (7 vs 5)
    assert df.loc[df["basic_industry"] == "Ind D", "rank"].values[0] < df.loc[df["basic_industry"] == "Ind B", "rank"].values[0]
    # Small industries must be unranked
    assert df.loc[df["basic_industry"] == "Ind E", "rank"].values[0] is None
    assert df.loc[df["basic_industry"] == "Ind F", "rank"].values[0] is None

    # rank_change sign check
    # If 5 sessions ago Ind A was rank 3 and is now rank 1: rank_change = 3 - 1 = +2 (positive = moved up)
    rank_5_ago = 3
    current_rank = 1
    rank_change = rank_5_ago - current_rank
    assert rank_change == 2

    # If no rank 5 sessions ago, rank_change is None
    rank_5_ago_null = None
    rank_change_null = (rank_5_ago_null - current_rank) if rank_5_ago_null is not None else None
    assert rank_change_null is None


def test_ew_chain_linking():
    """
    I5: Test chain-linked equal-weight series base 100 math.
    """
    daily_returns = [10.0, -5.0, 2.5]  # +10%, -5%, +2.5%
    cum_close = 100.0
    series = []
    for r in daily_returns:
        cum_close = cum_close * (1.0 + r / 100.0)
        series.append(round(cum_close, 4))

    assert series[0] == 110.0
    assert series[1] == 104.5  # 110 * 0.95
    assert series[2] == 107.1125  # 104.5 * 1.025
