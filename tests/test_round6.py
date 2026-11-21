import os
import tempfile
import pytest
from unittest.mock import MagicMock, patch
import pandas as pd
import numpy as np

from pipeline.indices_macro import _parse_fii_dii_val
from pipeline.compute import attach_adjacent_prev_close
from pipeline.adjust import run_adjustments
from pipeline.workflow import run_daily_workflow
from pipeline.instruments import check_stored_constituents_exist

# ============================================================================
# R21: sync_fii_dii value parsing (no invented zeros)
# ============================================================================

def test_r21_parse_fii_dii_val():
    """R21: _parse_fii_dii_val returns None for missing, empty, or dash values; parses valid floats."""
    assert _parse_fii_dii_val(None) is None
    assert _parse_fii_dii_val("") is None
    assert _parse_fii_dii_val("   ") is None
    assert _parse_fii_dii_val("-") is None
    assert _parse_fii_dii_val("—") is None
    assert _parse_fii_dii_val("nan") is None
    assert _parse_fii_dii_val("NA") is None
    assert _parse_fii_dii_val("null") is None
    # Valid numeric strings with or without commas
    assert _parse_fii_dii_val("0") == 0.0
    assert _parse_fii_dii_val("11745.95") == 11745.95
    assert _parse_fii_dii_val("-2253.58") == -2253.58
    assert _parse_fii_dii_val("13,999.53") == 13999.53

def test_r21_fii_dii_missing_net_value_and_absent_category():
    """R21: item without netValue writes NULL, not 0. Absent category writes NULL."""
    from pipeline.indices_macro import sync_fii_dii
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    mock_resp = MagicMock()
    # Response has DII without netValue, and NO FII item for 2026-11-20
    mock_resp.json.return_value = [
        {
            "category": "DII",
            "date": "20-Nov-2026",
            "buyValue": "1000.0",
            "sellValue": "800.0",
            # netValue is completely missing
        }
    ]
    mock_resp.raise_for_status = MagicMock()

    with patch("requests.Session.get", return_value=mock_resp), \
         patch("pipeline.indices_macro.execute_batch") as mock_batch:
        count = sync_fii_dii(conn=mock_conn)
        assert count == 1
        assert mock_batch.called
        _, batch_args, _ = mock_batch.mock_calls[0]
        records = batch_args[2]
        assert len(records) == 1
        d, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net = records[0]
        assert d == "2026-11-20"
        assert fii_buy is None
        assert fii_sell is None
        assert fii_net is None
        assert dii_buy == 1000.0
        assert dii_sell == 800.0
        assert dii_net is None  # R21: netValue missing -> None (NULL), NOT 0

# ============================================================================
# R22: Large-move scan calendar adjacency (no false rows after gaps)
# ============================================================================

def test_r22_large_move_scan_gap_vs_contiguous():
    """R22: Gap + 30% jump produces NO row; contiguous 30% jump produces ONE row."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_adj.parquet")

        # Market dates: 2026-11-10, 2026-11-11, 2026-11-12, 2026-11-13, 2026-11-14
        # Token 1: Present on 2026-11-10 at close 100, ABSENT 11, 12, 13, REAPPEARS on 14 at close 130 (+30% move across a gap)
        # Token 2: Present on 2026-11-13 at close 100, and on 2026-11-14 at close 130 (+30% contiguous move)
        # Token 3: Benchmark token to define market calendar on 10, 11, 12, 13, 14
        records = [
            # Benchmark token 99
            {"token": 99, "symbol": "MKT", "trade_date": "2026-11-10", "close": 100.0},
            {"token": 99, "symbol": "MKT", "trade_date": "2026-11-11", "close": 100.0},
            {"token": 99, "symbol": "MKT", "trade_date": "2026-11-12", "close": 100.0},
            {"token": 99, "symbol": "MKT", "trade_date": "2026-11-13", "close": 100.0},
            {"token": 99, "symbol": "MKT", "trade_date": "2026-11-14", "close": 100.0},
            # Token 1: Gap across sessions 11, 12, 13
            {"token": 1, "symbol": "GAP_STOCK", "trade_date": "2026-11-10", "close": 100.0},
            {"token": 1, "symbol": "GAP_STOCK", "trade_date": "2026-11-14", "close": 130.0},
            # Token 2: Contiguous sessions 13 and 14
            {"token": 2, "symbol": "CONTIG_STOCK", "trade_date": "2026-11-13", "close": 100.0},
            {"token": 2, "symbol": "CONTIG_STOCK", "trade_date": "2026-11-14", "close": 130.0},
        ]
        pd.DataFrame(records).to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        with patch("psycopg2.extras.execute_batch") as mock_batch:
            success = run_adjustments(parquet_path=pq_path, conn=mock_conn)
            assert success is True
            assert mock_batch.called
            _, batch_args, _ = mock_batch.mock_calls[0]
            # batch_args[2] is records: [(token, symbol, ex_date, action_type, ratio)]
            inserted_records = batch_args[2]
            symbols_inserted = [r[1] for r in inserted_records]

            # Token 1 (GAP_STOCK) must NOT be present
            assert "GAP_STOCK" not in symbols_inserted
            # Token 2 (CONTIG_STOCK) MUST be present
            assert "CONTIG_STOCK" in symbols_inserted
            assert len(inserted_records) == 1
            assert inserted_records[0][0] == 2
            assert inserted_records[0][4] == 1.3  # 130 / 100

def test_r22_attach_adjacent_prev_close_helper():
    """R22: Helper attach_adjacent_prev_close sets prev_close = NaN when previous session is missing."""
    df = pd.DataFrame([
        {"token": 1, "trade_date": "2026-11-10", "close": 100.0},
        {"token": 1, "trade_date": "2026-11-12", "close": 110.0}, # gap (missing 11)
        {"token": 2, "trade_date": "2026-11-10", "close": 50.0},
        {"token": 2, "trade_date": "2026-11-11", "close": 52.0},
        {"token": 2, "trade_date": "2026-11-12", "close": 55.0},
    ])
    res = attach_adjacent_prev_close(df)
    t1_rows = res[res["token"] == 1].sort_values("trade_date")
    assert np.isnan(t1_rows.iloc[0]["prev_close"])
    assert np.isnan(t1_rows.iloc[1]["prev_close"]) # Row on 11-12 is preceded by 11-10 in token 1, but calendar had 11-11!

    t2_rows = res[res["token"] == 2].sort_values("trade_date")
    assert np.isnan(t2_rows.iloc[0]["prev_close"])
    assert t2_rows.iloc[1]["prev_close"] == 50.0
    assert t2_rows.iloc[2]["prev_close"] == 52.0

# ============================================================================
# R20: Non-core step failure handling & degradation
# ============================================================================

def test_r20_non_core_steps_raising_continues_and_ends_partial():
    """R20: If non-core steps (2, 4, 5) raise, run continues, sends ONE alert, trims, ends 'partial'."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        pd.DataFrame([{"token": 1, "symbol": "S1", "trade_date": "2026-11-18", "close": 100.0}]).to_parquet(pq_path, index=False)

        mock_alert = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={"branch": "full_workflow"}), \
             patch("pipeline.workflow.send_telegram_alert", mock_alert), \
             patch("pipeline.instruments.check_stored_constituents_exist", return_value=True), \
             patch("pipeline.workflow.get_connection"):

            def fail_constituents():
                raise RuntimeError("NSE site unreachable for constituents")

            def fail_macro():
                raise RuntimeError("Yahoo Finance rate limited")

            def fail_fii_dii():
                raise RuntimeError("Akamai 403 on NSE FII/DII")

            res = run_daily_workflow(
                sync_instruments_fn=lambda: 2000,
                sync_constituents_fn=fail_constituents,
                sync_indices_fn=lambda: True,
                sync_macro_fn=fail_macro,
                sync_fii_dii_fn=fail_fii_dii,
                ingest_equities_fn=lambda **kw: {"status": "success", "total": 2000, "success": 2000},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=lambda **kw: {"trimmed": True},
                parquet_path=pq_path,
            )

            assert res["status"] == "partial"
            assert res["trimmed"] is True
            assert "degraded_steps" in res
            assert set(res["degraded_steps"]) == {"sync_constituents", "sync_macro", "sync_fii_dii"}
            # Exactly ONE alert sent for the degraded steps
            assert mock_alert.call_count == 1
            alert_text = mock_alert.mock_calls[0][1][0]
            assert "[Pipeline Alert] Non-core step(s) degraded:" in alert_text
            assert "sync_constituents" in alert_text
            assert "sync_macro" in alert_text
            assert "sync_fii_dii" in alert_text

def test_r20_single_non_core_step_failure():
    """R20: If only sync_fii_dii raises, run continues, ends 'partial', trim executes."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        pd.DataFrame([{"token": 1, "symbol": "S1", "trade_date": "2026-11-18", "close": 100.0}]).to_parquet(pq_path, index=False)

        mock_alert = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={"branch": "full_workflow"}), \
             patch("pipeline.workflow.send_telegram_alert", mock_alert), \
             patch("pipeline.workflow.get_connection"):

            res = run_daily_workflow(
                sync_instruments_fn=lambda: 2000,
                sync_constituents_fn=lambda: {"nifty500": 501},
                sync_indices_fn=lambda: True,
                sync_macro_fn=lambda: {"macro_rows": 100},
                sync_fii_dii_fn=lambda: (_ for _ in ()).throw(RuntimeError("FII/DII failed")),
                ingest_equities_fn=lambda **kw: {"status": "success", "total": 2000, "success": 2000},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=lambda **kw: {"trimmed": True},
                parquet_path=pq_path,
            )

            assert res["status"] == "partial"
            assert res["trimmed"] is True
            assert res["degraded_steps"] == ["sync_fii_dii"]
            assert mock_alert.call_count == 1

def test_r20_core_step_failure_stops_and_no_trim():
    """R20: Core step failures (e.g. sync_indices) stop workflow immediately and do NOT trim."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        pd.DataFrame([{"token": 1, "symbol": "S1", "trade_date": "2026-11-18", "close": 100.0}]).to_parquet(pq_path, index=False)

        mock_alert = MagicMock()
        mock_trim = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={"branch": "full_workflow"}), \
             patch("pipeline.workflow.send_telegram_alert", mock_alert):

            res = run_daily_workflow(
                sync_instruments_fn=lambda: 2000,
                sync_constituents_fn=lambda: {"nifty500": 501},
                sync_indices_fn=lambda: (_ for _ in ()).throw(RuntimeError("SmartAPI connection refused")),
                sync_macro_fn=lambda: True,
                sync_fii_dii_fn=lambda: True,
                ingest_equities_fn=lambda **kw: {"status": "success"},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=mock_trim,
                parquet_path=pq_path,
            )

            assert res["status"] == "failed"
            assert res["step"] == "sync_indices"
            assert res["trimmed"] is False
            assert not mock_trim.called
            assert mock_alert.called

def test_r20_constituents_empty_and_failure_is_fatal():
    """R20: If sync_constituents fails AND stored constituents are missing, it remains FATAL."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        pd.DataFrame([{"token": 1, "symbol": "S1", "trade_date": "2026-11-18", "close": 100.0}]).to_parquet(pq_path, index=False)

        mock_alert = MagicMock()
        mock_trim = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={"branch": "full_workflow"}), \
             patch("pipeline.workflow.send_telegram_alert", mock_alert), \
             patch("pipeline.instruments.check_stored_constituents_exist", return_value=False):

            res = run_daily_workflow(
                sync_instruments_fn=lambda: 2000,
                sync_constituents_fn=lambda: (_ for _ in ()).throw(RuntimeError("NSE down")),
                sync_indices_fn=lambda: True,
                sync_macro_fn=lambda: True,
                sync_fii_dii_fn=lambda: True,
                ingest_equities_fn=lambda **kw: {"status": "success"},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=mock_trim,
                parquet_path=pq_path,
            )

            assert res["status"] == "failed"
            assert res["step"] == "sync_constituents"
            assert res["trimmed"] is False
            assert not mock_trim.called
            assert mock_alert.called

# ============================================================================
# R24: Degraded status updates exact run_id and closes connection
# ============================================================================

def test_r24_degraded_status_updates_exact_run_id():
    """R24: Ingest run update uses exact run_id from step 6, not latest subquery, and closes conn."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test_equity.parquet")
        pd.DataFrame([{"token": 1, "symbol": "S1", "trade_date": "2026-11-18", "close": 100.0}]).to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={"branch": "full_workflow"}), \
             patch("pipeline.workflow.send_telegram_alert"), \
             patch("pipeline.db.get_connection", return_value=mock_conn):

            res = run_daily_workflow(
                sync_instruments_fn=lambda: 2000,
                sync_constituents_fn=lambda: {"nifty500": 501},
                sync_indices_fn=lambda: True,
                sync_macro_fn=lambda: True,
                sync_fii_dii_fn=lambda: (_ for _ in ()).throw(RuntimeError("FII/DII failed")),
                ingest_equities_fn=lambda **kw: {"status": "success", "run_id": 42},
                adjust_fn=lambda **kw: True,
                quality_gate_fn=lambda **kw: True,
                compute_fn=lambda **kw: True,
                trim_fn=lambda **kw: {"trimmed": True},
                parquet_path=pq_path,
            )

            assert res["status"] == "partial"
            assert mock_cur.execute.called

            update_calls = [
                call for call in mock_cur.execute.call_args_list
                if "UPDATE ingest_runs" in str(call)
            ]
            assert len(update_calls) == 1
            query, params = update_calls[0][0]
            assert "WHERE run_id = %s" in query
            assert params[2] == 42
            # Verify connection was explicitly closed
            assert mock_conn.close.called

