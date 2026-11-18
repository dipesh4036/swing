import io
import os
import zipfile
import tempfile
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock, patch
import pandas as pd
import pytest

from pipeline.bhavcopy import (
    download_bhavcopy_raw,
    parse_and_validate_bhavcopy,
    ingest_bhavcopy,
    BhavcopyValidationError,
    get_missing_trading_dates,
)
from pipeline.ingest import SCHEMA_COLUMNS

COLUMNS_34 = [
    "TradDt", "BizDt", "Sgmt", "Src", "FinInstrmTp", "FinInstrmId", "ISIN", "TckrSymb",
    "SctySrs", "XpryDt", "FininstrmActlXpryDt", "StrkPric", "OptnTp", "FinInstrmNm",
    "OpnPric", "HghPric", "LwPric", "ClsPric", "LastPric", "PrvsClsgPric", "UndrlygPric",
    "SttlmPric", "OpnIntrst", "ChngInOpnIntrst", "TtlTradgVol", "TtlTrfVal",
    "TtlNbOfTxsExctd", "SsnId", "NewBrdLotQty", "Rmks", "Rsvd1", "Rsvd2", "Rsvd3", "Rsvd4"
]

def make_synthetic_bhavcopy_zip(rows_data: list, target_date_str: str = "2026-11-18") -> bytes:
    """Builds an in-memory zip file with Bhavcopy CSV matching the 34 columns."""
    full_rows = []
    for r in rows_data:
        row = {c: "" for c in COLUMNS_34}
        row["TradDt"] = r.get("TradDt", target_date_str)
        row["Sgmt"] = r.get("Sgmt", "CM")
        row["FinInstrmId"] = r.get("token", 100)
        row["ISIN"] = r.get("ISIN", "INE123456789")
        row["TckrSymb"] = r.get("symbol", "TEST")
        row["SctySrs"] = r.get("series", "EQ")
        row["OpnPric"] = r.get("open", 100.0)
        row["HghPric"] = r.get("high", 110.0)
        row["LwPric"] = r.get("low", 95.0)
        row["ClsPric"] = r.get("close", 105.0)
        row["PrvsClsgPric"] = r.get("prev_close", 100.0)
        row["TtlTradgVol"] = r.get("volume", 5000)
        full_rows.append(row)

    df = pd.DataFrame(full_rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"BhavCopy_NSE_CM_0_0_0_{target_date_str.replace('-', '')}_F_0000.csv", df.to_csv(index=False))
    return buf.getvalue()


def test_series_and_isin_filter():
    """B6: Filter keeps only CM segment, EQ/BE series, and INE ISIN prefix."""
    rows = [
        {"token": 1, "symbol": "KEEP1", "series": "EQ", "ISIN": "INE001A01010"},
        {"token": 2, "symbol": "KEEP2", "series": "BE", "ISIN": "INE002A01010"},
        {"token": 3, "symbol": "DROP_SM", "series": "SM", "ISIN": "INE003A01010"},
        {"token": 4, "symbol": "DROP_GB", "series": "GB", "ISIN": "INE004A01010"},
        {"token": 5, "symbol": "DROP_SG", "series": "SG", "ISIN": "INE005A01010"},
        {"token": 6, "symbol": "DROP_ST", "series": "ST", "ISIN": "INE006A01010"},
        {"token": 7, "symbol": "DROP_NON_INE", "series": "EQ", "ISIN": "INF007A01010"},
        {"token": 8, "symbol": "DROP_SEGMENT", "series": "EQ", "ISIN": "INE008A01010", "Sgmt": "FO"},
    ]
    zip_bytes = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-18")
    df = parse_and_validate_bhavcopy(zip_bytes, target_date=date(2026, 11, 18), min_rows=2)
    assert len(df) == 2
    assert set(df["symbol"]) == {"KEEP1", "KEEP2"}


def test_validation_rejects_wrong_traddt():
    """B6: Rejects file where TradDt does not match requested date."""
    rows = [{"token": i, "symbol": f"S{i}", "TradDt": "2026-11-17"} for i in range(10)]
    zip_bytes = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-17")
    with pytest.raises(BhavcopyValidationError, match="TradDt does not match requested date"):
        parse_and_validate_bhavcopy(zip_bytes, target_date=date(2026, 11, 18), min_rows=1)


def test_validation_rejects_insufficient_rows():
    """B6: Rejects file with fewer than min_rows (e.g. 1500)."""
    rows = [{"token": i, "symbol": f"S{i}"} for i in range(10)]
    zip_bytes = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-18")
    with pytest.raises(BhavcopyValidationError, match="is below minimum floor of 1500"):
        parse_and_validate_bhavcopy(zip_bytes, target_date=date(2026, 11, 18), min_rows=1500)


def test_validation_rejects_nan_and_negative_ohlc():
    """B6: Rejects file with NaN or <=0 in OHLC."""
    rows_nan = [{"token": 1, "symbol": "S1", "open": None}]
    zip_bytes_nan = make_synthetic_bhavcopy_zip(rows_nan, target_date_str="2026-11-18")
    with pytest.raises(BhavcopyValidationError, match="NaN values found"):
        parse_and_validate_bhavcopy(zip_bytes_nan, target_date=date(2026, 11, 18), min_rows=1)

    rows_neg = [{"token": 1, "symbol": "S1", "close": -5.0}]
    zip_bytes_neg = make_synthetic_bhavcopy_zip(rows_neg, target_date_str="2026-11-18")
    with pytest.raises(BhavcopyValidationError, match="non-positive values"):
        parse_and_validate_bhavcopy(zip_bytes_neg, target_date=date(2026, 11, 18), min_rows=1)


def test_validation_rejects_high_less_than_low():
    """B6: Rejects file where high < low."""
    rows = [{"token": 1, "symbol": "S1", "high": 90.0, "low": 100.0, "close": 95.0}]
    zip_bytes = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-18")
    with pytest.raises(BhavcopyValidationError, match="where high < low"):
        parse_and_validate_bhavcopy(zip_bytes, target_date=date(2026, 11, 18), min_rows=1)


def test_corporate_action_mismatch_threshold_and_new_token():
    """B6: Corporate action check flags diff > 0.5% (0.6% flagged, 0.4% not flagged); new tokens not flagged."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # Existing parquet has previous session date 2026-11-17 with tokens 1, 2
        prev_records = [
            {"token": 1, "symbol": "TOK1", "trade_date": "2026-11-17", "open": 100.0, "high": 105.0, "low": 98.0, "close": 100.0, "volume": 1000, "traded_val": 100000.0},
            {"token": 2, "symbol": "TOK2", "trade_date": "2026-11-17", "open": 100.0, "high": 105.0, "low": 98.0, "close": 100.0, "volume": 1000, "traded_val": 100000.0},
        ]
        pd.DataFrame(prev_records).to_parquet(pq_path, index=False)

        # Bhavcopy for 2026-11-18:
        # TOK1: stored close=100.0, prev_close=99.6 (diff = 0.4% <= 0.5% -> NOT flagged)
        # TOK2: stored close=100.0, prev_close=99.4 (diff = 0.6% > 0.5% -> FLAGGED)
        # TOK3: new token (not in Parquet -> NOT flagged for corporate action)
        bhav_rows = [
            {"token": 1, "symbol": "TOK1", "prev_close": 99.6, "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0, "volume": 1000},
            {"token": 2, "symbol": "TOK2", "prev_close": 99.4, "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0, "volume": 1000},
            {"token": 3, "symbol": "TOK3", "prev_close": 50.0, "open": 50.0, "high": 52.0, "low": 49.0, "close": 51.0, "volume": 500},
        ]
        zip_bytes = make_synthetic_bhavcopy_zip(bhav_rows, target_date_str="2026-11-18")

        mock_client = MagicMock()
        # Mock full window refetch for TOK2 with SmartAPI list format: [time, open, high, low, close, volume]
        mock_client.get_candle_data.return_value = [
            ["2026-11-17T00:00:00+05:30", 99.0, 102.0, 98.0, 99.4, 1000],
            ["2026-11-18T00:00:00+05:30", 100.0, 102.0, 99.0, 101.0, 1000],
        ]

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(zip_bytes, {"status_code": 200, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.SmartAPIClient.login_from_env", return_value=mock_client), \
             patch("pipeline.bhavcopy.log_price_adjustments") as mock_log_adj:

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=3)
            assert res["status"] == "success"
            assert res["refetched"] == 1  # Only TOK2 was refetched
            mock_log_adj.assert_called_once()
            adj_list = mock_log_adj.call_args[0][0]
            assert len(adj_list) == 1
            assert adj_list[0]["token"] == 2


def test_multidate_catchup_processes_oldest_first():
    """B6: Multi-date catch-up processes oldest first and compares against prior session."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # Parquet ends on Friday 2026-11-13
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-13",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        # Missing dates: Monday 2026-11-16, Tuesday 2026-11-17
        calls_order = []

        def mock_download(d, **kw):
            calls_order.append(d)
            rows = [{"token": 1, "symbol": "S1", "prev_close": 10.0, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100}]
            zb = make_synthetic_bhavcopy_zip(rows, target_date_str=d.strftime("%Y-%m-%d"))
            return zb, {"status_code": 200, "host": "nsearchives"}

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 17)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", side_effect=mock_download):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1)
            assert res["status"] == "success"
            assert calls_order == [date(2026, 11, 16), date(2026, 11, 17)]
            final_df = pd.read_parquet(pq_path)
            assert sorted(final_df["trade_date"].unique().tolist()) == ["2026-11-13", "2026-11-16", "2026-11-17"]


def test_past_date_404_skipped_as_holiday():
    """B6: Past date returning 404 is skipped as market holiday."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-13",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        def mock_download(d, **kw):
            if d == date(2026, 11, 16):  # Holiday 404
                return None, {"status_code": 404, "host": "nsearchives"}
            rows = [{"token": 1, "symbol": "S1", "prev_close": 10.0, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100}]
            zb = make_synthetic_bhavcopy_zip(rows, target_date_str=d.strftime("%Y-%m-%d"))
            return zb, {"status_code": 200, "host": "nsearchives"}

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 17)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", side_effect=mock_download):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1)
            assert res["status"] == "success"
            assert res["dates_ingested"] == ["2026-11-17"]


def test_today_404_polls_then_fails():
    """B6: Today's date returning 404 polls every 5 min up to 40 min, then fails and alerts."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-17",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        mock_sleep = MagicMock()
        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(None, {"status_code": 404, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.send_telegram_alert") as mock_alert, \
             patch("pipeline.bhavcopy.log_ingest_run"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=mock_sleep)
            assert res["status"] == "failed"
            assert mock_sleep.call_count == 7  # 8 polls total (sleep between 1-7)
            mock_alert.assert_called()


def test_gap_gt_10_routes_to_angel():
    """B6: Gap > 10 missing trading days routes to Angel path for repair."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # Last stored date 15 weekdays ago
        old_date = date(2026, 10, 1)
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": old_date.strftime("%Y-%m-%d"),
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)), \
             patch("pipeline.ingest.ingest_equities", return_value={"status": "success", "source": "angel"}) as mock_angel_ingest:

            res = ingest_bhavcopy(parquet_path=pq_path)
            mock_angel_ingest.assert_called_once()
            assert res["source"] == "angel"


def test_idempotent_rerun_adds_no_rows():
    """B6: Running ingest_bhavcopy when store already has today adds no rows."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-18",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)):
            res = ingest_bhavcopy(parquet_path=pq_path)
            assert res["status"] == "success"
            assert res["dates_ingested"] == 0
            assert res["rows"] == 0


def test_fallback_on_validation_failure():
    """B6: Validation failure on a date triggers Angel fallback for that date."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-16",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        # Corrupt data with high < low
        bad_rows = [{"token": 1, "symbol": "S1", "high": 9.0, "low": 10.0}]
        zb = make_synthetic_bhavcopy_zip(bad_rows, target_date_str="2026-11-17")

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 17)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(zb, {"status_code": 200, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.send_telegram_alert") as mock_alert, \
             patch("pipeline.ingest.ingest_equities", return_value={"status": "success", "source": "angel_fallback"}) as mock_angel_fallback:

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1)
            mock_alert.assert_called()
            mock_angel_fallback.assert_called_once()
            assert res["source"] == "angel_fallback"
