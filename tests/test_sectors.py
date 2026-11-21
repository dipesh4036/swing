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


class TestSectorBreadthMath(unittest.TestCase):
    def test_sector_breadth_calculation_synthetic(self):
        """
        Synthetic 10-stock sector with known signals -> exact percentages and counts.
        """
        from pipeline.sectors import compute_sector_metrics

        date_str = "2026-11-20"
        rows = []
        for i in range(10):
            sym = f"BANK_{i}"
            rows.append({
                "symbol": sym,
                "token": str(2000 + i),
                "trade_date": date_str,
                "close": 100.0 + i,
                "prev_close": 98.0 if i < 8 else 102.0,
                "ret_1d": 0.02 if i < 8 else -0.02,
                "volume": 60000,
                "vol_sma_50": 50000,
                "above_50sma": 1 if i < 7 else 0, # 7 out of 10 = 70.0%
                "has_valid_50sma": 1,
                "above_200sma": 1 if i < 6 else 0, # 6 out of 10 = 60.0%
                "has_valid_200sma": 1,
                "above_20ema": 1 if i < 8 else 0, # 8 out of 10 = 80.0%
                "has_valid_20ema": 1,
                "advance": 1 if i < 8 else 0, # 8 advances
                "decline": 1 if i >= 8 else 0, # 2 declines
                "is_high_52w": 1 if i == 0 else 0,
                "is_low_52w": 0,
            })

        df_ind = pd.DataFrame(rows)

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        # Mock stock_sector mappings
        mock_cursor.fetchall.return_value = [(f"BANK_{i}", "bank") for i in range(10)]

        # Mock execute_batch to capture inserted records
        captured = []
        with patch("pipeline.sectors.execute_batch", side_effect=lambda cur, sql, records, page_size=1000: captured.extend(records)):
            res = compute_sector_metrics(df_ind, conn=mock_conn)

        self.assertEqual(res["status"], "success")
        self.assertEqual(len(captured), 1)
        r = captured[0]
        # (trade_date, sector, n_stocks, n_valid, pct_above_50dma, pct_above_200dma, pct_above_20ema, advances, declines, ...)
        self.assertEqual(r[0], date_str)
        self.assertEqual(r[1], "bank")
        self.assertEqual(r[2], 10) # n_stocks
        self.assertEqual(r[3], 10) # n_valid
        self.assertEqual(r[4], 70.0) # pct_above_50dma
        self.assertEqual(r[5], 60.0) # pct_above_200dma
        self.assertEqual(r[6], 80.0) # pct_above_20ema
        self.assertEqual(r[7], 8) # advances
        self.assertEqual(r[8], 2) # declines
        self.assertEqual(r[14], "official") # price_source

    def test_insufficient_stocks_null_percentages(self):
        """
        When n_valid < MIN_SECTOR_STOCKS (8), percentage metrics must be NULL (None),
        while counts (advances, declines) remain recorded.
        """
        from pipeline.sectors import compute_sector_metrics

        date_str = "2026-11-20"
        rows = []
        for i in range(4): # 4 stocks < 8
            sym = f"HLTH_{i}"
            rows.append({
                "symbol": sym,
                "token": str(3000 + i),
                "trade_date": date_str,
                "close": 200.0 + i,
                "prev_close": 195.0,
                "ret_1d": 0.025,
                "volume": 40000,
                "vol_sma_50": 35000,
                "above_50sma": 1,
                "has_valid_50sma": 1,
                "above_200sma": 1,
                "has_valid_200sma": 1,
                "above_20ema": 1,
                "has_valid_20ema": 1,
                "advance": 1,
                "decline": 0,
                "is_high_52w": 0,
                "is_low_52w": 0,
            })

        df_ind = pd.DataFrame(rows)

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [(f"HLTH_{i}", "healthcare") for i in range(4)]

        captured = []
        with patch("pipeline.sectors.execute_batch", side_effect=lambda cur, sql, records, page_size=1000: captured.extend(records)):
            res = compute_sector_metrics(df_ind, conn=mock_conn)

        self.assertEqual(res["status"], "success")
        self.assertTrue(len(captured) >= 1)
        r = [rec for rec in captured if rec[1] == "healthcare"][0]
        self.assertEqual(r[2], 4) # n_stocks
        self.assertEqual(r[3], 4) # n_valid (< 8)
        self.assertIsNone(r[4]) # pct_above_50dma MUST be None
        self.assertIsNone(r[5]) # pct_above_200dma MUST be None
        self.assertIsNone(r[6]) # pct_above_20ema MUST be None
        self.assertIsNone(r[11]) # ret_1w_ew MUST be None
        self.assertIsNone(r[12]) # ret_1m_ew MUST be None
        self.assertIsNone(r[13]) # ret_3m_ew MUST be None
        self.assertEqual(r[7], 4) # advances still recorded
        self.assertEqual(r[8], 0) # declines still recorded
        self.assertEqual(r[14], "equal_weight") # price_source

    def test_regression_breadth_for_universe_identical(self):
        """
        Regression safety test:
        Asserts that compute_breadth_for_universe output is 100% byte-for-byte identical
        and unaffected by sector metrics compute.
        """
        from pipeline.compute import compute_breadth_for_universe, compute_stock_indicators
        from pipeline.sectors import compute_sector_metrics

        dates = [f"2026-01-{i:02d}" for i in range(1, 15)]
        rows = []
        for sym_idx in range(5):
            for i, d in enumerate(dates):
                c = 100 + sym_idx * 10 + i * 2
                rows.append({
                    "token": str(100 + sym_idx),
                    "symbol": f"STOCK_{sym_idx}",
                    "trade_date": d,
                    "open": float(c - 1),
                    "high": float(c + 2),
                    "low": float(c - 2),
                    "close": float(c),
                    "volume": 50000,
                })

        df_raw = pd.DataFrame(rows)
        df_ind = compute_stock_indicators(df_raw)

        # 1. Breadth run before sector compute
        breadth_before = compute_breadth_for_universe(df_ind, "all")

        # 2. Sector metrics compute on a mock connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [(f"STOCK_{i}", "bank") for i in range(5)]
        with patch("pipeline.sectors.execute_batch"):
            compute_sector_metrics(df_ind, conn=mock_conn)

        # 3. Breadth run after sector compute
        breadth_after = compute_breadth_for_universe(df_ind, "all")

        self.assertEqual(len(breadth_before), len(breadth_after))
        for rec_b, rec_a in zip(breadth_before, breadth_after):
            self.assertEqual(rec_b, rec_a, "Every breadth row must be 100% identical")


if __name__ == "__main__":
    unittest.main()
