"""
pipeline/sectors.py

Tab 3: Sector Rotation data layer and breadth compute.
Defines canonical SECTORS taxonomy, stock-to-sector mapping, and sector breadth analytics.
"""

import io
import logging
from typing import Dict, List, Any, Optional, Tuple, Set
import requests
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
