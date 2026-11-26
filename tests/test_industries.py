"""
Unit tests for pipeline.industries (sync_stock_mcap from NSE PR bhavcopy zip).
"""

import io
import csv
import zipfile
from datetime import date
from unittest.mock import MagicMock, patch

from pipeline.industries import sync_stock_mcap


def test_sync_stock_mcap_synthetic_zip():
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
        writer.writerow(["23-Nov-2026", "SYNTH3", "BZ", "Synth 3 Ltd", "BZ", "23-Nov-2026", "10", "100000", "10.00", "1000000"])
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
    assert res["rows_upserted"] == 2


def test_sync_stock_mcap_non_fatal_on_failure():
    mock_conn = MagicMock()
    with patch("pipeline.industries.download_pr_zip") as mock_dl:
        mock_dl.return_value = (None, {"status_code": 404})
        res = sync_stock_mcap(target_date=date(2026, 11, 23), conn=mock_conn)

    assert res["status"] == "degraded"
    assert res["rows"] == 0
