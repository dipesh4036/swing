"""
tests/test_sectors.py

Tests for Tab 3: Sector Rotation.
Covers P1 priority assignment, ISIN-first matching, missing-CSV fallback,
breadth calculations, and regression safety.
"""

import unittest
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from pipeline.sectors import (
    SECTORS,
    MIN_SECTOR_STOCKS,
    assign_stock_sectors,
    sync_stock_sectors,
)


class TestSectorMapping(unittest.TestCase):
    def setUp(self):
        # Sample instruments master
        self.isin_to_symbol = {
            "INE001A01010": "HDFCBANK",
            "INE002A01010": "ICICIBANK",
            "INE003A01010": "BAJFINANCE",
            "INE004A01010": "INFY",
            "INE005A01010": "SUNPHARMA",
            "INE006A01010": "APOLLOHOSP",
        }
        self.known_symbols = set(self.isin_to_symbol.values())

    def test_priority_assignment_bank_and_finserv(self):
        """
        Stock in Bank + FinServ -> Assigned to Bank (priority rule).
        Non-bank FinServ stock -> Assigned to Financial Services.
        """
        # Bank CSV contains HDFCBANK, ICICIBANK
        df_bank = pd.DataFrame([
            {"Symbol": "HDFCBANK", "ISIN Code": "INE001A01010"},
            {"Symbol": "ICICIBANK", "ISIN Code": "INE002A01010"},
        ])
        # FinServ CSV contains HDFCBANK, ICICIBANK, and BAJFINANCE
        df_finserv = pd.DataFrame([
            {"Symbol": "HDFCBANK", "ISIN Code": "INE001A01010"},
            {"Symbol": "ICICIBANK", "ISIN Code": "INE002A01010"},
            {"Symbol": "BAJFINANCE", "ISIN Code": "INE003A01010"},
        ])

        tables = {
            "bank": df_bank,
            "financial_services": df_finserv,
        }

        assigned, stats = assign_stock_sectors(
            tables,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        # HDFCBANK must be assigned to Bank, NOT financial_services
        self.assertEqual(assigned["HDFCBANK"]["sector"], "bank")
        self.assertEqual(assigned["ICICIBANK"]["sector"], "bank")
        # BAJFINANCE only in finserv -> financial_services
        self.assertEqual(assigned["BAJFINANCE"]["sector"], "financial_services")

        self.assertEqual(stats["bank"], 2)
        self.assertEqual(stats["financial_services"], 1)

    def test_isin_first_matching(self):
        """
        ISIN-first matching resolves symbol even if constituent CSV symbol has changed or differs.
        """
        # In constituent CSV, symbol is OLD_HDFC, but ISIN is INE001A01010 (which maps to HDFCBANK)
        df_bank = pd.DataFrame([
            {"Symbol": "OLD_HDFC", "ISIN Code": "INE001A01010"},
        ])

        tables = {"bank": df_bank}

        assigned, stats = assign_stock_sectors(
            tables,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        self.assertIn("HDFCBANK", assigned)
        self.assertEqual(assigned["HDFCBANK"]["sector"], "bank")
        self.assertEqual(assigned["HDFCBANK"]["isin"], "INE001A01010")

    def test_missing_csv_fallback_keeps_stored_mapping(self):
        """
        If constituent CSV downloads fail, sync_stock_sectors falls back to stored stock_sector mapping.
        """
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        # Mock SELECT COUNT(*) FROM stock_sector returning 157
        mock_cursor.fetchone.return_value = (157,)

        # Mock requests.get raising connection error
        with patch("pipeline.sectors.requests.get", side_effect=Exception("Network error")):
            res = sync_stock_sectors(conn=mock_conn)

        self.assertEqual(res["status"], "partial")
        self.assertTrue(res["degraded"])
        self.assertTrue(res.get("stored_fallback"))
        self.assertEqual(res["total_assigned"], 157)


if __name__ == "__main__":
    unittest.main()
