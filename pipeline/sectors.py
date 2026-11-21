"""
pipeline/sectors.py

Tab 3: Sector Rotation data layer and breadth compute.
Defines canonical SECTORS taxonomy, stock-to-sector mapping, and sector breadth analytics.
"""

import io
import logging
from typing import Dict, List, Any, Optional, Tuple, Set
import requests
import numpy as np
import pandas as pd
from psycopg2.extras import execute_batch
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.sectors")

BASE_CONSTITUENTS_URL = "https://niftyindices.com/IndexConstituent/"
MIN_SECTOR_STOCKS = 8

# Canonical sector taxonomy ordered by assignment priority (most specific first).
# Single source of truth mirrored to web API.
SECTORS: List[Dict[str, str]] = [
    {
        "key": "bank",
        "label": "Bank",
        "index_name": "NIFTY BANK",
        "constituents_slug": "ind_niftybanklist.csv",
        "angel_name": "BANKNIFTY",
    },
    {
        "key": "financial_services",
        "label": "Financial Services (ex-Bank)",
        "index_name": "NIFTY FINANCIAL SERVICES",
        "constituents_slug": "ind_niftyfinancelist.csv",
        "angel_name": "FINNIFTY",
    },
    {
        "key": "it",
        "label": "IT",
        "index_name": "NIFTY IT",
        "constituents_slug": "ind_niftyitlist.csv",
        "angel_name": "NIFTY IT",
    },
    {
        "key": "pharma",
        "label": "Pharma",
        "index_name": "NIFTY PHARMA",
        "constituents_slug": "ind_niftypharmalist.csv",
        "angel_name": "NIFTY PHARMA",
    },
    {
        "key": "healthcare",
        "label": "Healthcare",
        "index_name": "NIFTY HEALTHCARE",
        "constituents_slug": "ind_niftyhealthcarelist.csv",
        "angel_name": "NIFTY HEALTHCARE",
    },
    {
        "key": "auto",
        "label": "Auto",
        "index_name": "NIFTY AUTO",
        "constituents_slug": "ind_niftyautolist.csv",
        "angel_name": "NIFTY AUTO",
    },
    {
        "key": "consumer_durables",
        "label": "Consumer Durables",
        "index_name": "NIFTY CONSUMER DURABLES",
        "constituents_slug": "ind_niftyconsumerdurableslist.csv",
        "angel_name": "NIFTY CONSUMER DURABLES",
    },
    {
        "key": "fmcg",
        "label": "FMCG",
        "index_name": "NIFTY FMCG",
        "constituents_slug": "ind_niftyfmcglist.csv",
        "angel_name": "NIFTY FMCG",
    },
    {
        "key": "metal",
        "label": "Metal",
        "index_name": "NIFTY METAL",
        "constituents_slug": "ind_niftymetallist.csv",
        "angel_name": "NIFTY METAL",
    },
    {
        "key": "oil_gas",
        "label": "Oil & Gas",
        "index_name": "NIFTY OIL & GAS",
        "constituents_slug": "ind_niftyoilgaslist.csv",
        "angel_name": "NIFTY OIL & GAS",
    },
    {
        "key": "realty",
        "label": "Realty",
        "index_name": "NIFTY REALTY",
        "constituents_slug": "ind_niftyrealtylist.csv",
        "angel_name": "NIFTY REALTY",
    },
    {
        "key": "media",
        "label": "Media",
        "index_name": "NIFTY MEDIA",
        "constituents_slug": "ind_niftymedialist.csv",
        "angel_name": "NIFTY MEDIA",
    },
]

SECTOR_KEYS: List[str] = [s["key"] for s in SECTORS]
SECTORS_BY_KEY: Dict[str, Dict[str, str]] = {s["key"]: s for s in SECTORS}


def assign_stock_sectors(
    sector_csv_tables: Dict[str, pd.DataFrame],
    isin_to_symbol: Dict[str, str],
    known_symbols: Set[str],
    sectors_order: Optional[List[Dict[str, str]]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, int]]:
    """
    Assigns each stock to exactly ONE primary sector based on priority order.

    Rule: A stock found in multiple sector CSVs gets the FIRST sector in SECTORS order.
    Matching: ISIN first, symbol second.
    Full multi-membership is stored nowhere.

    Returns:
        (assigned_dict, stats_dict)
        where assigned_dict is {master_symbol: {"symbol": s, "isin": isin, "sector": k, "source_index": idx}}
    """
    order = sectors_order or SECTORS
    assigned: Dict[str, Dict[str, Any]] = {}
    stats: Dict[str, int] = {s["key"]: 0 for s in order}
    stats["unmatched_rows"] = 0

    for sec in order:
        key = sec["key"]
        source_idx = sec["index_name"]
        df = sector_csv_tables.get(key)
        if df is None or df.empty:
            continue

        cols_lower = {str(c).strip().lower(): c for c in df.columns}
        sym_col = cols_lower.get("symbol")
        isin_col = cols_lower.get("isin code") or cols_lower.get("isin")

        if not sym_col:
            continue

        for _, row in df.iterrows():
            raw_sym = str(row[sym_col]).strip() if pd.notna(row.get(sym_col)) else ""
            raw_isin = str(row[isin_col]).strip() if isin_col and pd.notna(row.get(isin_col)) else ""

            if not raw_sym and not raw_isin:
                continue

            # ISIN-first matching
            master_symbol = None
            resolved_isin = raw_isin if raw_isin else None

            if raw_isin and raw_isin in isin_to_symbol:
                master_symbol = isin_to_symbol[raw_isin]
            elif raw_sym and raw_sym in known_symbols:
                master_symbol = raw_sym
            elif raw_sym:
                # Stock not in active instruments master
                stats["unmatched_rows"] += 1
                continue
            else:
                stats["unmatched_rows"] += 1
                continue

            # First match wins (primary sector assignment)
            if master_symbol not in assigned:
                assigned[master_symbol] = {
                    "symbol": master_symbol,
                    "isin": resolved_isin,
                    "sector": key,
                    "source_index": source_idx,
                }
                stats[key] += 1

    return assigned, stats


def sync_stock_sectors(conn=None) -> Dict[str, Any]:
    """
    Downloads sector constituents CSVs from niftyindices.com,
    resolves master instruments, and updates stock_sector table.
    Non-fatal: If download fails, keeps stored mapping and marks degraded.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    headers = {"User-Agent": "Mozilla/5.0"}
    downloaded_tables: Dict[str, pd.DataFrame] = {}
    verified_sectors = []
    dropped_sectors = []

    try:
        # 1. Download each sector's constituents CSV
        for sec in SECTORS:
            key = sec["key"]
            slug = sec["constituents_slug"]
            url = BASE_CONSTITUENTS_URL + slug

            try:
                resp = requests.get(url, headers=headers, timeout=20)
                if resp.status_code == 200 and "Symbol" in resp.text:
                    df = pd.read_csv(io.StringIO(resp.text))
                    downloaded_tables[key] = df
                    verified_sectors.append(key)
                else:
                    logger.warning(f"Sector {key} CSV download failed (status {resp.status_code}): {slug}")
                    dropped_sectors.append((key, f"HTTP {resp.status_code} or missing Symbol column"))
            except Exception as e:
                logger.warning(f"Sector {key} download error: {e}")
                dropped_sectors.append((key, str(e)))

        # 2. Check fallback if download failed completely
        if not downloaded_tables:
            logger.warning("No sector CSVs could be downloaded. Checking stored mapping...")
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM stock_sector;")
                count = cur.fetchone()[0]
                if count > 0:
                    logger.info(f"Using {count} stored stock_sector mappings.")
                    return {
                        "status": "partial",
                        "degraded": True,
                        "verified_sectors": [],
                        "dropped_sectors": dropped_sectors,
                        "stored_fallback": True,
                        "total_assigned": count,
                    }
                else:
                    raise RuntimeError("No sector CSVs downloaded and stock_sector table is empty.")

        # 3. Query active instruments for ISIN and Symbol resolution
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, isin FROM instruments WHERE is_active = TRUE;")
            rows = cur.fetchall()
            isin_to_symbol = {r[1]: r[0] for r in rows if r[1]}
            known_symbols = {r[0] for r in rows if r[0]}

        # 4. Perform priority assignment (Bank before FinServ, Pharma before Healthcare, etc.)
        assigned, stats = assign_stock_sectors(
            downloaded_tables,
            isin_to_symbol=isin_to_symbol,
            known_symbols=known_symbols,
            sectors_order=SECTORS,
        )

        # 5. Upsert into stock_sector
        records = [
            (v["symbol"], v["isin"], v["sector"], v["source_index"])
            for v in assigned.values()
        ]

        with conn.cursor() as cur:
            upsert_sql = """
                INSERT INTO stock_sector (symbol, isin, sector, source_index, updated_at)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (symbol) DO UPDATE SET
                    isin = EXCLUDED.isin,
                    sector = EXCLUDED.sector,
                    source_index = EXCLUDED.source_index,
                    updated_at = NOW();
            """
            execute_batch(cur, upsert_sql, records, page_size=500)
            conn.commit()

        logger.info(f"Successfully mapped {len(records)} stocks across {len(verified_sectors)} sectors.")

        return {
            "status": "success",
            "degraded": len(dropped_sectors) > 0,
            "verified_sectors": verified_sectors,
            "dropped_sectors": dropped_sectors,
            "total_assigned": len(records),
            "stats": stats,
        }

    except Exception as e:
        logger.error(f"Error in sync_stock_sectors: {e}")
        # Check if stored fallback exists
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM stock_sector;")
                count = cur.fetchone()[0]
                if count > 0:
                    return {
                        "status": "partial",
                        "degraded": True,
                        "error": str(e),
                        "stored_fallback": True,
                        "total_assigned": count,
                    }
        except Exception:
            pass
        raise
    finally:
        if should_close:
            conn.close()

EQUAL_WEIGHT_SECTOR_KEYS = {"healthcare", "consumer_durables", "oil_gas"}

def compute_sector_metrics(
    df_ind: pd.DataFrame,
    conn=None,
    publish_floor_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    Computes daily sector breadth and equal-weight metrics per spec P3.
    Called from compute_and_publish_all after breadth publish.
    Uses identical strict-liquid universe and publish floor.
    """
    if df_ind is None or df_ind.empty:
        logger.warning("Empty df_ind provided to compute_sector_metrics.")
        return {"total_published": 0, "status": "skipped"}

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # 1. Fetch stock_sector mapping from DB
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, sector FROM stock_sector;")
            ss_rows = cur.fetchall()

        if not ss_rows:
            logger.warning("No stock_sector mappings found in database. Skipping sector metrics.")
            return {"total_published": 0, "status": "no_mappings"}

        symbol_to_sector = {r[0]: r[1] for r in ss_rows}
        sector_constituents_count = {}
        for _, sec in ss_rows:
            sector_constituents_count[sec] = sector_constituents_count.get(sec, 0) + 1

        # 2. Strict liquid universe filter (matching Breadth tab liquid definition)
        vol_col = "vol_sma_50" if "vol_sma_50" in df_ind.columns else "volume"
        is_liquid = (df_ind["close"] >= 20) & (df_ind[vol_col] >= 25000) & df_ind[vol_col].notna()
        df_sec = df_ind[is_liquid].copy()
        df_sec["sector"] = df_sec["symbol"].map(symbol_to_sector)
        df_sec = df_sec[df_sec["sector"].notna()].copy()

        if df_sec.empty:
            logger.warning("No liquid stock rows matched sector mappings.")
            return {"total_published": 0, "status": "no_liquid_constituents"}

        # 3. Compute per-stock rolling returns (5d=1w, 22d=1m, 64d=3m) in percentage
        df_sec = df_sec.sort_values(by=["symbol", "trade_date"])
        df_sec["ret_5d"] = df_sec.groupby("symbol")["close"].transform(lambda s: (s - s.shift(5)) / s.shift(5) * 100.0)
        df_sec["ret_22d"] = df_sec.groupby("symbol")["close"].transform(lambda s: (s - s.shift(22)) / s.shift(22) * 100.0)
        df_sec["ret_64d"] = df_sec.groupby("symbol")["close"].transform(lambda s: (s - s.shift(64)) / s.shift(64) * 100.0)

        # 4. Synthesize equal-weight daily index series for equal-weight sectors
        # Upsert into daily_index_ohlcv so API can query daily_index_ohlcv uniformly
        sector_info_by_key = {s["key"]: s for s in SECTORS}
        for eq_key in EQUAL_WEIGHT_SECTOR_KEYS:
            eq_sec_df = df_sec[df_sec["sector"] == eq_key].copy()
            if eq_sec_df.empty:
                continue
            idx_name = sector_info_by_key.get(eq_key, {}).get("index_name")
            if not idx_name:
                continue

            if "ret_1d" in eq_sec_df.columns:
                ret_s = eq_sec_df["ret_1d"]
            else:
                ret_s = (eq_sec_df["close"] - eq_sec_df["prev_close"]) / eq_sec_df["prev_close"]

            eq_sec_df["calc_ret_1d"] = ret_s
            daily_agg = eq_sec_df.groupby("trade_date").agg(
                mean_ret=("calc_ret_1d", "mean"),
                total_vol=("volume", "sum")
            ).reset_index().sort_values("trade_date")

            if daily_agg.empty:
                continue

            cum_close = 100.0
            idx_records = []
            for _, r in daily_agg.iterrows():
                t_date = r["trade_date"]
                m_ret = r["mean_ret"]
                if pd.notna(m_ret):
                    cum_close = cum_close * (1.0 + float(m_ret))
                vol = int(r["total_vol"]) if pd.notna(r["total_vol"]) else 0
                idx_records.append((t_date, idx_name, round(cum_close, 4), round(cum_close, 4), round(cum_close, 4), round(cum_close, 4), vol))

            with conn.cursor() as cur:
                insert_idx_sql = """
                INSERT INTO daily_index_ohlcv (trade_date, index_name, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (trade_date, index_name) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume;
                """
                execute_batch(cur, insert_idx_sql, idx_records, page_size=1000)
            logger.info(f"Synthesized and upserted {len(idx_records)} equal-weight index candles for {idx_name}.")

        # 5. Compute sector breadth metrics
        grouped = df_sec.groupby(["trade_date", "sector"])

        breadth_records = []
        for (trade_date, sector_key), grp in grouped:
            if publish_floor_date and trade_date < publish_floor_date:
                continue

            n_stocks = sector_constituents_count.get(sector_key, len(grp))
            valid_mask = grp["has_valid_50sma"] == 1 if "has_valid_50sma" in grp.columns else grp["close"].notna()
            n_valid = int(valid_mask.sum())

            advances = int(grp["advance"].sum()) if "advance" in grp.columns else int((grp["ret_1d"] > 0).sum())
            declines = int(grp["decline"].sum()) if "decline" in grp.columns else int((grp["ret_1d"] < 0).sum())
            new_52w_highs = int(grp["is_high_52w"].sum()) if "is_high_52w" in grp.columns else 0
            new_52w_lows = int(grp["is_low_52w"].sum()) if "is_low_52w" in grp.columns else 0

            price_source = "equal_weight" if sector_key in EQUAL_WEIGHT_SECTOR_KEYS else "official"

            if n_valid < MIN_SECTOR_STOCKS:
                pct_above_50dma = None
                pct_above_200dma = None
                pct_above_20ema = None
                ret_1w_ew = None
                ret_1m_ew = None
                ret_3m_ew = None
            else:
                pct_above_50dma = round(float(100.0 * grp["above_50sma"].sum() / n_valid), 2) if "above_50sma" in grp.columns else None
                pct_above_200dma = round(float(100.0 * grp["above_200sma"].sum() / n_valid), 2) if "above_200sma" in grp.columns else None
                pct_above_20ema = round(float(100.0 * grp["above_20ema"].sum() / n_valid), 2) if "above_20ema" in grp.columns else None
                
                r1w = grp["ret_5d"].dropna()
                ret_1w_ew = round(float(r1w.mean()), 4) if len(r1w) > 0 else None
                r1m = grp["ret_22d"].dropna()
                ret_1m_ew = round(float(r1m.mean()), 4) if len(r1m) > 0 else None
                r3m = grp["ret_64d"].dropna()
                ret_3m_ew = round(float(r3m.mean()), 4) if len(r3m) > 0 else None

            breadth_records.append((
                trade_date,
                sector_key,
                n_stocks,
                n_valid,
                pct_above_50dma,
                pct_above_200dma,
                pct_above_20ema,
                advances,
                declines,
                new_52w_highs,
                new_52w_lows,
                ret_1w_ew,
                ret_1m_ew,
                ret_3m_ew,
                price_source
            ))

        if breadth_records:
            with conn.cursor() as cur:
                upsert_breadth_sql = """
                INSERT INTO daily_sector_breadth (
                    trade_date, sector, n_stocks, n_valid,
                    pct_above_50dma, pct_above_200dma, pct_above_20ema,
                    advances, declines, new_52w_highs, new_52w_lows,
                    ret_1w_ew, ret_1m_ew, ret_3m_ew, price_source
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (trade_date, sector) DO UPDATE SET
                    n_stocks = EXCLUDED.n_stocks,
                    n_valid = EXCLUDED.n_valid,
                    pct_above_50dma = EXCLUDED.pct_above_50dma,
                    pct_above_200dma = EXCLUDED.pct_above_200dma,
                    pct_above_20ema = EXCLUDED.pct_above_20ema,
                    advances = EXCLUDED.advances,
                    declines = EXCLUDED.declines,
                    new_52w_highs = EXCLUDED.new_52w_highs,
                    new_52w_lows = EXCLUDED.new_52w_lows,
                    ret_1w_ew = EXCLUDED.ret_1w_ew,
                    ret_1m_ew = EXCLUDED.ret_1m_ew,
                    ret_3m_ew = EXCLUDED.ret_3m_ew,
                    price_source = EXCLUDED.price_source;
                """
                execute_batch(cur, upsert_breadth_sql, breadth_records, page_size=1000)
            conn.commit()
            logger.info(f"Published {len(breadth_records)} rows to daily_sector_breadth.")

        return {
            "status": "success",
            "total_published": len(breadth_records)
        }
    finally:
        if should_close:
            conn.close()

def backfill_sector_breadth(parquet_path: Optional[str] = None, conn=None) -> Dict[str, Any]:
    """
    Backfills daily sector breadth across all available history in parquet.
    """
    import os
    from pipeline.config import EQUITY_PARQUET_PATH
    from pipeline.compute import compute_stock_indicators

    p_path = parquet_path or EQUITY_PARQUET_PATH
    if not os.path.exists(p_path):
        raise FileNotFoundError(f"Parquet file {p_path} not found.")

    df_raw = pd.read_parquet(p_path)
    df_ind = compute_stock_indicators(df_raw)
    all_trade_dates = sorted(df_ind["trade_date"].unique())
    publish_floor_date = all_trade_dates[252] if len(all_trade_dates) >= 253 else all_trade_dates[0]

    return compute_sector_metrics(df_ind, conn=conn, publish_floor_date=publish_floor_date)
