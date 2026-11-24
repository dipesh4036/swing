"""
Unit tests for pipeline.industries (Tab 3 Industry Rotation I1 & I5).
Tests:
- load_industry_map CSV validation
- sync_stock_mcap zip parsing with synthetic inputs
- Non-fatal degraded failure handling
"""

import io
import csv
import zipfile
from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from pipeline.industries import load_industry_map, sync_stock_mcap


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
