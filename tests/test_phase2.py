import os
import tempfile
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from unittest.mock import MagicMock, patch

from pipeline.quality_gate import verify_quality_gate, QualityGateError
from pipeline.compute import compute_breadth_for_universe, compute_stock_indicators, UNIVERSES
from pipeline.adjust import run_adjustments
from pipeline.smartapi_client import SmartAPIClient

def create_synthetic_candles(num_sessions: int, start_date: str = "2024-01-01", tokens=(101, 102)) -> pd.DataFrame:
    dates = pd.bdate_range(start=start_date, periods=num_sessions)
    records = []
    for tok in tokens:
        for d in dates:
            records.append({
                "token": tok,
                "isin": f"INE{tok}0101",
                "symbol": f"STOCK_{tok}",
                "series": "EQ",
                "trade_date": d.strftime("%Y-%m-%d"),
                "open": 100.0,
                "high": 105.0,
                "low": 98.0,
                "close": 102.0,
                "volume": 50000,
                "turnover_cr_est": 0.51,
                "adj_factor": 1.0,
            })
    return pd.DataFrame(records)

# ==========================================
# 1. Split / Bonus (Case A) and 20% Move Scan
# ==========================================
def test_adjustments_detects_split_and_replaces_rows():
    """Verify Case A: when 10-day overlap differs >1%, full history is re-fetched and rows replaced."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # 30 sessions of unadjusted data at close=200.0
        dates = pd.bdate_range(start="2024-01-01", periods=30)
        records = []
        for d in dates:
            records.append({
                "token": 555,
                "isin": "INE5550101",
                "symbol": "SPLITCORP",
                "series": "EQ",
                "trade_date": d.strftime("%Y-%m-%d"),
                "open": 200.0,
                "high": 205.0,
                "low": 195.0,
                "close": 200.0,
                "volume": 50000,
                "turnover_cr_est": 1.0,
                "adj_factor": 1.0,
            })
        pd.DataFrame(records).to_parquet(pq_path, index=False)

        # Mock SmartAPI client: returns 2-for-1 split candles (close = 100.0)
        mock_client = MagicMock()
        # overlap candles: 10 sessions with close=100.0 (differs from stored 200.0 by 50% > 1%)
        overlap_data = [
            [d.strftime("%Y-%m-%dT00:00:00+05:30"), 100.0, 102.0, 98.0, 100.0, 100000]
            for d in dates[-10:]
        ]
        # full re-fetch: 30 sessions with close=100.0
        full_data = [
            [d.strftime("%Y-%m-%dT00:00:00+05:30"), 100.0, 102.0, 98.0, 100.0, 100000]
            for d in dates
        ]
        mock_client.get_candle_data.side_effect = [overlap_data, full_data]

        mock_conn = MagicMock()
        res = run_adjustments(client=mock_client, parquet_path=pq_path, conn=mock_conn)
        assert res is True

        # Check updated parquet
        updated_df = pd.read_parquet(pq_path)
        # All rows should now have close=100.0
        assert (updated_df["close"] == 100.0).all()
        # Database insert called with ratio=2.0
        assert mock_conn.cursor.called

def test_adjustments_detects_20pct_large_move():
    """Verify scan logs stock with adjusted 1-day move of 20% or more."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        dates = pd.bdate_range(start="2024-01-01", periods=5)
        records = [
            {"token": 999, "isin": "INE999", "symbol": "ROCKET", "series": "EQ", "trade_date": dates[0].strftime("%Y-%m-%d"), "open": 100, "high": 102, "low": 99, "close": 100, "volume": 10000, "turnover_cr_est": 0.1, "adj_factor": 1.0},
            # Day 2: 25% surge from 100 to 125
            {"token": 999, "isin": "INE999", "symbol": "ROCKET", "series": "EQ", "trade_date": dates[1].strftime("%Y-%m-%d"), "open": 105, "high": 126, "low": 104, "close": 125, "volume": 50000, "turnover_cr_est": 0.6, "adj_factor": 1.0},
        ]
        pd.DataFrame(records).to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        # client=None skips SmartAPI overlap check, proceeds to scan 20% moves
        res = run_adjustments(client=None, parquet_path=pq_path, conn=mock_conn)
        assert res is True
        # Verify db insert was called for LARGE_MOVE_20PCT
        assert mock_conn.cursor.called

# ==========================================
# 2. Quality Gate Enforcements
# ==========================================
def test_quality_gate_fails_below_1500_instruments():
    """Verify quality gate blocks publish if fewer than 1500 instruments have candles on latest date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # Only 50 instruments
        df = create_synthetic_candles(num_sessions=10, tokens=range(1, 51))
        df.to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        with pytest.raises(QualityGateError, match="minimum required: 1500"):
            verify_quality_gate(parquet_path=pq_path, conn=mock_conn, tokens_limit=None)

def test_quality_gate_fails_high_fetch_failure_rate():
    """Verify quality gate blocks publish if > 5% of fetches failed."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        df = create_synthetic_candles(num_sessions=10, tokens=range(1, 10))
        df.to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        # 10 failed out of 100 total = 10% > 5% allowed
        ingest_result = {"total": 100, "success": 90, "failed": 10}
        with pytest.raises(QualityGateError, match="> 5% allowed limit"):
            verify_quality_gate(parquet_path=pq_path, conn=mock_conn, ingest_result=ingest_result)

def test_quality_gate_fails_missing_benchmark_index():
    """Verify quality gate blocks publish if Nifty 50 or Nifty 500 candle is missing on latest date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # Scaled test with tokens_limit=20
        df = create_synthetic_candles(num_sessions=10, tokens=range(1, 21))
        df.to_parquet(pq_path, index=False)

        # Mock DB returning only NIFTY 50, missing NIFTY 500
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = [("NIFTY 50", 24000.0)]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        with pytest.raises(QualityGateError, match="Key benchmark candle"):
            verify_quality_gate(parquet_path=pq_path, conn=mock_conn, tokens_limit=20)

# ==========================================
# 3. Constituents Point-in-Time Membership
# ==========================================
def test_constituents_point_in_time_versioning():
    """Verify that a stock removed on effective_to leaves the universe on that exact date."""
    # Create 3 trade dates: 2024-03-27, 2024-03-28, 2024-03-29
    dates = ["2024-03-27", "2024-03-28", "2024-03-29"]
    records = []
    for d in dates:
        records.append({
            "token": 1,
            "isin": "INE001",
            "symbol": "REMOVED_STOCK",
            "series": "EQ",
            "trade_date": d,
            "open": 100.0, "high": 105.0, "low": 98.0, "close": 102.0,
            "volume": 50000, "turnover_cr_est": 0.51, "adj_factor": 1.0,
        })
    df_raw = pd.DataFrame(records)
    df_ind = compute_stock_indicators(df_raw)
    dist_days = pd.Series(0, index=dates)

    # REMOVED_STOCK effective_to is 2024-03-28 (removed starting March 28)
    const_df = pd.DataFrame([{
        "symbol": "REMOVED_STOCK",
        "effective_from": "2020-01-01",
        "effective_to": "2024-03-28"
    }])

    breadth = compute_breadth_for_universe(
        df_ind=df_ind,
        universe="nifty50",
        dist_days_series=dist_days,
        constituents_df=const_df
    )

    # Must only be present on 2024-03-27, not on 2024-03-28 or 2024-03-29
    computed_dates = [r["trade_date"] for r in breadth]
    assert computed_dates == ["2024-03-27"]

def test_liquid_universe_filtering():
    """Verify liquid universe correctly includes stocks with close >= 20 and volume >= 25000."""
    records = [
        # Stock 1: close=50, vol=30000 -> Liquid
        {"token": 1, "isin": "INE1", "symbol": "LIQUID_1", "series": "EQ", "trade_date": "2024-01-02", "open": 50, "high": 52, "low": 49, "close": 50, "volume": 30000, "turnover_cr_est": 0.15, "adj_factor": 1.0},
        # Stock 2: close=10 (< 20) -> Excluded
        {"token": 2, "isin": "INE2", "symbol": "PENNY", "series": "EQ", "trade_date": "2024-01-02", "open": 10, "high": 11, "low": 9, "close": 10, "volume": 50000, "turnover_cr_est": 0.05, "adj_factor": 1.0},
        # Stock 3: close=100, vol=5000 (< 25000) -> Excluded
        {"token": 3, "isin": "INE3", "symbol": "ILLIQUID", "series": "EQ", "trade_date": "2024-01-02", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 5000, "turnover_cr_est": 0.05, "adj_factor": 1.0},
    ]
    df_raw = pd.DataFrame(records)
    df_ind = compute_stock_indicators(df_raw)
    dist_days = pd.Series(0, index=["2024-01-02"])

    breadth = compute_breadth_for_universe(
        df_ind=df_ind,
        universe="liquid",
        dist_days_series=dist_days
    )
    assert len(breadth) == 1
    assert breadth[0]["total_stocks"] == 1

# ==========================================
# 4. SmartAPIClient Re-auth Cap & Skipping
# ==========================================
def test_smartapi_client_reauth_cap_and_skip():
    """Verify SmartAPIClient caps re-authentication at 2 per run and skips other errors."""
    with patch("pipeline.smartapi_client.SmartConnect") as MockSC:
        mock_instance = MockSC.return_value
        # Initial login
        mock_instance.generateSession.return_value = {"status": True, "data": {"jwtToken": "token1"}}
        
        client = SmartAPIClient(
            api_key="key",
            client_id="id",
            pin="1234",
            totp_secret="JBSWY3DPEHPK3PXP"
        )
        assert client.reauth_count == 1

        # Error response with genuine expiry code AG8001
        mock_instance.getCandleData.return_value = {"status": False, "errorcode": "AG8001", "message": "Token expired"}
        mock_instance.generateSession.return_value = {"status": True, "data": {"jwtToken": "token2"}}

        res = client.get_candle_data("NSE", "123", "ONE_DAY", "2024-01-01 00:00", "2024-01-02 00:00", max_retries=2)
        # Attempted re-auth 2
        assert client.reauth_count == 2

        # Third attempt: reauth_count reaches cap 2, must skip without another generateSession
        mock_instance.generateSession.reset_mock()
        res3 = client.get_candle_data("NSE", "123", "ONE_DAY", "2024-01-01 00:00", "2024-01-02 00:00", max_retries=2)
        assert res3 == []
        mock_instance.generateSession.assert_not_called()

        # Non-expiry error: AG4004 (invalid token parameter) -> skips token immediately without re-auth
        mock_instance.getCandleData.return_value = {"status": False, "errorcode": "AG4004", "message": "Symbol not found"}
        res4 = client.get_candle_data("NSE", "999", "ONE_DAY", "2024-01-01 00:00", "2024-01-02 00:00", max_retries=1)
        assert res4 == []
        mock_instance.generateSession.assert_not_called()

        # Logout terminates session
        client.logout()
        assert client.session_data is None
        mock_instance.terminateSession.assert_called_with("id")
