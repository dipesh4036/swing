"""Tests for atomic snapshot publication, rollback safety, and 700 MB storage guard."""

from unittest.mock import MagicMock

import pytest

from pipeline.industry_publish import MAX_DB_SIZE_BYTES, check_db_storage_guard, publish_industry_snapshot
from pipeline.industry_strength import ComputedIndustrySnapshot


def test_storage_guard_blocks_oversize_db():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchone.return_value = (MAX_DB_SIZE_BYTES + 1024,)

    with pytest.raises(RuntimeError, match="storage guard"):
        check_db_storage_guard(mock_conn)


def test_publish_rolls_back_atomically_on_failure():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchone.return_value = (50 * 1024 * 1024,)
    mock_cur.execute.side_effect = [None, RuntimeError("simulated DB failure")]

    snap = ComputedIndustrySnapshot(
        trade_date="2026-11-23",
        total_stocks=1,
        classified_stocks=1,
        eligible_stocks=1,
        groups=[],
        daily_strength_rows=[],
        stock_metric_rows=[],
    )

    with pytest.raises(RuntimeError, match="simulated DB failure"):
        publish_industry_snapshot(snap, conn=mock_conn)
    mock_conn.rollback.assert_called_once()
    mock_conn.commit.assert_not_called()
