"""
pipeline/sectors.py

Tab 3: Sector Rotation data layer and breadth compute.
Defines canonical SECTORS taxonomy, stock-to-sector mapping, and sector breadth analytics.
Round 2: Covers all 501 Nifty 500 stocks via sector indices + Industry mapping.
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
SECTORS: List[Dict[str, Any]] = [
    {
        "key": "bank",
        "label": "Bank",
        "short": "Bank",
        "index_name": "NIFTY BANK",
        "constituents_slug": "ind_niftybanklist.csv",
        "angel_name": "BANKNIFTY",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "financial_services",
        "label": "Financial Services (ex-Bank)",
        "short": "FinSvc",
        "index_name": "NIFTY FINANCIAL SERVICES",
        "constituents_slug": "ind_niftyfinancelist.csv",
        "angel_name": "FINNIFTY",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "it",
        "label": "IT",
        "short": "IT",
        "index_name": "NIFTY IT",
        "constituents_slug": "ind_niftyitlist.csv",
        "angel_name": "NIFTY IT",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "healthcare",
        "label": "Healthcare (Pharma + Hospitals)",
        "short": "Health",
        "index_name": "NIFTY HEALTHCARE (EW)",
        "constituents_slug": "ind_niftyhealthcarelist.csv",
        "angel_name": "",
        "group_type": "index",
        "price_source": "equal_weight",
    },
    {
        "key": "auto",
        "label": "Auto",
        "short": "Auto",
        "index_name": "NIFTY AUTO",
        "constituents_slug": "ind_niftyautolist.csv",
        "angel_name": "NIFTY AUTO",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "consumer_durables",
        "label": "Consumer Durables",
        "short": "ConsDur",
        "index_name": "NIFTY CONSUMER DURABLES (EW)",
        "constituents_slug": "ind_niftyconsumerdurableslist.csv",
        "angel_name": "",
        "group_type": "index",
        "price_source": "equal_weight",
    },
    {
        "key": "fmcg",
        "label": "FMCG",
        "short": "FMCG",
        "index_name": "NIFTY FMCG",
        "constituents_slug": "ind_niftyfmcglist.csv",
        "angel_name": "NIFTY FMCG",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "metal",
        "label": "Metal",
        "short": "Metal",
        "index_name": "NIFTY METAL",
        "constituents_slug": "ind_niftymetallist.csv",
        "angel_name": "NIFTY METAL",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "oil_gas",
        "label": "Oil & Gas",
        "short": "Oil&Gas",
        "index_name": "NIFTY OIL & GAS (EW)",
        "constituents_slug": "ind_niftyoilgaslist.csv",
        "angel_name": "",
        "group_type": "index",
        "price_source": "equal_weight",
    },
    {
        "key": "realty",
        "label": "Realty",
        "short": "Realty",
        "index_name": "NIFTY REALTY",
        "constituents_slug": "ind_niftyrealtylist.csv",
        "angel_name": "NIFTY REALTY",
        "group_type": "index",
        "price_source": "official",
    },
    {
        "key": "media",
        "label": "Media",
        "short": "Media",
        "index_name": "NIFTY MEDIA",
        "constituents_slug": "ind_niftymedialist.csv",
        "angel_name": "NIFTY MEDIA",
        "group_type": "index",
        "price_source": "official",
    },
    # Industry-based groups covering remaining Nifty 500 stocks (group_type='industry')
    {
        "key": "capital_goods",
        "label": "Capital Goods",
        "short": "CapGoods",
        "index_name": "NIFTY CAPITAL GOODS (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "chemicals",
        "label": "Chemicals",
        "short": "Chem",
        "index_name": "NIFTY CHEMICALS (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "power",
        "label": "Power",
        "short": "Power",
        "index_name": "NIFTY POWER (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "telecom",
        "label": "Telecommunication",
        "short": "Telecom",
        "index_name": "NIFTY TELECOM (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "consumer_services",
        "label": "Consumer Services",
        "short": "ConsSvc",
        "index_name": "NIFTY CONS SERVICES (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "services",
        "label": "Services",
        "short": "Services",
        "index_name": "NIFTY SERVICES (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "construction",
        "label": "Construction",
        "short": "Constr",
        "index_name": "NIFTY CONSTRUCTION (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "construction_materials",
        "label": "Construction Materials",
        "short": "ConstMat",
        "index_name": "NIFTY CONST MAT (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "textiles",
        "label": "Textiles",
        "short": "Textiles",
        "index_name": "NIFTY TEXTILES (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
    {
        "key": "diversified",
        "label": "Diversified",
        "short": "Divers",
        "index_name": "NIFTY DIVERSIFIED (EW)",
        "constituents_slug": "",
        "angel_name": "",
        "group_type": "industry",
        "price_source": "equal_weight",
    },
]

SECTOR_KEYS: List[str] = [s["key"] for s in SECTORS]
SECTORS_BY_KEY: Dict[str, Dict[str, Any]] = {s["key"]: s for s in SECTORS}

# Mapping all 20 distinct Nifty 500 Industry values to canonical sector keys (T12.2)
INDUSTRY_TO_SECTOR: Dict[str, str] = {
    "Financial Services": "financial_services",
    "Capital Goods": "capital_goods",
    "Healthcare": "healthcare",
    "Automobile and Auto Components": "auto",
    "Fast Moving Consumer Goods": "fmcg",
    "Chemicals": "chemicals",
    "Information Technology": "it",
    "Consumer Services": "consumer_services",
    "Metals & Mining": "metal",
    "Power": "power",
    "Oil Gas & Consumable Fuels": "oil_gas",
    "Consumer Durables": "consumer_durables",
    "Services": "services",
    "Realty": "realty",
    "Construction": "construction",
    "Construction Materials": "construction_materials",
    "Telecommunication": "telecom",
    "Textiles": "textiles",
    "Media Entertainment & Publication": "media",
    "Diversified": "diversified",
}

# Single constants definition for Sector Leaders (T8.4)
SECTOR_LEADER_RULES = {
    "above_50dma": True,
    "above_200dma": True,
    "pct_from_52w_high_min": -15.0,
    "min_rs_rank": 70,
}


def assign_stock_sectors(
    sector_csv_tables: Dict[str, pd.DataFrame],
    nifty500_df: Optional[pd.DataFrame],
    isin_to_symbol: Dict[str, str],
    known_symbols: Set[str],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Any]]:
    """
    Assigns each stock to exactly ONE primary sector based on priority order:
    1. Sector-index CSV membership first (priority order: Bank, FinServ, IT, Healthcare, Auto, etc.)
       - Bank merges Nifty Bank, PSU Bank, and Private Bank (if available)
       - Healthcare merges Pharma and Healthcare indices
    2. Then every remaining Nifty 500 stock is mapped via its Industry column
       using INDUSTRY_TO_SECTOR.
    """
    assigned: Dict[str, Dict[str, Any]] = {}
    stats: Dict[str, Any] = {s["key"]: {"index": 0, "industry": 0, "total": 0} for s in SECTORS}
    stats["unmatched_rows"] = 0

    # Index assignment priority order for sector-index files
    index_priority_order = [
        "bank", "financial_services", "it", "healthcare", "auto",
        "consumer_durables", "fmcg", "metal", "oil_gas", "realty", "media"
    ]

    # Process sector-index CSVs
    for key in index_priority_order:
        sec = SECTORS_BY_KEY.get(key, {})
        source_idx = sec.get("index_name", key)

        dfs_to_process = []
        if key == "bank":
            for b_slug in ["bank", "psu_bank", "private_bank"]:
                df = sector_csv_tables.get(b_slug)
                if df is not None and not df.empty:
                    dfs_to_process.append(df)
        elif key == "healthcare":
            for h_slug in ["pharma", "healthcare"]:
                df = sector_csv_tables.get(h_slug)
                if df is not None and not df.empty:
                    dfs_to_process.append(df)
        else:
            df = sector_csv_tables.get(key)
            if df is not None and not df.empty:
                dfs_to_process.append(df)

        for df in dfs_to_process:
            cols_lower = {str(c).strip().lower(): c for c in df.columns}
            sym_col = cols_lower.get("symbol")
            isin_col = cols_lower.get("isin code") or cols_lower.get("isin")
            ind_col = cols_lower.get("industry")

            if not sym_col:
                continue

            for _, row in df.iterrows():
                raw_sym = str(row[sym_col]).strip() if pd.notna(row.get(sym_col)) else ""
                raw_isin = str(row[isin_col]).strip() if isin_col and pd.notna(row.get(isin_col)) else ""
                raw_ind = str(row[ind_col]).strip() if ind_col and pd.notna(row.get(ind_col)) else None

                if not raw_sym and not raw_isin:
                    continue

                master_symbol = None
                resolved_isin = raw_isin if raw_isin else None

                if raw_isin and raw_isin in isin_to_symbol:
                    master_symbol = isin_to_symbol[raw_isin]
                elif raw_sym and raw_sym in known_symbols:
                    master_symbol = raw_sym
                elif raw_sym:
                    stats["unmatched_rows"] += 1
                    continue
                else:
                    stats["unmatched_rows"] += 1
                    continue

                # First match wins
                if master_symbol not in assigned:
                    assigned[master_symbol] = {
                        "symbol": master_symbol,
                        "isin": resolved_isin,
                        "sector": key,
                        "industry": raw_ind,
                        "source_index": source_idx,
                        "mapped_via": "index",
                    }
                    stats[key]["index"] += 1
                    stats[key]["total"] += 1

    # Map remaining Nifty 500 stocks by Industry column (T12)
    if nifty500_df is not None and not nifty500_df.empty:
        cols_lower = {str(c).strip().lower(): c for c in nifty500_df.columns}
        sym_col = cols_lower.get("symbol")
        isin_col = cols_lower.get("isin code") or cols_lower.get("isin")
        ind_col = cols_lower.get("industry")

        if sym_col and ind_col:
            for _, row in nifty500_df.iterrows():
                raw_sym = str(row[sym_col]).strip() if pd.notna(row.get(sym_col)) else ""
                raw_isin = str(row[isin_col]).strip() if isin_col and pd.notna(row.get(isin_col)) else ""
                raw_ind = str(row[ind_col]).strip() if pd.notna(row.get(ind_col)) else ""

                if not raw_sym and not raw_isin:
                    continue

                master_symbol = None
                resolved_isin = raw_isin if raw_isin else None

                if raw_isin and raw_isin in isin_to_symbol:
                    master_symbol = isin_to_symbol[raw_isin]
                elif raw_sym and raw_sym in known_symbols:
                    master_symbol = raw_sym
                else:
                    master_symbol = raw_sym

                if not master_symbol:
                    continue

                # If already assigned via index, fill industry if missing
                if master_symbol in assigned:
                    if not assigned[master_symbol].get("industry") and raw_ind:
                        assigned[master_symbol]["industry"] = raw_ind
                    continue

                # Map via Industry
                target_sector = INDUSTRY_TO_SECTOR.get(raw_ind)
                if not target_sector:
                    # Safe fallback: create a slug for any new unmapped industry
                    slug = raw_ind.lower().replace(" & ", "_").replace(" ", "_")
                    target_sector = slug
                    if slug not in stats:
                        stats[slug] = {"index": 0, "industry": 0, "total": 0}

                sec_info = SECTORS_BY_KEY.get(target_sector, {})
                source_idx = sec_info.get("index_name", f"NIFTY {raw_ind.upper()} (EW)")

                assigned[master_symbol] = {
                    "symbol": master_symbol,
                    "isin": resolved_isin,
                    "sector": target_sector,
                    "industry": raw_ind,
                    "source_index": source_idx,
                    "mapped_via": "industry",
                }
                if target_sector in stats:
                    stats[target_sector]["industry"] += 1
                    stats[target_sector]["total"] += 1

    return assigned, stats


def sync_stock_sectors(conn=None) -> Dict[str, Any]:
    """
    Downloads sector constituents CSVs and Nifty 500 list from niftyindices.com.
    Maps all stocks (index priority + industry fallback).
    Non-fatal failure handling:
    - If ANY CSV fails: only insert stocks without stored mapping; never overwrite existing rows; mark degraded.
    - If ALL CSVs succeed: replace the table inside one transaction.
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
        # 1. Download sector CSVs
        slug_map = {
            "bank": "ind_niftybanklist.csv",
            "psu_bank": "ind_niftypsubanklist.csv",
            "private_bank": "ind_niftyprivatebanklist.csv",
            "financial_services": "ind_niftyfinancelist.csv",
            "it": "ind_niftyitlist.csv",
            "pharma": "ind_niftypharmalist.csv",
            "healthcare": "ind_niftyhealthcarelist.csv",
            "auto": "ind_niftyautolist.csv",
            "consumer_durables": "ind_niftyconsumerdurableslist.csv",
            "fmcg": "ind_niftyfmcglist.csv",
            "metal": "ind_niftymetallist.csv",
            "oil_gas": "ind_niftyoilgaslist.csv",
            "realty": "ind_niftyrealtylist.csv",
            "media": "ind_niftymedialist.csv",
        }

        for slug_key, slug_file in slug_map.items():
            url = BASE_CONSTITUENTS_URL + slug_file
            try:
                resp = requests.get(url, headers=headers, timeout=20)
                if resp.status_code == 200 and "Symbol" in resp.text:
                    df = pd.read_csv(io.StringIO(resp.text))
                    if len(df) >= 5:
                        downloaded_tables[slug_key] = df
                        verified_sectors.append(slug_key)
                    else:
                        logger.warning(f"CSV {slug_file} had too few rows ({len(df)} < 5)")
                        dropped_sectors.append((slug_key, f"Insufficient rows: {len(df)}"))
                else:
                    logger.warning(f"CSV {slug_file} failed HTTP {resp.status_code} or missing Symbol")
                    dropped_sectors.append((slug_key, f"HTTP {resp.status_code} or missing Symbol"))
            except Exception as e:
                logger.warning(f"Error downloading {slug_file}: {e}")
                dropped_sectors.append((slug_key, str(e)))

        # 2. Download Nifty 500 CSV
        nifty500_df = None
        try:
            url_500 = BASE_CONSTITUENTS_URL + "ind_nifty500list.csv"
            resp_500 = requests.get(url_500, headers=headers, timeout=20)
            if resp_500.status_code == 200 and "Symbol" in resp_500.text:
                nifty500_df = pd.read_csv(io.StringIO(resp_500.text))
                if len(nifty500_df) < 5:
                    nifty500_df = None
                    dropped_sectors.append(("nifty500", "Insufficient rows in Nifty 500 list"))
            else:
                dropped_sectors.append(("nifty500", f"HTTP {resp_500.status_code} on Nifty 500 list"))
        except Exception as e:
            dropped_sectors.append(("nifty500", str(e)))

        # 3. Query active instruments for ISIN and Symbol resolution
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, isin FROM instruments WHERE is_active = TRUE;")
            rows = cur.fetchall()
            isin_to_symbol = {r[1]: r[0] for r in rows if r[1]}
            known_symbols = {r[0] for r in rows if r[0]}

        # 4. Perform assignment
        assigned, stats = assign_stock_sectors(
            downloaded_tables,
            nifty500_df=nifty500_df,
            isin_to_symbol=isin_to_symbol,
            known_symbols=known_symbols,
        )

        records = [
            (
                v["symbol"],
                v["isin"],
                v["sector"],
                v.get("industry"),
                v.get("mapped_via", "index"),
                v["source_index"],
            )
            for v in assigned.values()
        ]

        # 5. Handle update: check if any critical CSV failed
        # If any CSV failed: only insert new stocks; never overwrite existing mapping (T2)
        has_failure = len(dropped_sectors) > 0 and any(k != "private_bank" for k, _ in dropped_sectors)

        with conn.cursor() as cur:
            if has_failure:
                logger.warning("One or more sector constituents CSVs failed. Using safe insert (no overwrite of existing rows).")
                insert_safe_sql = """
                    INSERT INTO stock_sector (symbol, isin, sector, industry, mapped_via, source_index, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (symbol) DO NOTHING;
                """
                execute_batch(cur, insert_safe_sql, records, page_size=500)
                conn.commit()
            else:
                # All CSVs succeeded: atomic replace in single transaction (T2)
                upsert_sql = """
                    INSERT INTO stock_sector (symbol, isin, sector, industry, mapped_via, source_index, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (symbol) DO UPDATE SET
                        isin = EXCLUDED.isin,
                        sector = EXCLUDED.sector,
                        industry = EXCLUDED.industry,
                        mapped_via = EXCLUDED.mapped_via,
                        source_index = EXCLUDED.source_index,
                        updated_at = NOW();
                """
                execute_batch(cur, upsert_sql, records, page_size=500)

                assigned_symbols = [v["symbol"] for v in assigned.values()]
                if assigned_symbols:
                    cur.execute(
                        "DELETE FROM stock_sector WHERE symbol != ALL(%s);",
                        (assigned_symbols,)
                    )
                conn.commit()

        logger.info(f"Successfully mapped {len(records)} stocks across sectors.")

        return {
            "status": "partial" if has_failure else "success",
            "degraded": has_failure,
            "verified_sectors": verified_sectors,
            "dropped_sectors": dropped_sectors,
            "total_assigned": len(records),
            "stats": stats,
        }

    except Exception as e:
        logger.error(f"Error in sync_stock_sectors: {e}")
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


def compute_sector_metrics(
    df_ind: pd.DataFrame,
    conn=None,
    publish_floor_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    Computes daily sector breadth and equal-weight metrics (T3, T4, T5, T8).
    - T4: Computes stock rolling returns on FULL per-token sequence BEFORE liquidity filtering.
    - T3: Uses separate denominators for 50DMA, 200DMA, 20EMA.
    - T5: Synthesizes equal-weight index under '<NAME> (EW)'.
    - T8: Computes and upserts per-stock metrics table `sector_stock_metrics` for the latest trade date.
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
            cur.execute("SELECT symbol, sector, industry, mapped_via FROM stock_sector;")
            ss_rows = cur.fetchall()

        if not ss_rows:
            logger.warning("No stock_sector mappings found in database. Skipping sector metrics.")
            return {"total_published": 0, "status": "no_mappings"}

        symbol_to_sector = {r[0]: r[1] for r in ss_rows}
        sector_constituents_count = {}
        for r in ss_rows:
            sec = r[1]
            sector_constituents_count[sec] = sector_constituents_count.get(sec, 0) + 1

        # 2. T4: Compute per-token rolling returns on the FULL sequence BEFORE liquidity filter
        group_col = "token" if "token" in df_ind.columns else "symbol"
        df_ind = df_ind.sort_values(by=[group_col, "trade_date"]).copy()

        df_ind["ret_1d_pct"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(1)) / s.shift(1) * 100.0
        )
        df_ind["ret_5d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(5)) / s.shift(5) * 100.0
        )
        df_ind["ret_22d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(22)) / s.shift(22) * 100.0
        )
        df_ind["ret_64d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(64)) / s.shift(64) * 100.0
        )
        df_ind["ret_126d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(126)) / s.shift(126) * 100.0
        )

        # 3. Determine strict liquid universe mask
        vol_col = "vol_sma_50" if "vol_sma_50" in df_ind.columns else "volume"
        is_liquid = (df_ind["close"] >= 20) & (df_ind[vol_col] >= 25000) & df_ind[vol_col].notna()
        df_ind["in_universe"] = is_liquid

        # Map sector
        df_ind["sector"] = df_ind["symbol"].map(symbol_to_sector)

        # Filter to liquid and mapped rows for sector breadth
        df_sec = df_ind[df_ind["in_universe"] & df_ind["sector"].notna()].copy()

        if df_sec.empty:
            logger.warning("No liquid stock rows matched sector mappings.")
            return {"total_published": 0, "status": "no_liquid_constituents"}

        # 4. T5: Synthesize equal-weight daily index series for equal-weight sectors
        # Series written under '<NAME> (EW)'
        equal_weight_keys = {s["key"] for s in SECTORS if s.get("price_source") == "equal_weight"}
        sector_info_by_key = {s["key"]: s for s in SECTORS}

        for eq_key in equal_weight_keys:
            eq_sec_df = df_sec[df_sec["sector"] == eq_key].copy()
            if eq_sec_df.empty:
                continue

            sec_info = sector_info_by_key.get(eq_key, {})
            idx_name = sec_info.get("index_name", f"NIFTY {eq_key.upper()} (EW)")

            daily_agg = eq_sec_df.groupby("trade_date").agg(
                mean_ret=("ret_1d_pct", "mean"),
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
                    cum_close = cum_close * (1.0 + float(m_ret) / 100.0)
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

        # 5. T3: Compute sector breadth metrics with separate denominators
        grouped = df_sec.groupby(["trade_date", "sector"])

        breadth_records = []
        for (trade_date, sector_key), grp in grouped:
            if publish_floor_date and trade_date < publish_floor_date:
                continue

            n_stocks = sector_constituents_count.get(sector_key, len(grp))

            # Separate denominators (T3)
            mask_50 = grp["has_valid_50sma"] == 1 if "has_valid_50sma" in grp.columns else grp["close"].notna()
            mask_200 = grp["has_valid_200sma"] == 1 if "has_valid_200sma" in grp.columns else pd.Series(False, index=grp.index)
            mask_20 = grp["has_valid_20ema"] == 1 if "has_valid_20ema" in grp.columns else pd.Series(False, index=grp.index)

            n_valid_50 = int(mask_50.sum())
            n_valid_200 = int(mask_200.sum())
            n_valid_20 = int(mask_20.sum())

            advances = int(grp["advance"].sum()) if "advance" in grp.columns else int((grp["ret_1d_pct"] > 0).sum())
            declines = int(grp["decline"].sum()) if "decline" in grp.columns else int((grp["ret_1d_pct"] < 0).sum())
            new_52w_highs = int(grp["is_high_52w"].sum()) if "is_high_52w" in grp.columns else 0
            new_52w_lows = int(grp["is_low_52w"].sum()) if "is_low_52w" in grp.columns else 0

            sec_info = sector_info_by_key.get(sector_key, {})
            price_source = sec_info.get("price_source", "official")

            # 50DMA breadth percentage
            if n_valid_50 < MIN_SECTOR_STOCKS:
                pct_above_50dma = None
                ret_1w_ew = None
                ret_1m_ew = None
                ret_3m_ew = None
            else:
                pct_above_50dma = round(float(100.0 * grp.loc[mask_50, "above_50sma"].sum() / n_valid_50), 2) if "above_50sma" in grp.columns else None
                r1w = grp["ret_5d"].dropna()
                ret_1w_ew = round(float(r1w.mean()), 4) if len(r1w) > 0 else None
                r1m = grp["ret_22d"].dropna()
                ret_1m_ew = round(float(r1m.mean()), 4) if len(r1m) > 0 else None
                r3m = grp["ret_64d"].dropna()
                ret_3m_ew = round(float(r3m.mean()), 4) if len(r3m) > 0 else None

            # 200DMA breadth percentage (T3: uses separate denominator n_valid_200)
            if n_valid_200 < MIN_SECTOR_STOCKS:
                pct_above_200dma = None
            else:
                pct_above_200dma = round(float(100.0 * grp.loc[mask_200, "above_200sma"].sum() / n_valid_200), 2) if "above_200sma" in grp.columns else None

            # 20EMA breadth percentage (T3: uses separate denominator n_valid_20)
            if n_valid_20 < MIN_SECTOR_STOCKS:
                pct_above_20ema = None
            else:
                pct_above_20ema = round(float(100.0 * grp.loc[mask_20, "above_20ema"].sum() / n_valid_20), 2) if "above_20ema" in grp.columns else None

            breadth_records.append((
                trade_date,
                sector_key,
                n_stocks,
                n_valid_50,
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
                price_source,
                n_valid_200,
            ))

        if breadth_records:
            with conn.cursor() as cur:
                upsert_breadth_sql = """
                INSERT INTO daily_sector_breadth (
                    trade_date, sector, n_stocks, n_valid,
                    pct_above_50dma, pct_above_200dma, pct_above_20ema,
                    advances, declines, new_52w_highs, new_52w_lows,
                    ret_1w_ew, ret_1m_ew, ret_3m_ew, price_source, n_valid_200
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    price_source = EXCLUDED.price_source,
                    n_valid_200 = EXCLUDED.n_valid_200;
                """
                execute_batch(cur, upsert_breadth_sql, breadth_records, page_size=1000)
            conn.commit()
            logger.info(f"Published {len(breadth_records)} rows to daily_sector_breadth.")

        # 6. T8: Populate per-stock metrics table `sector_stock_metrics` for latest trade date
        all_dates = sorted(df_ind["trade_date"].unique())
        latest_date = all_dates[-1] if all_dates else None

        if latest_date:
            df_latest = df_ind[(df_ind["trade_date"] == latest_date) & df_ind["sector"].notna()].copy()
            if not df_latest.empty:
                # Calculate RS rank over eligible stocks for latest date
                from pipeline.screeners import calculate_rs_rank
                eligible_mask = df_latest["in_universe"] & df_latest["rs_raw"].notna() if "rs_raw" in df_latest.columns else pd.Series(False, index=df_latest.index)
                if "rs_raw" in df_latest.columns:
                    df_latest["rs_rank_calc"] = calculate_rs_rank(df_latest, eligible_mask)
                else:
                    df_latest["rs_rank_calc"] = np.nan

                # Fetch screeners for latest date
                screeners_by_token: Dict[int, List[str]] = {}
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT token, screener FROM daily_screener_results WHERE trade_date = %s;",
                            (latest_date,)
                        )
                        for r in cur.fetchall():
                            if len(r) >= 2:
                                screeners_by_token.setdefault(int(r[0]), []).append(str(r[1]))
                except Exception as e:
                    logger.warning(f"Could not load screeners for latest date: {e}")

                # Fetch company names from instruments
                names_by_symbol: Dict[str, str] = {}
                try:
                    with conn.cursor() as cur:
                        cur.execute("SELECT symbol, name FROM instruments;")
                        for r in cur.fetchall():
                            if len(r) >= 2:
                                names_by_symbol[str(r[0])] = str(r[1])
                except Exception as e:
                    logger.warning(f"Could not load company names: {e}")

                stock_records = []
                for _, row in df_latest.iterrows():
                    tok = int(row["token"]) if pd.notna(row.get("token")) else None
                    if not tok:
                        continue
                    sym = str(row["symbol"])
                    sec = str(row["sector"])
                    nm = names_by_symbol.get(sym, sym)
                    in_univ = bool(row["in_universe"])
                    cls_val = round(float(row["close"]), 2) if pd.notna(row.get("close")) else None

                    r1d = round(float(row["ret_1d_pct"]), 4) if pd.notna(row.get("ret_1d_pct")) else None
                    r1w = round(float(row["ret_5d"]), 4) if pd.notna(row.get("ret_5d")) else None
                    r1m = round(float(row["ret_22d"]), 4) if pd.notna(row.get("ret_22d")) else None
                    r3m = round(float(row["ret_64d"]), 4) if pd.notna(row.get("ret_64d")) else None
                    r6m = round(float(row["ret_126d"]), 4) if pd.notna(row.get("ret_126d")) else None

                    # pct_from_52w_high (<= 0, NULL when no valid 52w)
                    h52 = row.get("high_52w")
                    if pd.notna(h52) and float(h52) > 0 and cls_val is not None:
                        pct_52h = round(float((cls_val - float(h52)) / float(h52) * 100.0), 2)
                        if pct_52h > 0:
                            pct_52h = 0.0
                    else:
                        pct_52h = None

                    # Moving average flags (NULL when MA invalid)
                    ab_20 = bool(row["above_20ema"] == 1) if pd.notna(row.get("above_20ema")) and row.get("has_valid_20ema") == 1 else None
                    ab_50 = bool(row["above_50sma"] == 1) if pd.notna(row.get("above_50sma")) and row.get("has_valid_50sma") == 1 else None
                    ab_200 = bool(row["above_200sma"] == 1) if pd.notna(row.get("above_200sma")) and row.get("has_valid_200sma") == 1 else None

                    # Stage (1-4, NULL if unclassified)
                    stage = None
                    if row.get("stage_2") == 1:
                        stage = 2
                    elif row.get("stage_1") == 1:
                        stage = 1
                    elif row.get("stage_3") == 1:
                        stage = 3
                    elif row.get("stage_4") == 1:
                        stage = 4

                    # Volume ratio (volume / vol_sma_50)
                    vol = row.get("volume")
                    v_sma = row.get("vol_sma_50")
                    if pd.notna(vol) and pd.notna(v_sma) and float(v_sma) > 0:
                        vol_ratio = round(float(vol) / float(v_sma), 2)
                    else:
                        vol_ratio = None

                    # avg_traded_value (close x vol_sma_50)
                    if cls_val is not None and pd.notna(v_sma) and float(v_sma) > 0:
                        avg_traded_val = round(float(cls_val * float(v_sma)), 2)
                    else:
                        avg_traded_val = None

                    # RS rank (1-99, NULL if not eligible)
                    rs_r = row.get("rs_rank_calc")
                    rs_rank_val = int(rs_r) if pd.notna(rs_r) else None

                    # Screeners array
                    scr_list = screeners_by_token.get(tok, [])

                    stock_records.append((
                        latest_date,
                        tok,
                        sym,
                        nm,
                        sec,
                        in_univ,
                        cls_val,
                        r1d,
                        r1w,
                        r1m,
                        r3m,
                        r6m,
                        pct_52h,
                        ab_20,
                        ab_50,
                        ab_200,
                        stage,
                        vol_ratio,
                        avg_traded_val,
                        rs_rank_val,
                        scr_list,
                    ))

                if stock_records:
                    with conn.cursor() as cur:
                        # Replace-on-run: upsert today's rows, delete older dates in same transaction (T8.1)
                        upsert_stock_sql = """
                        INSERT INTO sector_stock_metrics (
                            trade_date, token, symbol, name, sector, in_universe,
                            close, ret_1d, ret_1w, ret_1m, ret_3m, ret_6m,
                            pct_from_52w_high, above_20ema, above_50dma, above_200dma,
                            stage, vol_ratio, avg_traded_value, rs_rank, screeners, updated_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, NOW()
                        ) ON CONFLICT (token) DO UPDATE SET
                            trade_date = EXCLUDED.trade_date,
                            symbol = EXCLUDED.symbol,
                            name = EXCLUDED.name,
                            sector = EXCLUDED.sector,
                            in_universe = EXCLUDED.in_universe,
                            close = EXCLUDED.close,
                            ret_1d = EXCLUDED.ret_1d,
                            ret_1w = EXCLUDED.ret_1w,
                            ret_1m = EXCLUDED.ret_1m,
                            ret_3m = EXCLUDED.ret_3m,
                            ret_6m = EXCLUDED.ret_6m,
                            pct_from_52w_high = EXCLUDED.pct_from_52w_high,
                            above_20ema = EXCLUDED.above_20ema,
                            above_50dma = EXCLUDED.above_50dma,
                            above_200dma = EXCLUDED.above_200dma,
                            stage = EXCLUDED.stage,
                            vol_ratio = EXCLUDED.vol_ratio,
                            avg_traded_value = EXCLUDED.avg_traded_value,
                            rs_rank = EXCLUDED.rs_rank,
                            screeners = EXCLUDED.screeners,
                            updated_at = NOW();
                        """
                        execute_batch(cur, upsert_stock_sql, stock_records, page_size=1000)
                        cur.execute("DELETE FROM sector_stock_metrics WHERE trade_date < %s;", (latest_date,))
                    conn.commit()
                    logger.info(f"Published {len(stock_records)} rows to sector_stock_metrics for date {latest_date}.")

        return {
            "status": "success",
            "total_published": len(breadth_records),
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
