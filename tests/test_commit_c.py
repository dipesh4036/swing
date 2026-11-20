import os
import tempfile
from datetime import datetime, date
from unittest.mock import MagicMock, patch
import pandas as pd
import pytest

from pipeline.workflow import (
    check_workflow_branch,
    get_latest_completed_trading_day,
    run_daily_workflow,
)

def test_latest_completed_trading_day_calculation():
    """Verify latest completed trading day calculation for various hours and weekdays."""
    # Mon Nov 16 at 10:00 IST -> prior weekday was Fri Nov 13
    mon_morning = datetime(2026, 11, 16, 10, 0)
    assert get_latest_completed_trading_day(mon_morning) == date(2026, 11, 13)

    # Mon Nov 16 at 17:00 IST (before 18:30) -> prior weekday was Fri Nov 13
    mon_afternoon = datetime(2026, 11, 16, 17, 0)
    assert get_latest_completed_trading_day(mon_afternoon) == date(2026, 11, 13)

    # Mon Nov 16 at 19:00 IST (after 18:30) -> completed day is Mon Nov 16
    mon_evening = datetime(2026, 11, 16, 19, 0)
    assert get_latest_completed_trading_day(mon_evening) == date(2026, 11, 16)

    # Sun Nov 15 at 12:00 IST -> completed day was Fri Nov 13
    sun_noon = datetime(2026, 11, 15, 12, 0)
    assert get_latest_completed_trading_day(sun_noon) == date(2026, 11, 13)


def test_check_workflow_branch_idempotent_no_op():
    """C2: When Parquet max == breadth max and no weekday gap, branch is idempotent_no_op."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        pd.DataFrame([{"token": 1, "trade_date": "2026-11-18"}]).to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_cur.fetchone.return_value = ("2026-11-18",)

        # Evening of Nov 18 -> latest trading day is Nov 18
        now_ist = datetime(2026, 11, 18, 19, 30)
        res = check_workflow_branch(pq_path, conn=mock_conn, now_ist=now_ist)
        assert res["branch"] == "idempotent_no_op"
        assert res["parquet_max"] == "2026-11-18"
        assert res["breadth_max"] == "2026-11-18"


def test_check_workflow_branch_compute_only():
    """C2: When Parquet max > breadth max, branch is compute_only."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        pd.DataFrame([{"token": 1, "trade_date": "2026-11-18"}]).to_parquet(pq_path, index=False)

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        # Breadth is only at Nov 17
        mock_cur.fetchone.return_value = ("2026-11-17",)

        now_ist = datetime(2026, 11, 18, 19, 30)
        res = check_workflow_branch(pq_path, conn=mock_conn, now_ist=now_ist)
        assert res["branch"] == "compute_only"
        assert res["parquet_max"] == "2026-11-18"
        assert res["breadth_max"] == "2026-11-17"


def test_run_daily_workflow_idempotent_no_op_skips_all_steps():
    """C2: In idempotent_no_op branch, workflow exits success in under 1 minute without calling any step."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        pd.DataFrame([{"token": 1, "trade_date": "2026-11-18"}]).to_parquet(pq_path, index=False)

        mock_fn = MagicMock()
        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={
                 "branch": "idempotent_no_op",
                 "parquet_max": "2026-11-18",
                 "breadth_max": "2026-11-18",
                 "latest_trading_day": "2026-11-18"
             }):

            res = run_daily_workflow(
                sync_instruments_fn=mock_fn,
                sync_constituents_fn=mock_fn,
                sync_indices_fn=mock_fn,
                sync_macro_fn=mock_fn,
                sync_fii_dii_fn=mock_fn,
                ingest_equities_fn=mock_fn,
                adjust_fn=mock_fn,
                compute_fn=mock_fn,
                trim_fn=mock_fn,
                parquet_path=pq_path
            )

            assert res["status"] == "success"
            assert res["branch"] == "idempotent_no_op"
            assert mock_fn.call_count == 0


def test_run_daily_workflow_compute_only_skips_ingest_runs_compute_and_trim():
    """C2: In compute_only branch, workflow skips steps 1-7 and runs step 8 and step 9."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        pd.DataFrame([{"token": 1, "trade_date": "2026-11-18"}]).to_parquet(pq_path, index=False)

        mock_step1_7 = MagicMock()
        mock_compute = MagicMock(return_value=True)
        mock_trim = MagicMock(return_value={"trimmed": True})
        mock_qg = MagicMock(return_value=True)

        with patch("pipeline.workflow.check_storage_guard_and_prune"), \
             patch("pipeline.workflow.check_workflow_branch", return_value={
                 "branch": "compute_only",
                 "parquet_max": "2026-11-18",
                 "breadth_max": "2026-11-17",
                 "latest_trading_day": "2026-11-18"
             }):

            res = run_daily_workflow(
                sync_instruments_fn=mock_step1_7,
                sync_constituents_fn=mock_step1_7,
                sync_indices_fn=mock_step1_7,
                sync_macro_fn=mock_step1_7,
                sync_fii_dii_fn=mock_step1_7,
                ingest_equities_fn=mock_step1_7,
                adjust_fn=mock_step1_7,
                quality_gate_fn=mock_qg,
                compute_fn=mock_compute,
                trim_fn=mock_trim,
                parquet_path=pq_path
            )

            assert res["status"] == "success"
            assert res["branch"] == "compute_only"
            assert mock_step1_7.call_count == 0
            assert mock_compute.call_count == 1
            assert mock_trim.call_count == 1

