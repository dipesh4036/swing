import os
import tempfile
import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import MagicMock

from pipeline.trim import trim_equity_parquet
from pipeline.workflow import run_daily_workflow
from pipeline.compute import compute_breadth_for_universe, compute_stock_indicators, UNIVERSES

def create_synthetic_ohlcv(num_sessions: int, start_date: str = "2022-01-01") -> pd.DataFrame:
    """Helper to generate small synthetic equity OHLCV dataframe."""
    dates = pd.bdate_range(start=start_date, periods=num_sessions)
    records = []
    for tok, sym in [(101, "STOCKA"), (102, "STOCKB")]:
        for d in dates:
            records.append({
                "token": tok,
                "isin": f"INE{tok}0101",
                "symbol": sym,
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

def test_trim_floor_blocks_over_trim():
    """Verify trim refuses to trim if fewer than 504 trading sessions would remain."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # 500 sessions is below the 504 floor
        df = create_synthetic_ohlcv(num_sessions=500, start_date="2024-01-01")
        df.to_parquet(pq_path, index=False)

        with pytest.raises(ValueError, match="below the minimum required floor"):
            trim_equity_parquet(parquet_path=pq_path, retention_years=3, min_sessions_floor=504)

        # Ensure original file was preserved
        preserved_df = pd.read_parquet(pq_path)
        assert len(preserved_df) == len(df)

def test_trim_newest_date_unchanged_and_window_applied():
    """Verify after trim, newest date is unchanged, oldest date is within 3y window, and floor respected."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # 950 business days is ~3.8 years of data
        df = create_synthetic_ohlcv(num_sessions=950, start_date="2022-01-01")
        df.to_parquet(pq_path, index=False)

        orig_max_date = df["trade_date"].max()
        orig_min_date = df["trade_date"].min()

        result = trim_equity_parquet(parquet_path=pq_path, retention_years=3, min_sessions_floor=504)

        trimmed_df = pd.read_parquet(pq_path)
        assert trimmed_df["trade_date"].max() == orig_max_date
        assert trimmed_df["trade_date"].min() > orig_min_date
        assert len(trimmed_df) < len(df)
        assert result["status"] == "success"
        assert result["sessions_remaining"] >= 504

def test_workflow_does_not_trim_after_failed_step():
    """Verify that if any pipeline step fails, daily workflow stops and does NOT trim."""
    trim_mock = MagicMock()
    failed_ingest_mock = MagicMock(side_effect=RuntimeError("Connection timeout to SmartAPI"))

    result = run_daily_workflow(
        sync_instruments_fn=lambda: 100,
        sync_constituents_fn=lambda: {"nifty500": 500},
        sync_indices_fn=lambda: {"nifty50": 10},
        sync_macro_fn=lambda: {"usdinr": 10},
        sync_fii_dii_fn=lambda: 1,
        ingest_equities_fn=failed_ingest_mock,
        adjust_fn=lambda **kwargs: True,
        compute_fn=lambda **kwargs: True,
        trim_fn=trim_mock,
    )

    assert result["status"] == "failed"
    assert result["step"] == "ingest_equities"
    assert result["trimmed"] is False
    # Trim must NEVER have been called
    trim_mock.assert_not_called()

def test_universe_missing_constituents_skipped_not_all():
    """Verify compute skips a missing universe when symbols is None rather than evaluating all stocks."""
    df_raw = create_synthetic_ohlcv(num_sessions=50, start_date="2024-01-01")
    df_ind = compute_stock_indicators(df_raw)
    dist_days = pd.Series(0, index=df_ind["trade_date"].unique())

    # Case A: Missing constituents for nifty200 (symbols is None) -> MUST return empty []
    records_missing = compute_breadth_for_universe(
        df_ind=df_ind,
        universe="nifty200",
        symbols=None,
        dist_days_series=dist_days
    )
    assert records_missing == [], "Universe with None symbols should be skipped, not evaluate all stocks"

    # Case B: Universe 'all' with symbols=None -> evaluates all stocks
    records_all = compute_breadth_for_universe(
        df_ind=df_ind,
        universe="all",
        symbols=None,
        dist_days_series=dist_days
    )
    assert len(records_all) > 0, "Universe 'all' should evaluate all stocks"

    # Case C: Liquid universe is registered
    assert "liquid" in UNIVERSES


def test_store_does_not_upload_after_failure():
    """Verify that store.upload refuses to upload if job_succeeded is False."""
    from pipeline.store import GitHubReleaseStorage

    storage = GitHubReleaseStorage(repo="test/repo", token="dummy_token")
    # Even if file exists, job_succeeded=False must return False immediately
    with tempfile.NamedTemporaryFile(suffix=".parquet") as tmp:
        tmp.write(b"0" * 2000)
        tmp.flush()
        res = storage.upload(local_path=tmp.name, remote_name="test.parquet", job_succeeded=False)
        assert res is False, "upload must return False when job_succeeded is False"

def test_store_rejects_missing_or_tiny_file():
    """Verify that store.upload rejects missing files or files below 1000 bytes."""
    from pipeline.store import GitHubReleaseStorage

    storage = GitHubReleaseStorage(repo="test/repo", token="dummy_token")
    # 1. Non-existent file
    assert storage.upload(local_path="/nonexistent/file.parquet", job_succeeded=True) is False

    # 2. File too small (<1000 bytes)
    with tempfile.NamedTemporaryFile(suffix=".parquet") as tmp:
        tmp.write(b"short")
        tmp.flush()
        assert storage.upload(local_path=tmp.name, job_succeeded=True) is False
