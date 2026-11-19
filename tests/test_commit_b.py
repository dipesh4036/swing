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
             patch("pipeline.bhavcopy.log_price_adjustments") as mock_log_adj, \
             patch("pipeline.bhavcopy.log_ingest_run"):

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
             patch("pipeline.bhavcopy.download_bhavcopy_raw", side_effect=mock_download), \
             patch("pipeline.bhavcopy.log_ingest_run"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
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
             patch("pipeline.bhavcopy.download_bhavcopy_raw", side_effect=mock_download), \
             patch("pipeline.bhavcopy.check_nifty_candle_exists", return_value=False), \
             patch("pipeline.bhavcopy.log_ingest_run"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
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
             patch("pipeline.bhavcopy.check_nifty_candle_exists", return_value=True), \
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
             patch("pipeline.ingest.ingest_equities", autospec=True, return_value={"status": "success", "source": "angel"}) as mock_angel_ingest:

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
             patch("pipeline.ingest.ingest_equities", autospec=True, return_value={"status": "success", "source": "angel_fallback"}) as mock_angel_fallback:

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
            mock_alert.assert_called()
            mock_angel_fallback.assert_called_once()
            assert res["source"] == "angel_fallback"


def test_fallback_on_unreachable_past_date_when_nifty_exists():
    """Item 1: Unreachable past date on confirmed trading day (Nifty candle exists) falls back to Angel."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-13",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 17)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(None, {"status_code": 500, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.check_nifty_candle_exists", return_value=True), \
             patch("pipeline.bhavcopy.send_telegram_alert") as mock_alert, \
             patch("pipeline.ingest.ingest_equities", autospec=True, return_value={"status": "success", "source": "angel_fallback"}) as mock_angel_fallback:

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
            mock_alert.assert_called()
            mock_angel_fallback.assert_called_once()
            assert res["source"] == "angel_fallback"


def test_ist_1830_rule_today_candidate_only_after_1830():
    """Item 2: Today is NOT a candidate date before 18:30 IST, and IS a candidate date at or after 18:30 IST."""
    from pipeline.bhavcopy import get_missing_trading_dates
    # Tuesday 2026-11-17 06:00 IST (morning cron)
    morning_dt = datetime(2026, 11, 17, 6, 0)
    missing_morning = get_missing_trading_dates(date(2026, 11, 13), now_ist=morning_dt)
    assert missing_morning == [date(2026, 11, 16)]

    # Tuesday 2026-11-17 18:35 IST (evening cron)
    evening_dt = datetime(2026, 11, 17, 18, 35)
    missing_evening = get_missing_trading_dates(date(2026, 11, 13), now_ist=evening_dt)
    assert missing_evening == [date(2026, 11, 16), date(2026, 11, 17)]


def test_holiday_evening_skipped_without_40min_poll():
    """Item 2: Weekday holiday with no Nifty candle polls at most 3 times and skips without alert."""
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
             patch("pipeline.bhavcopy.check_nifty_candle_exists", return_value=False), \
             patch("pipeline.bhavcopy.send_telegram_alert") as mock_alert, \
             patch("pipeline.bhavcopy.log_ingest_run"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=mock_sleep)
            assert res["status"] == "success"
            assert mock_sleep.call_count == 2  # Max 3 attempts -> 2 sleeps
            mock_alert.assert_not_called()


def test_partial_progress_saved_and_uploaded_on_later_date_failure():
    """Item 2: Partial progress upload when first date succeeds and later date fails."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        init_df = pd.DataFrame([{
            "token": 1, "symbol": "S1", "trade_date": "2026-11-13",
            "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0
        }])
        init_df.to_parquet(pq_path, index=False)

        def mock_download(d, **kw):
            if d == date(2026, 11, 16):
                rows = [{"token": 1, "symbol": "S1", "prev_close": 10.0, "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100}]
                zb = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-16")
                return zb, {"status_code": 200, "host": "nsearchives"}
            return None, {"status_code": 404, "host": "nsearchives"}

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 17)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", side_effect=mock_download), \
             patch("pipeline.bhavcopy.check_nifty_candle_exists", return_value=True), \
             patch("pipeline.store.upload_parquet_store") as mock_upload, \
             patch("pipeline.bhavcopy.send_telegram_alert"), \
             patch("pipeline.bhavcopy.log_ingest_run"), \
             patch("time.sleep"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
            assert res["status"] == "partial"
            assert res["dates_ingested"] == ["2026-11-16"]
            mock_upload.assert_called_once()
            final_df = pd.read_parquet(pq_path)
            assert "2026-11-16" in final_df["trade_date"].values


def test_series_move_rekeys_without_calling_angel():
    """Item 7a: EQ<->BE series move re-keys stored history with 0 Angel calls."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # Old EQ token 28859 has 3 dates stored
        init_df = pd.DataFrame([
            {"token": 28859, "symbol": "PROZONER", "trade_date": f"2026-11-{d:02d}", "open": 50.0, "high": 52.0, "low": 48.0, "close": 50.0, "volume": 1000, "traded_val": 50000.0}
            for d in [13, 16, 17]
        ])
        init_df.to_parquet(pq_path, index=False)

        # Today Bhavcopy has new BE token 28863 with same ISIN INE195N01013
        bhav_rows = [
            {
                "token": 28863,
                "symbol": "PROZONER",
                "ISIN": "INE195N01013",
                "series": "BE",
                "prev_close": 50.0,
                "open": 50.0,
                "high": 51.0,
                "low": 49.0,
                "close": 50.5,
                "volume": 2000
            }
        ]
        zb = make_synthetic_bhavcopy_zip(bhav_rows, target_date_str="2026-11-18")

        mock_client = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        # Instruments table has token 28859 and 28863 under ISIN INE195N01013
        mock_cur.fetchall.side_effect = [
            [(28863, "INE195N01013")],  # active
            [(28859, "INE195N01013")],  # inactive
        ]

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(zb, {"status_code": 200, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.SmartAPIClient.login_from_env", return_value=mock_client), \
             patch("pipeline.bhavcopy.log_ingest_run"), \
             patch("pipeline.db.get_connection", return_value=mock_conn):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
            assert res["status"] == "success"
            # ZERO Angel calls for series move
            mock_client.get_candle_data.assert_not_called()

            updated_df = pd.read_parquet(pq_path)
            # Old token 28859 must be completely gone, re-keyed to 28863
            assert 28859 not in updated_df["token"].values
            assert set(updated_df["token"].unique()) == {28863}
            # All 4 dates present (3 historical + today)
            assert len(updated_df) == 4
            assert "2026-11-18" in updated_df["trade_date"].values


def test_corporate_action_identical_older_history_writes_no_adjustment():
    """Item 7e: Prev-close mismatch with identical older history writes no price_adjustments row."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # 10 sessions stored at close=100.0
        dates = [f"2026-11-{d:02d}" for d in range(1, 11)]
        records = [
            {"token": 100, "symbol": "REFSYM", "trade_date": d, "open": 100.0, "high": 102.0, "low": 98.0, "close": 100.0, "volume": 1000, "traded_val": 100000.0}
            for d in dates
        ]
        pd.DataFrame(records).to_parquet(pq_path, index=False)

        # Today bhavcopy has prev_close=90.0 (|90 - 100|/100 = 10% mismatch)
        bhav_rows = [
            {"token": 100, "symbol": "REFSYM", "prev_close": 90.0, "open": 91.0, "high": 92.0, "low": 89.0, "close": 90.5, "volume": 500}
        ]
        zb = make_synthetic_bhavcopy_zip(bhav_rows, target_date_str="2026-11-11")

        mock_client = MagicMock()
        # Angel returns identical older history (close=100.0 on dates 1-5)
        mock_candles = [
            [f"{d}T00:00:00+05:30", 100.0, 102.0, 98.0, 100.0, 1000]
            for d in dates
        ]
        mock_client.get_candle_data.return_value = mock_candles

        with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 11)), \
             patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(zb, {"status_code": 200, "host": "nsearchives"})), \
             patch("pipeline.bhavcopy.SmartAPIClient.login_from_env", return_value=mock_client), \
             patch("pipeline.bhavcopy.log_price_adjustments") as mock_log_adj, \
             patch("pipeline.bhavcopy.log_ingest_run"):

            res = ingest_bhavcopy(parquet_path=pq_path, min_rows=1, sleep_fn=MagicMock())
            assert res["status"] == "success"
            # Older history is identical (<0.1% diff), so NO price_adjustments row written
            mock_log_adj.assert_not_called()


def test_quality_gate_fails_on_duplicate_tokens_same_date():
    """Item 7d: Quality gate fails if a symbol has rows under two tokens on the same date."""
    from pipeline.quality_gate import verify_quality_gate, QualityGateError
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        # Same symbol PROZONER under token 1 and token 2 on same date
        df = pd.DataFrame([
            {"token": 1, "symbol": "PROZONER", "trade_date": "2026-11-18", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
            {"token": 2, "symbol": "PROZONER", "trade_date": "2026-11-18", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
        ])
        df.to_parquet(pq_path, index=False)

        with pytest.raises(QualityGateError, match="duplicate tokens"):
            verify_quality_gate(parquet_path=pq_path, tokens_limit=2)


def test_dedupe_keeps_preferred_token():
    """Item 7b: dedupe_equity_parquet merges duplicates and keeps winning token."""
    from pipeline.dedupe import dedupe_equity_parquet
    with tempfile.TemporaryDirectory() as tmpdir:
        pq_path = os.path.join(tmpdir, "test.parquet")
        df = pd.DataFrame([
            # Older token 10 has dates 13, 16
            {"token": 10, "symbol": "DUPESYM", "trade_date": "2026-11-13", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
            {"token": 10, "symbol": "DUPESYM", "trade_date": "2026-11-16", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
            # Newer token 20 has dates 16, 17
            {"token": 20, "symbol": "DUPESYM", "trade_date": "2026-11-16", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
            {"token": 20, "symbol": "DUPESYM", "trade_date": "2026-11-17", "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.0, "volume": 100, "traded_val": 1000.0},
        ])
        df.to_parquet(pq_path, index=False)

        res = dedupe_equity_parquet(parquet_path=pq_path)
        assert res["status"] == "success"
        assert res["before_tokens"] == 2
        assert res["after_tokens"] == 1

        clean_df = pd.read_parquet(pq_path)
        assert set(clean_df["token"].unique()) == {20}
        # Dates 13, 16, 17 all preserved without duplication
        assert sorted(clean_df["trade_date"].tolist()) == ["2026-11-13", "2026-11-16", "2026-11-17"]
        # .backup file created
        assert os.path.exists(f"{pq_path}.backup")


def test_smartapi_adaptive_rate_recovery():
    """Item 5: Adaptive rate cuts once per throttled token and recovers +10% per 25 clean calls."""
    from pipeline.smartapi_client import SmartAPIClient, SmartAPIThrottledError
    client = SmartAPIClient()
    client.set_rate(1.0)

    # 1. on_throttle cuts rate by 25%
    client.on_throttle()
    assert client.current_req_per_sec == pytest.approx(0.75, rel=1e-2)

    # 2. 24 clean calls: rate does not recover yet
    for _ in range(24):
        client.on_clean_call()
    assert client.current_req_per_sec == pytest.approx(0.75, rel=1e-2)

    # 3. 25th clean call: recovers +10% (0.75 * 1.10 = 0.825)
    client.on_clean_call()
    assert client.current_req_per_sec == pytest.approx(0.825, rel=1e-2)


def test_verify_bhavcopy_command_with_list_candles():
    """Verify verify_bhavcopy_command handles SmartAPI raw list candle format without TypeError."""
    from pipeline.bhavcopy import verify_bhavcopy_command

    rows = [
        {"token": i, "symbol": f"S{i}", "open": 100.0, "high": 105.0, "low": 98.0, "close": 100.0, "volume": 1000}
        for i in range(1, 35)
    ]
    zb = make_synthetic_bhavcopy_zip(rows, target_date_str="2026-11-18")

    mock_client = MagicMock()
    # SmartAPI returns list of lists: [time, open, high, low, close, volume]
    mock_client.get_candle_data.return_value = [
        ["2026-11-18T00:00:00+05:30", 100.0, 105.0, 98.0, 100.0, 1000]
    ]

    with patch("pipeline.bhavcopy.get_ist_today", return_value=date(2026, 11, 18)), \
         patch("pipeline.bhavcopy.download_bhavcopy_raw", return_value=(zb, {
             "status_code": 200, "host": "nsearchives", "bytes": len(zb), "last_modified": "Wed, 18 Nov 2026 11:00:00 GMT"
         })), \
         patch("pipeline.bhavcopy.SmartAPIClient.login_from_env", return_value=mock_client), \
         patch("pipeline.bhavcopy.parse_and_validate_bhavcopy") as mock_parse:

        sample_df = pd.DataFrame([
            {"token": i, "symbol": f"S{i}", "open": 100.0, "high": 105.0, "low": 98.0, "close": 100.0, "volume": 1000, "traded_val": 100000.0, "prev_close": 100.0}
            for i in range(1, 35)
        ])
        mock_parse.return_value = sample_df

        code = verify_bhavcopy_command(parquet_path="/nonexistent.parquet")
        assert code == 0

