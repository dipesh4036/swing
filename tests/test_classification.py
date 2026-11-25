"""Tests for NSE 4-level classification normalization, validation, bootstrap, and incremental sync."""

import tempfile
import os
from unittest.mock import MagicMock, patch

import pytest

from pipeline.classification import (
    CURRENT_MACROS,
    bootstrap_classification,
    load_overrides,
    load_seed_records,
    match_instrument_to_seed,
    standard_company,
    standard_name,
    sync_classification,
)
from pipeline.classification_fetch import NseQuoteClassifier, parse_equity_list_csv


def test_standard_name_and_company():
    assert standard_name("Port & Port services") == "Port & Port Services"
    assert standard_name("IT - Software") == "IT - Software"
    assert standard_name("FINANCIAL SERVICES") == "Financial Services"
    assert standard_name("Power \ufffd Distribution") == "Power - Distribution"
    assert standard_company("ANDHRA PAPER LIMITED") == "Andhra Paper Limited"
    assert standard_company("GMR POWER AND URBAN INFRA LIMITED") == "GMR Power and Urban Infra Limited"


def test_seed_csv_loads_valid_records():
    records, conflicts = load_seed_records()
    assert len(records) > 2500
    assert all(r.macro in CURRENT_MACROS for r in records)
    overrides = load_overrides()
    assert "IPRINGLTD" in overrides
    by_sym = {r.symbol: r for r in records}
    assert by_sym["IPRINGLTD"].source == "override"
    assert by_sym["HDFCBANK"].basic_industry == "Private Sector Bank"


def test_duplicate_and_conflicting_identity_rejected():
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as tf:
        tf.write("symbol,company,series,isin,macro,sector,industry,basicIndustry\n")
        tf.write("FOO,Foo Ltd,EQ,INE0001,Energy,Oil Gas & Consumable Fuels,Oil,Refineries\n")
        tf.write("BAR,Bar Ltd,EQ,INE0001,Healthcare,Healthcare,Pharma,Pharmaceuticals\n")
        tf.write("NOISIN,No Isin Ltd,EQ,,Energy,Oil,Oil,Oil\n")
        path = tf.name
    try:
        recs, conflicts = load_seed_records(master_path=path)
        assert len(recs) == 1
        assert recs[0].symbol == "FOO"
        assert len(conflicts) == 2
    finally:
        os.remove(path)


def test_isin_first_matching_prevents_conflation():
    records, _ = load_seed_records()
    by_isin = {r.isin: r for r in records}
    by_sym = {r.symbol: r for r in records}
    # Match by ISIN even if symbol was renamed
    hdfc = by_sym["HDFCBANK"]
    matched = match_instrument_to_seed("HDFC_RENAMED", hdfc.isin, by_isin, by_sym)
    assert matched is not None
    assert matched.symbol == "HDFCBANK"
    # Conflicting ISIN must not match by symbol alone
    conflict = match_instrument_to_seed("HDFCBANK", "INE999999999", by_isin, by_sym)
    assert conflict is None


def test_parse_equity_list_csv():
    sample = "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE\nRELIANCE,Reliance Industries Limited, EQ, 29-NOV-1995, 10, 1, INE002A01018, 10\n"
    parsed = parse_equity_list_csv(sample)
    assert "RELIANCE" in parsed
    assert parsed["RELIANCE"].isin == "INE002A01018"
    with pytest.raises(ValueError):
        parse_equity_list_csv("BAD_COL\n1\n")


def test_sync_all_classified_makes_zero_api_calls():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.return_value = [
        (1, "HDFCBANK", "INE040A01034", "EQ", "Financial Services", "Financial Services", "Banks", "Private Sector Bank", "seed", "mapped", None, 0),
        (2, "TCS", "INE467B01029", "EQ", "Information Technology", "Information Technology", "IT - Software", "Computers - Software & Consulting", "seed", "mapped", None, 0),
    ]
    mock_classifier = MagicMock(spec=NseQuoteClassifier)
    mock_classifier.requests_made = 0
    mock_classifier.retries_made = 0

    with patch("pipeline.classification.execute_values"):
        res = sync_classification(conn=mock_conn, fetch_equity=False, classifier=mock_classifier)
    assert res["already_mapped"] == 2
    assert res["queued"] == 0
    assert res["requests_made"] == 0
    mock_classifier.fetch_classification.assert_not_called()


def test_sync_queues_only_missing_and_preserves_on_block():
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    mock_cur.fetchall.return_value = [
        (1, "HDFCBANK", "INE040A01034", "EQ", "Financial Services", "Financial Services", "Banks", "Private Sector Bank", "seed", "mapped", None, 0),
        (99, "NEWIPO1", "INE999A01001", "EQ", None, None, None, None, None, "unmapped", None, 0),
        (100, "NEWIPO2", "INE999A01002", "EQ", None, None, None, None, None, "unmapped", None, 0),
    ]
    mock_classifier = MagicMock(spec=NseQuoteClassifier)
    mock_classifier.fetch_classification.side_effect = [
        ("ok", {"macro": "Industrials", "sector": "Capital Goods", "industry": "Industrial Products", "basic_industry": "Bearings"}),
        ("blocked", None),
    ]
    mock_classifier.requests_made = 3
    mock_classifier.retries_made = 0

    with patch("pipeline.classification.execute_values"):
        res = sync_classification(conn=mock_conn, fetch_equity=False, classifier=mock_classifier)
    assert res["queued"] == 2
    assert res["api_updated"] == 1
    assert res["blocked"] is True
    assert mock_classifier.fetch_classification.call_count == 2
