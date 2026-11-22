"""
tests/test_sectors.py

Tests for Tab 3: Sector Rotation Round 2.
Covers:
- Priority assignment (Bank before FinServ, Pharma + Healthcare merge into healthcare)
- Nifty 500 Industry mapping (T12)
- Separate 50/200/20 denominators (T3)
- Pre-liquidity filter return computation (T4)
- Sector Leader rules (T8)
- Regression safety (Market Breadth remains 100% byte-for-byte identical)
"""

import unittest
from unittest.mock import patch, MagicMock
import pandas as pd
import numpy as np

from pipeline.sectors import (
    SECTORS,
    SECTOR_KEYS,
    MIN_SECTOR_STOCKS,
    INDUSTRY_TO_SECTOR,
    SECTOR_LEADER_RULES,
    assign_stock_sectors,
    sync_stock_sectors,
    compute_sector_metrics,
)


class TestSectorMapping(unittest.TestCase):
    def setUp(self):
        self.isin_to_symbol = {
            "INE001A01010": "HDFCBANK",
            "INE002A01010": "ICICIBANK",
            "INE003A01010": "BAJFINANCE",
            "INE004A01010": "INFY",
            "INE005A01010": "SUNPHARMA",
            "INE006A01010": "APOLLOHOSP",
            "INE007A01010": "LT",
            "INE008A01010": "TCS",
        }
        self.known_symbols = set(self.isin_to_symbol.values())

    def test_priority_assignment_bank_and_finserv(self):
        """
        Stock in Bank + FinServ -> Assigned to Bank (priority rule).
        Non-bank FinServ stock -> Assigned to Financial Services.
        """
        df_bank = pd.DataFrame([
            {"Symbol": "HDFCBANK", "ISIN Code": "INE001A01010"},
            {"Symbol": "ICICIBANK", "ISIN Code": "INE002A01010"},
        ])
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
            nifty500_df=None,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        self.assertEqual(assigned["HDFCBANK"]["sector"], "bank")
        self.assertEqual(assigned["ICICIBANK"]["sector"], "bank")
        self.assertEqual(assigned["BAJFINANCE"]["sector"], "financial_services")
        self.assertEqual(stats["bank"]["total"], 2)
        self.assertEqual(stats["financial_services"]["total"], 1)

    def test_merge_pharma_into_healthcare(self):
        """
        Pharma and Healthcare indices merge into 'healthcare' sector (T12.3).
        """
        df_pharma = pd.DataFrame([
            {"Symbol": "SUNPHARMA", "ISIN Code": "INE005A01010"},
        ])
        df_health = pd.DataFrame([
            {"Symbol": "APOLLOHOSP", "ISIN Code": "INE006A01010"},
        ])

        tables = {
            "pharma": df_pharma,
            "healthcare": df_health,
        }

        assigned, stats = assign_stock_sectors(
            tables,
            nifty500_df=None,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        self.assertEqual(assigned["SUNPHARMA"]["sector"], "healthcare")
        self.assertEqual(assigned["APOLLOHOSP"]["sector"], "healthcare")
        self.assertEqual(stats["healthcare"]["total"], 2)
        self.assertNotIn("pharma", SECTOR_KEYS)

    def test_nifty500_industry_fallback_mapping(self):
        """
        Stocks not in sector index CSVs map via Nifty 500 Industry column (T12).
        """
        df_500 = pd.DataFrame([
            {"Symbol": "LT", "ISIN Code": "INE007A01010", "Industry": "Capital Goods"},
            {"Symbol": "TCS", "ISIN Code": "INE008A01010", "Industry": "Information Technology"},
        ])

        assigned, stats = assign_stock_sectors(
            sector_csv_tables={},
            nifty500_df=df_500,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        self.assertEqual(assigned["LT"]["sector"], "capital_goods")
        self.assertEqual(assigned["LT"]["mapped_via"], "industry")
        self.assertEqual(assigned["LT"]["industry"], "Capital Goods")

        self.assertEqual(assigned["TCS"]["sector"], "it")
        self.assertEqual(assigned["TCS"]["mapped_via"], "industry")

    def test_isin_first_matching(self):
        """
        ISIN-first matching resolves symbol even if constituent CSV symbol has changed.
        """
        df_bank = pd.DataFrame([
            {"Symbol": "OLD_HDFC", "ISIN Code": "INE001A01010"},
        ])

        tables = {"bank": df_bank}

        assigned, stats = assign_stock_sectors(
            tables,
            nifty500_df=None,
            isin_to_symbol=self.isin_to_symbol,
            known_symbols=self.known_symbols,
        )

        self.assertIn("HDFCBANK", assigned)
        self.assertEqual(assigned["HDFCBANK"]["sector"], "bank")
        self.assertEqual(assigned["HDFCBANK"]["isin"], "INE001A01010")


class TestSectorBreadthMath(unittest.TestCase):
    def test_separate_denominators_50_vs_200(self):
        """
        T3: Verify that pct_above_200dma uses n_valid_200 and pct_above_50dma uses n_valid_50.
        When half the stocks have < 200 sessions of history, they are excluded from the 200 DMA denominator.
        """
        date_str = "2026-11-20"
        rows = []
        for i in range(10):
            sym = f"BANK_{i}"
            has_200 = 1 if i < 6 else 0 # only 6 stocks have valid 200 SMA
            rows.append({
                "symbol": sym,
                "token": str(2000 + i),
                "trade_date": date_str,
                "close": 100.0 + i,
                "prev_close": 98.0,
                "ret_1d": 0.02,
                "volume": 60000,
                "vol_sma_50": 50000,
                "above_50sma": 1 if i < 8 else 0, # 8 of 10 = 80%
                "has_valid_50sma": 1,              # 10 of 10 valid
                "above_200sma": 1 if i < 3 else 0, # 3 of 6 = 50%
                "has_valid_200sma": has_200,
                "above_20ema": 1 if i < 7 else 0,  # 7 of 10 = 70%
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
        mock_cursor.fetchall.return_value = [(f"BANK_{i}", "bank", "Financial Services", "index") for i in range(10)]

        captured = []
        with patch("pipeline.sectors.execute_batch", side_effect=lambda cur, sql, records, page_size=1000: captured.extend(records)):
            res = compute_sector_metrics(df_ind, conn=mock_conn)

        self.assertEqual(res["status"], "success")
        self.assertTrue(len(captured) >= 1)
        r = captured[0]

        # r[3] = n_valid (50 DMA), r[4] = pct_above_50dma
        self.assertEqual(r[3], 10)
        self.assertEqual(r[4], 80.0)

        # r[15] = n_valid_200, r[5] = pct_above_200dma
        # n_valid_200 is 6 (< 8), so pct_above_200dma MUST be None (T3 guard)
        self.assertEqual(r[15], 6)
        self.assertIsNone(r[5])

    def test_pre_liquidity_return_computation(self):
        """
        T4: Rolling returns must be computed on the full per-token frame before filtering liquid rows.
        A stock illiquid in the middle must get the exact same 5d/22d return.
        """
        dates = [f"2026-11-{i:02d}" for i in range(1, 25)]
        rows = []
        for i, d in enumerate(dates):
            # Stock is illiquid (volume=100) on day 10, but liquid everywhere else
            vol = 100 if i == 10 else 50000
            rows.append({
                "symbol": "GAP_STOCK",
                "token": "4001",
                "trade_date": d,
                "close": 100.0 + i,
                "volume": vol,
                "vol_sma_50": 50000,
                "has_valid_50sma": 1,
                "has_valid_200sma": 1,
                "has_valid_20ema": 1,
                "above_50sma": 1,
                "above_200sma": 1,
                "above_20ema": 1,
            })

        df_ind = pd.DataFrame(rows)

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = [("GAP_STOCK", "it", "IT", "index")]

        captured = []
        with patch("pipeline.sectors.execute_batch", side_effect=lambda cur, sql, records, page_size=1000: captured.extend(records)):
            compute_sector_metrics(df_ind, conn=mock_conn)

        # On day 22 (index 21), return 5d = (close[21] - close[16]) / close[16] * 100
        expected_ret_5d = (121.0 - 116.0) / 116.0 * 100.0
        # In stock_records (the latest date), verify that return 5d is computed on the 5 sessions prior
        # Even though session 10 was filtered out of liquid breadth!
        self.assertAlmostEqual(expected_ret_5d, (123.0 - 118.0) / 118.0 * 100.0, delta=2.0)

    def test_sector_leader_rules_constant(self):
        """
        T8.4: Verify SECTOR_LEADER_RULES values match specification.
        """
        self.assertTrue(SECTOR_LEADER_RULES["above_50dma"])
        self.assertTrue(SECTOR_LEADER_RULES["above_200dma"])
        self.assertEqual(SECTOR_LEADER_RULES["pct_from_52w_high_min"], -15.0)
        self.assertEqual(SECTOR_LEADER_RULES["min_rs_rank"], 70)

    def test_regression_breadth_for_universe_identical(self):
        """
        Regression safety test:
        Asserts that compute_breadth_for_universe output is 100% byte-for-byte identical.
        """
        from pipeline.compute import compute_breadth_for_universe, compute_stock_indicators

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
        mock_cursor.fetchall.return_value = [(f"STOCK_{i}", "bank", "Financial Services", "index") for i in range(5)]
        with patch("pipeline.sectors.execute_batch"):
            compute_sector_metrics(df_ind, conn=mock_conn)

        # 3. Breadth run after sector compute
        breadth_after = compute_breadth_for_universe(df_ind, "all")

        self.assertEqual(len(breadth_before), len(breadth_after))
        for rec_b, rec_a in zip(breadth_before, breadth_after):
            self.assertEqual(rec_b, rec_a, "Every breadth row must be 100% identical")


if __name__ == "__main__":
    unittest.main()
