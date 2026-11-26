"""Tests for DB-backed NSE 4-level classification management, import, sync, and overrides."""

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from pipeline.classification import (
    DAILY_SYNC_MAX_REQUESTS,
    DELIST_CONSECUTIVE_RUNS,
    OFFICIAL_NSE_MACROS,
    import_classification_file,
    mark_classification_delisted,
    normalize_company_name,
    normalize_label,
    set_classification_override,
    sync_classification,
)
from pipeline.classification_fetch import (
    EquityMasterEntry,
    PoliteNseQuoteClient,
    decode_equity_master_csv,
)


def test_normalize_label_and_company_name():
    assert normalize_label("Port & Port services") == "Port & Port Services"
    assert normalize_label("IT - Software") == "IT - Software"
    assert normalize_label("FINANCIAL SERVICES") == "Financial Services"
    assert normalize_label("Power \ufffd Distribution") == "Power - Distribution"
    assert normalize_company_name("ANDHRA PAPER LIMITED") == "Andhra Paper Limited"
    assert normalize_company_name("GMR POWER AND URBAN INFRA LIMITED") == "GMR Power and Urban Infra Limited"


def test_decode_equity_master_csv():
    sample = (
        "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\n"
        "RELIANCE,Reliance Industries Limited, EQ, 29-NOV-1995, 10, 1, INE002A01018, 10\n"
    )
    parsed = decode_equity_master_csv(sample)
    assert "RELIANCE" in parsed
    assert parsed["RELIANCE"].isin == "INE002A01018"
    with pytest.raises(ValueError):
        decode_equity_master_csv("BAD_COL\n1\n")


def test_import_classification_file_isin_first_and_dry_run():
    assert DAILY_SYNC_MAX_REQUESTS == 20
    assert DELIST_CONSECUTIVE_RUNS == 5
    assert "Financial Services" in OFFICIAL_NSE_MACROS

    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as tf:
        tf.write("symbol,company,series,isin,macro,sector,industry,basicIndustry\n")
        tf.write("FOO,Foo Ltd,EQ,INE0001,Energy,Oil Gas & Consumable Fuels,Oil,Refineries\n")
        tf.write("BAR,Bar Ltd,EQ,INE0001,Healthcare,Healthcare,Pharma,Pharmaceuticals\n")  # dup ISIN
        tf.write("NOISIN,No Isin Ltd,EQ,,Energy,Oil,Oil,Oil\n")  # missing ISIN
        tf.write("HDFC_OLD,HDFC Bank Ltd,EQ,INE040A01034,Financial Services,Financial Services,Banks,Private Sector Bank\n")
        path = tf.name

    try:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        # _load_db_overrides -> [], instruments query -> HDFCBANK with INE040A01034
        mock_cur.fetchall.side_effect = [
            [],
            [(1, "HDFCBANK", "INE040A01034", None, None, None, None, None, None)],
        ]
        res = import_classification_file(file_path=path, dry_run=True, conn=mock_conn)
        assert res["dry_run"] is True
        assert res["rows_read"] == 4
        assert res["matched"] == 1
        assert res["updated"] == 1
        assert res["skipped_reasons"]["missing_identity"] == 1
        assert res["skipped_reasons"]["duplicate_isin_conflict"] == 1
        mock_conn.commit.assert_not_called()
    finally:
        os.remove(path)


def test_sync_all_classified_makes_zero_api_calls():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.side_effect = [
        [],  # _load_db_overrides
        [],  # _load_db_symbol_changes
        [
            (1, "HDFCBANK", "INE040A01034", "EQ", "Financial Services", "Financial Services", "Banks", "Private Sector Bank", "import", "mapped", None, 0, 0),
            (2, "TCS", "INE467B01029", "EQ", "Information Technology", "Information Technology", "IT - Software", "Computers - Software & Consulting", "import", "mapped", None, 0, 0),
        ],
    ]
    mock_client = MagicMock(spec=PoliteNseQuoteClient)
    mock_client.requests_sent = 0

    with patch("pipeline.classification.execute_values"):
        res = sync_classification(conn=mock_conn, fetch_equity=False, client=mock_client)
    assert res["already_mapped"] == 2
    assert res["queued_total"] == 0
    assert res["requests_sent"] == 0
    mock_client.lookup_symbol.assert_not_called()


def test_sync_caps_at_20_and_stops_on_block():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    unmapped_rows = [
        (100 + i, f"NEWIPO{i}", f"INE999A01{i:03d}", "EQ", None, None, None, None, None, "unmapped", None, 0, 0)
        for i in range(25)
    ]
    mock_cur.fetchall.side_effect = [
        [],  # _load_db_overrides
        [],  # _load_db_symbol_changes
        unmapped_rows,
    ]
    mock_client = MagicMock(spec=PoliteNseQuoteClient)
    mock_client.lookup_symbol.side_effect = [
        ("ok", {"macro": "Industrials", "sector": "Capital Goods", "industry": "Industrial Products", "basic_industry": "Bearings"}),
        ("blocked", None),
    ]
    mock_client.requests_sent = 3

    with patch("pipeline.classification.execute_values"):
        res = sync_classification(conn=mock_conn, fetch_equity=False, client=mock_client)
    assert res["queued_capped"] == DAILY_SYNC_MAX_REQUESTS
    assert res["api_updated"] == 1
    assert res["blocked"] is True
    assert mock_client.lookup_symbol.call_count == 2


def test_sync_five_run_delist_reactivation_and_isin_rename():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    # Instrument 1: miss_streak=4 and still absent from EQUITY_L -> hits 5 -> delisted
    # Instrument 2: was delisted, reappears in EQUITY_L -> reactivated
    # Instrument 3: mapped, present in EQUITY_L
    # Instrument 4: ISIN rename target
    mock_cur.fetchall.side_effect = [
        [],  # _load_db_overrides
        [("OLDNAME", "NEWNAME", "INE000A01004")],  # _load_db_symbol_changes
        [
            (1, "GHOST", "INE000A01001", "EQ", "Energy", "Energy", "Oil", "Oil", "import", "mapped", None, 0, 4),
            (2, "COMEBACK", "INE000A01002", "EQ", "Energy", "Energy", "Oil", "Oil", "import", "delisted", None, 0, 5),
            (3, "STEADY", "INE000A01003", "EQ", "Energy", "Energy", "Oil", "Oil", "import", "mapped", None, 0, 0),
            (4, "NEWNAME", "INE000A01004", "EQ", None, None, None, None, None, "unmapped", None, 0, 0),
            (5, "OLDNAME", "INE000A01004", "EQ", "Industrials", "Capital Goods", "Industrial Products", "Bearings", "import", "mapped", None, 0, 0),
        ],
    ]
    eq_map = {
        "COMEBACK": EquityMasterEntry("COMEBACK", "Comeback Ltd", "EQ", "INE000A01002"),
        "STEADY": EquityMasterEntry("STEADY", "Steady Ltd", "EQ", "INE000A01003"),
        "NEWNAME": EquityMasterEntry("NEWNAME", "Newname Ltd", "EQ", "INE000A01004"),
        "EXTRA1": EquityMasterEntry("EXTRA1", "Extra1 Ltd", "EQ", "INE000A01005"),
    }
    mock_client = MagicMock(spec=PoliteNseQuoteClient)
    mock_client.requests_sent = 0

    with patch("pipeline.classification.download_equity_master", return_value=eq_map), \
         patch("pipeline.classification.execute_values"):
        res = sync_classification(conn=mock_conn, fetch_equity=True, client=mock_client)

    assert res["delisted"] == 1
    assert res["reactivated"] == 1
    assert res["override_or_rename_updated"] >= 1


def test_manual_override_and_delist_audit():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.return_value = [(1, "OldMacro", "OldSector", "OldInd", "OldBasic")]

    with patch("pipeline.classification.execute_values") as mock_ev:
        res = set_classification_override(
            "TESTSYM", "Energy", "Oil Gas & Consumable Fuels", "Oil", "Oil", note="manual fix", conn=mock_conn
        )
    assert res["symbol"] == "TESTSYM"
    assert res["updated_tokens"] == 1
    assert mock_ev.called  # _record_audit called

    mock_cur.fetchall.return_value = [(1, "mapped")]
    with patch("pipeline.classification.execute_values") as mock_ev2:
        res2 = mark_classification_delisted("TESTSYM", reason="merged", conn=mock_conn)
    assert res2["delisted_tokens"] == 1
    assert mock_ev2.called
