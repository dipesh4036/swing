import os
import tempfile
import pytest
from datetime import datetime, timedelta, date
from unittest.mock import MagicMock, patch
import pandas as pd
from pipeline.ingest import ingest_equities, SCHEMA_COLUMNS
from pipeline.smartapi_client import SmartAPIThrottledError
from pipeline.adjust import run_adjustments
from pipeline.workflow import run_daily_workflow

def test_corporate_action_detected_in_ingest_path():
    """
    A7: Stored old close 100, fetched adjusted close 50 ->
    token fully re-fetched and rows replaced with the 9-column schema.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        dates = pd.bdate_range(start="2026-01-01", periods=10)
        stored_records = [
            {
                "token": 999,
                "symbol": "CORPACTION",
                "trade_date": d.strftime("%Y-%m-%d"),
                "open": 100.0,
                "high": 105.0,
                "low": 95.0,
                "close": 100.0,
                "volume": 10000,
                "traded_val": 1000000.0
            }
            for d in dates
        ]
        pd.DataFrame(stored_records).to_parquet(pq_path, index=False)

        mock_client = MagicMock()
        # Incremental fetch returns split price 50.0 (|50 - 100|/100 = 50% > 1%)
        inc_candles = [
            [d.strftime("%Y-%m-%dT00:00:00+05:30"), 50.0, 52.0, 48.0, 50.0, 20000]
            for d in dates[-5:]
        ]
        # Full re-fetch returns all 10 dates at 50.0
        full_candles = [
            [d.strftime("%Y-%m-%dT00:00:00+05:30"), 50.0, 52.0, 48.0, 50.0, 20000]
            for d in dates
        ]
        mock_client.get_candle_data.side_effect = [inc_candles, full_candles]

        with patch("pipeline.ingest.load_target_instruments", return_value=[{"token": 999, "symbol": "CORPACTION"}]), \
             patch("pipeline.ingest.log_price_adjustments") as mock_adj:
            res = ingest_equities(client=mock_client, parquet_path=pq_path)
            assert res["corporate_actions_count"] == 1
            assert mock_adj.called

        updated_df = pd.read_parquet(pq_path)
        assert (updated_df["close"] == 50.0).all()
        assert list(updated_df.columns) == SCHEMA_COLUMNS

def test_throttled_distinct_from_no_data():
    """A7: Throttled != no_data failure accounting."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        mock_client = MagicMock()

        # Token 1 throttles, Token 2 returns empty (no data)
        def mock_get_candle(exchange, symbol_token, interval, from_date, to_date):
            if symbol_token == "101":
                raise SmartAPIThrottledError("Rate limit exceeded after retries")
            return []

        mock_client.get_candle_data.side_effect = mock_get_candle
        mock_client.current_req_per_sec = 1.0

        instruments = [
            {"token": 101, "symbol": "THROTTLED_STOCK"},
            {"token": 102, "symbol": "NO_DATA_STOCK"}
        ]

        with patch("pipeline.ingest.load_target_instruments", return_value=instruments), \
             patch("pipeline.ingest.send_telegram_alert"):
            res = ingest_equities(client=mock_client, parquet_path=pq_path)
            assert res["throttled"] == 1
            assert res["no_data"] == 1
            assert res["success"] == 0

def test_status_rules_at_thresholds():
    """A7: Status rules: <=2% is not failed; >2% is failed; 0.5-2% is partial; <0.5% is success."""
    # Test 0.4% missing -> success
    # 1000 tokens, 4 missing -> 0.4%
    # Test 1.0% missing -> partial (10 missing of 1000)
    # Test 3.0% missing -> failed (30 missing of 1000)
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")

        def run_with_missing(total, missing):
            mock_client = MagicMock()
            instruments = [{"token": i, "symbol": f"SYM{i}"} for i in range(total)]
            target_date = "2026-11-18"

            def get_candle(exchange, symbol_token, interval, from_date, to_date):
                t = int(symbol_token)
                if t < (total - missing):
                    return [[f"{target_date}T00:00:00+05:30", 100.0, 105.0, 95.0, 100.0, 1000]]
                return []

            mock_client.get_candle_data.side_effect = get_candle
            mock_client.current_req_per_sec = 1.0

            with patch("pipeline.ingest.load_target_instruments", return_value=instruments), \
                 patch("pipeline.ingest.send_telegram_alert"):
                return ingest_equities(client=mock_client, parquet_path=pq_path, target_trade_date=target_date)

        # 0.4% missing (4/1000) -> success
        res_04 = run_with_missing(1000, 4)
        assert res_04["status"] == "success"
        assert res_04["missing_pct"] == pytest.approx(0.4, rel=1e-2)

        # 1.0% missing (10/1000) -> partial
        res_10 = run_with_missing(1000, 10)
        assert res_10["status"] == "partial"
        assert res_10["missing_pct"] == pytest.approx(1.0, rel=1e-2)

        # 3.0% missing (30/1000) -> failed
        res_30 = run_with_missing(1000, 30)
        assert res_30["status"] == "failed"
        assert res_30["missing_pct"] == pytest.approx(3.0, rel=1e-2)

def test_ingest_success_requires_target_date():
    """A7: Ingest result 'success' requires the target trade date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        mock_client = MagicMock()
        # Stock 1 returns candle for 2026-11-17, Stock 2 returns candle for older date 2026-11-15
        mock_client.get_candle_data.side_effect = [
            [["2026-11-17T00:00:00+05:30", 100.0, 105.0, 95.0, 100.0, 1000]],
            [["2026-11-15T00:00:00+05:30", 50.0, 52.0, 48.0, 50.0, 500]]
        ]
        instruments = [
            {"token": 1, "symbol": "FRESH"},
            {"token": 2, "symbol": "OLD_ONLY"}
        ]
        with patch("pipeline.ingest.load_target_instruments", return_value=instruments), \
             patch("pipeline.ingest.send_telegram_alert"):
            res = ingest_equities(client=mock_client, parquet_path=pq_path, target_trade_date="2026-11-17")
            assert res["success"] == 1  # Only token 1 has target date
            assert res["no_data"] == 1   # Token 2 lacks target date

def test_adjust_step_makes_zero_angel_calls():
    """A7: Adjust step makes zero Angel calls."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        df = pd.DataFrame([
            {"token": 1, "symbol": "STK1", "trade_date": "2026-11-16", "open": 100.0, "high": 105.0, "low": 95.0, "close": 100.0, "volume": 1000, "traded_val": 100000.0},
            {"token": 1, "symbol": "STK1", "trade_date": "2026-11-17", "open": 130.0, "high": 135.0, "low": 125.0, "close": 130.0, "volume": 2000, "traded_val": 260000.0},
        ])
        df.to_parquet(pq_path, index=False)

        mock_client = MagicMock()
        mock_conn = MagicMock()
        res = run_adjustments(client=mock_client, parquet_path=pq_path, conn=mock_conn)
        assert res is True
        # Verify ZERO calls made to Angel
        assert mock_client.get_candle_data.call_count == 0
        assert mock_conn.cursor.called

def test_early_upload_after_step_6():
    """A7: Upload happens immediately after step 6 when >= 1,500 tokens present on latest date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        # Build parquet with 1500 tokens on latest date
        records = [
            {"token": i, "symbol": f"S{i}", "trade_date": "2026-11-18", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0}
            for i in range(1500)
        ]
        pd.DataFrame(records).to_parquet(pq_path, index=False)

        mock_upload = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.store.upload_parquet_store", mock_upload):
            res = run_daily_workflow(
                sync_instruments_fn=lambda: 1500,
                sync_constituents_fn=lambda: 500,
                sync_indices_fn=lambda: True,
                sync_macro_fn=lambda: True,
                sync_fii_dii_fn=lambda: True,
                ingest_equities_fn=lambda **kw: {"status": "success", "total": 1500, "success": 1500},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=lambda **kw: {"trimmed": True},
                parquet_path=pq_path,
                tokens_limit=1500
            )
            assert res["status"] == "success"
            # Early upload occurred
            assert mock_upload.called

