import io
import csv
import json
import logging
from datetime import date
from typing import Dict, List, Any, Optional
import requests
import pandas as pd
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.instruments")

ANGEL_SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
NSE_EQUITY_L_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

NIFTY_INDICES = {
    "nifty500": "https://niftyindices.com/IndexConstituent/ind_nifty500list.csv",
    "nifty200": "https://niftyindices.com/IndexConstituent/ind_nifty200list.csv",
    "nifty100": "https://niftyindices.com/IndexConstituent/ind_nifty100list.csv",
    "nifty_midcap150": "https://niftyindices.com/IndexConstituent/ind_niftymidcap150list.csv",
    "nifty_smallcap250": "https://niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv",
}

def sync_instruments(conn=None) -> int:
    """
    Downloads Angel One Scrip Master and NSE EQUITY_L.csv, matches active INE EQ/BE stocks,
    and upserts into the `instruments` table in Neon PostgreSQL.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        logger.info("Downloading NSE EQUITY_L.csv...")
        headers = {"User-Agent": "Mozilla/5.0"}
        resp_nse = requests.get(NSE_EQUITY_L_URL, headers=headers, timeout=30)
        resp_nse.raise_for_status()
        df_nse = pd.read_csv(io.StringIO(resp_nse.text))
        df_nse.columns = [c.strip() for c in df_nse.columns]
        # Filter EQ and BE series with INE prefix ISIN
        df_nse = df_nse[df_nse["SERIES"].isin(["EQ", "BE"]) & df_nse["ISIN NUMBER"].str.startswith("INE")]
        nse_symbols = set(df_nse["SYMBOL"].str.strip())
        nse_isin_map = dict(zip(df_nse["SYMBOL"].str.strip(), df_nse["ISIN NUMBER"].str.strip()))
        nse_name_map = dict(zip(df_nse["SYMBOL"].str.strip(), df_nse["NAME OF COMPANY"].str.strip()))
        logger.info(f"Loaded {len(nse_symbols)} active NSE equity instruments from EQUITY_L.csv.")

        logger.info("Downloading Angel One Scrip Master...")
        resp_scrip = requests.get(ANGEL_SCRIP_MASTER_URL, timeout=60)
        resp_scrip.raise_for_status()
        scrips = resp_scrip.json()

        # Scrips on NSE equity segment
        matched_records = []
        seen_tokens = set()
        for s in scrips:
            if s.get("exch_seg") != "NSE":
                continue
            sym = s.get("symbol", "")
            if not (sym.endswith("-EQ") or sym.endswith("-BE")):
                continue
            base_sym = sym.rsplit("-", 1)[0]
            if base_sym not in nse_symbols:
                continue
            
            token = int(s["token"])
            if token in seen_tokens:
                continue
            seen_tokens.add(token)

            isin = nse_isin_map.get(base_sym)
            name = nse_name_map.get(base_sym) or s.get("name", "").strip()
            instrument_type = sym.rsplit("-", 1)[1]
            tick_size = float(s.get("tick_size", 0.05)) if s.get("tick_size") else 0.05
            lot_size = int(s.get("lotsize", 1)) if s.get("lotsize") else 1

            matched_records.append((
                token, base_sym, name, isin, "NSE", instrument_type, tick_size, lot_size, True, True
            ))

        logger.info(f"Matched {len(matched_records)} instruments between NSE and Angel One.")

        with conn.cursor() as cur:
            insert_sql = """
            INSERT INTO instruments (token, symbol, name, isin, exchange, instrument_type, tick_size, lot_size, is_active, is_traded, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (token) DO UPDATE SET
                symbol = EXCLUDED.symbol,
                name = EXCLUDED.name,
                isin = EXCLUDED.isin,
                instrument_type = EXCLUDED.instrument_type,
                tick_size = EXCLUDED.tick_size,
                lot_size = EXCLUDED.lot_size,
                is_active = EXCLUDED.is_active,
                is_traded = EXCLUDED.is_traded,
                updated_at = NOW();
            """
            from psycopg2.extras import execute_batch
            execute_batch(cur, insert_sql, matched_records, page_size=1000)
        conn.commit()
        logger.info(f"Successfully upserted {len(matched_records)} instruments into Neon DB.")
        return len(matched_records)
    finally:
        if should_close:
            conn.close()

def sync_constituents(effective_date: Optional[date] = None, conn=None) -> Dict[str, int]:
    """
    Downloads Nifty 500, 200, 100, Midcap 150, Smallcap 250 constituents.
    Diffs against previous active snapshot and maintains effective_from / effective_to versioning.
    Removed stocks have effective_to set to eff_date and is_active set to False.
    New stocks are inserted with effective_from = eff_date and is_active = True.
    """
    eff_date = effective_date or date.today()
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    results = {}
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        with conn.cursor() as cur:
            for idx_name, url in NIFTY_INDICES.items():
                try:
                    logger.info(f"Fetching constituents for {idx_name} from {url}...")
                    resp = requests.get(url, headers=headers, timeout=20)
                    resp.raise_for_status()
                    df = pd.read_csv(io.StringIO(resp.text))
                    df.columns = [c.strip() for c in df.columns]

                    # Find Symbol and ISIN columns
                    sym_col = next((c for c in df.columns if c.lower() == "symbol"), None)
                    isin_col = next((c for c in df.columns if c.lower() == "isin"), None)

                    if not sym_col:
                        logger.warning(f"Could not find Symbol column in {idx_name} CSV.")
                        continue

                    new_symbols_map = {}
                    for _, row in df.iterrows():
                        sym = str(row[sym_col]).strip()
                        isin = str(row[isin_col]).strip() if isin_col and pd.notna(row[isin_col]) else None
                        if sym:
                            new_symbols_map[sym] = isin

                    new_symbols = set(new_symbols_map.keys())

                    # Query currently active symbols from index_constituents
                    cur.execute("""
                        SELECT symbol FROM index_constituents
                        WHERE index_name = %s AND (is_active = TRUE OR effective_to IS NULL);
                    """, (idx_name,))
                    existing_active = {r[0] for r in cur.fetchall()}

                    if not existing_active:
                        # Initial baseline load for this universe (effective from start of history)
                        logger.info(f"Initial constituents load for {idx_name}: {len(new_symbols)} symbols.")
                        insert_records = [
                            (idx_name, sym, new_symbols_map.get(sym), eff_date, date(2000, 1, 1), None, True)
                            for sym in new_symbols
                        ]
                        insert_sql = """
                            INSERT INTO index_constituents (
                                index_name, symbol, isin, effective_date, effective_from, effective_to, is_active
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (index_name, symbol, effective_date) DO UPDATE
                            SET is_active = TRUE, effective_to = NULL;
                        """
                        from psycopg2.extras import execute_batch
                        execute_batch(cur, insert_sql, insert_records, page_size=500)
                        results[idx_name] = len(insert_records)
                    else:
                        # Diff against current snapshot
                        added = new_symbols - existing_active
                        removed = existing_active - new_symbols
                        unchanged = new_symbols & existing_active

                        logger.info(f"{idx_name} diff: {len(unchanged)} unchanged, {len(added)} added, {len(removed)} removed.")

                        # Mark removed symbols as expired
                        if removed:
                            cur.execute("""
                                UPDATE index_constituents
                                SET effective_to = %s, is_active = FALSE
                                WHERE index_name = %s AND symbol = ANY(%s) AND is_active = TRUE;
                            """, (eff_date, idx_name, list(removed)))
                            logger.info(f"Marked {len(removed)} removed symbols as expired (effective_to={eff_date}).")

                        # Insert added symbols
                        if added:
                            insert_records = [
                                (idx_name, sym, new_symbols_map.get(sym), eff_date, eff_date, None, True)
                                for sym in added
                            ]
                            insert_sql = """
                                INSERT INTO index_constituents (
                                    index_name, symbol, isin, effective_date, effective_from, effective_to, is_active
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s)
                                ON CONFLICT (index_name, symbol, effective_date) DO UPDATE
                                SET is_active = TRUE, effective_from = EXCLUDED.effective_from, effective_to = NULL;
                            """
                            from psycopg2.extras import execute_batch
                            execute_batch(cur, insert_sql, insert_records, page_size=500)
                            logger.info(f"Inserted {len(added)} new active constituents.")

                        results[idx_name] = len(new_symbols)

                except Exception as e:
                    logger.error(f"Error syncing constituents for {idx_name}: {e}")
        conn.commit()
        return results
    finally:
        if should_close:
            conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sync_instruments()
    sync_constituents()
