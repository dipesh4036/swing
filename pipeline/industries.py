"""
Industry Rotation pipeline module.
Handles:
- Loading stock_industry 4-level classifications from CSV.
- Syncing daily market cap and issue size from NSE PR bhavcopy zip (stock_mcap).
"""

import os
import io
import csv
import zipfile
import logging
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple

import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

from pipeline.db import get_connection

load_dotenv(".env")
logger = logging.getLogger("pipeline.industries")

PR_PRIMARY_URL = "https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{date_str}.zip"
PR_FALLBACK_URL = "https://archives.nseindia.com/archives/equities/bhavcopy/pr/PR{date_str}.zip"

NSE_ARCHIVE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.nseindia.com/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def download_pr_zip(
    target_date: date,
    timeout: int = 30,
    session: Optional[requests.Session] = None,
) -> Tuple[Optional[bytes], Dict[str, Any]]:
    """
    Downloads the PR<DDMMYY>.zip archive for a target date.
    Tries primary URL then fallback.
    Returns (zip_bytes, meta_dict).
    """
    date_str = target_date.strftime("%d%m%y")
    urls = [
        PR_PRIMARY_URL.format(date_str=date_str),
        PR_FALLBACK_URL.format(date_str=date_str),
    ]

    req = session if session is not None else requests
    last_meta: Dict[str, Any] = {"status_code": 0, "url": "", "bytes": 0}

    for url in urls:
        try:
            logger.info(f"Attempting PR zip download for {target_date} from {url}...")
            resp = req.get(url, headers=NSE_ARCHIVE_HEADERS, timeout=timeout)
            last_meta = {
                "status_code": resp.status_code,
                "url": url,
                "bytes": len(resp.content) if resp.content else 0,
            }
            if resp.status_code == 200:
                logger.info(f"Successfully downloaded PR zip ({len(resp.content)} bytes) from {url}")
                return resp.content, last_meta
            elif resp.status_code == 404:
                continue
            else:
                logger.warning(f"Unexpected status code {resp.status_code} from {url}")
        except Exception as e:
            logger.warning(f"Failed to fetch {url}: {e}")
            last_meta["error"] = str(e)

    return None, last_meta


def sync_stock_mcap(
    target_date: Optional[date] = None,
    conn=None,
    session: Optional[requests.Session] = None,
) -> Dict[str, Any]:
    """
    Step 6b: Syncs latest market cap and issue size into stock_mcap table.
    Non-fatal: returns degraded status on failure without breaking the pipeline.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # Determine candidate dates (target date or search back up to 5 days)
        if target_date is None:
            ist = timezone(timedelta(hours=5, minutes=30))
            candidate_date = datetime.now(ist).date()
        else:
            candidate_date = target_date

        zip_bytes = None
        meta = None
        found_date = None

        for i in range(5):
            d = candidate_date - timedelta(days=i)
            zb, m = download_pr_zip(d, session=session)
            if zb is not None:
                zip_bytes = zb
                meta = m
                found_date = d
                break

        if zip_bytes is None:
            logger.warning(f"Could not download PR zip for {candidate_date} or prior 5 days. Keeping previous stock_mcap values.")
            return {"status": "degraded", "reason": "PR zip not available", "date": None, "rows": 0}

        # Parse MCAP csv from zip
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            mcap_name = None
            for name in zf.namelist():
                if "MCAP" in name.upper() and name.upper().endswith(".CSV"):
                    mcap_name = name
                    break

            if not mcap_name:
                logger.warning(f"No MCAP CSV member found in PR zip {found_date}.")
                return {"status": "degraded", "reason": "No MCAP CSV in zip", "date": str(found_date), "rows": 0}

            with zf.open(mcap_name) as mf:
                content = mf.read().decode("utf-8", errors="replace")
                reader = csv.reader(io.StringIO(content))
                rows = list(reader)

        if not rows:
            return {"status": "degraded", "reason": "Empty MCAP CSV", "date": str(found_date), "rows": 0}

        header = [c.strip().upper() for c in rows[0]]
        # Find column indices
        sym_idx = None
        ser_idx = None
        iss_idx = None
        cls_idx = None
        mcap_idx = None
        date_idx = None

        for idx, h in enumerate(header):
            if h == "SYMBOL":
                sym_idx = idx
            elif "SERIES" in h:
                ser_idx = idx
            elif "ISSUE" in h or "SIZE" in h:
                iss_idx = idx
            elif "CLOSE" in h:
                cls_idx = idx
            elif "CAP" in h:
                mcap_idx = idx
            elif "TRADE" in h and "DATE" in h:
                date_idx = idx

        if sym_idx is None or ser_idx is None or mcap_idx is None:
            logger.warning(f"Missing required columns in MCAP CSV. Header: {header}")
            return {"status": "degraded", "reason": f"Unexpected header: {header}", "date": str(found_date), "rows": 0}

        records_to_upsert = []
        for r in rows[1:]:
            if len(r) <= max(sym_idx, ser_idx, mcap_idx):
                continue
            sym = r[sym_idx].strip()
            ser = r[ser_idx].strip()

            # Keep series EQ and BE
            if ser not in ("EQ", "BE"):
                continue

            try:
                iss_sz = int(float(r[iss_idx].replace(",", "").strip())) if iss_idx is not None and r[iss_idx].strip() else None
            except Exception:
                iss_sz = None

            try:
                cls_val = float(r[cls_idx].replace(",", "").strip()) if cls_idx is not None and r[cls_idx].strip() else None
            except Exception:
                cls_val = None

            try:
                mcap_val = float(r[mcap_idx].replace(",", "").strip()) if r[mcap_idx].strip() else None
            except Exception:
                mcap_val = None

            records_to_upsert.append((
                sym,
                found_date,
                ser,
                iss_sz,
                mcap_val,
                cls_val,
            ))

        if not records_to_upsert:
            logger.warning("No valid EQ/BE records found in MCAP CSV.")
            return {"status": "degraded", "reason": "No EQ/BE rows parsed", "date": str(found_date), "rows": 0}

        upsert_sql = """
            INSERT INTO stock_mcap (symbol, trade_date, series, issue_size, mcap_rs, close)
            VALUES %s
            ON CONFLICT (symbol) DO UPDATE SET
                trade_date = EXCLUDED.trade_date,
                series = EXCLUDED.series,
                issue_size = EXCLUDED.issue_size,
                mcap_rs = EXCLUDED.mcap_rs,
                close = EXCLUDED.close,
                updated_at = NOW();
        """
        with conn.cursor() as cur:
            execute_values(cur, upsert_sql, records_to_upsert, page_size=1000)
        conn.commit()

        logger.info(f"Successfully upserted {len(records_to_upsert)} stock_mcap rows for date {found_date}.")
        return {
            "status": "success",
            "trade_date": str(found_date),
            "rows_upserted": len(records_to_upsert),
        }
    except Exception as e:
        logger.error(f"Error in sync_stock_mcap: {e}", exc_info=True)
        return {"status": "degraded", "error": str(e)}
    finally:
        if should_close and conn:
            conn.close()


def load_industry_map(
    csv_path: str = "data/industry_map.csv",
    conn=None,
) -> Dict[str, Any]:
    """
    Loads data/industry_map.csv into stock_industry table.
    Validates the 4 fields non-empty and prints counts per sector and distinct basic industries.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Industry map file '{csv_path}' not found.")

    valid_records = []
    skipped_count = 0

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            sym = r.get("symbol", "").strip()
            macro = r.get("macro", "").strip()
            sector = r.get("sector", "").strip()
            industry = r.get("industry", "").strip()
            basic = r.get("basic_industry", "").strip()
            fetched_at_str = r.get("fetched_at", "").strip()

            if not sym or not macro or not sector or not industry or not basic:
                skipped_count += 1
                continue

            fetched_at = datetime.fromisoformat(fetched_at_str) if fetched_at_str else datetime.now(timezone.utc)
            valid_records.append((sym, macro, sector, industry, basic, "nse_quote", fetched_at))

    if not valid_records:
        raise ValueError(f"No valid 4-level industry records found in '{csv_path}'. Skipped: {skipped_count}")

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        upsert_sql = """
            INSERT INTO stock_industry (symbol, macro, sector, industry, basic_industry, source, fetched_at)
            VALUES %s
            ON CONFLICT (symbol) DO UPDATE SET
                macro = EXCLUDED.macro,
                sector = EXCLUDED.sector,
                industry = EXCLUDED.industry,
                basic_industry = EXCLUDED.basic_industry,
                source = EXCLUDED.source,
                fetched_at = EXCLUDED.fetched_at;
        """
        with conn.cursor() as cur:
            execute_values(cur, upsert_sql, valid_records, page_size=1000)

            # Query sector counts and distinct basic industries
            cur.execute("""
                SELECT sector, count(*) 
                FROM stock_industry 
                GROUP BY 1 
                ORDER BY 2 DESC;
            """)
            sector_counts = cur.fetchall()

            cur.execute("SELECT count(DISTINCT basic_industry) FROM stock_industry;")
            distinct_basic = cur.fetchone()[0]

            cur.execute("SELECT count(DISTINCT sector) FROM stock_industry;")
            distinct_sectors = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM stock_industry;")
            total_loaded = cur.fetchone()[0]

        conn.commit()

        print("\n" + "=" * 65)
        print("STOCK INDUSTRY CLASSIFICATION SUMMARY")
        print("=" * 65)
        print(f"Total Symbols in DB: {total_loaded}")
        print(f"Distinct Sectors: {distinct_sectors}")
        print(f"Distinct Basic Industries: {distinct_basic}")
        print(f"Records loaded from CSV: {len(valid_records)} (skipped: {skipped_count})")
        print("\nSector Breakdown:")
        print(f"{'Sector':<40} {'Stock Count':>12}")
        print("-" * 55)
        for sec, cnt in sector_counts:
            print(f"{sec:<40} {cnt:>12}")
        print("=" * 65 + "\n")

        return {
            "status": "success",
            "total_loaded": total_loaded,
            "distinct_sectors": distinct_sectors,
            "distinct_basic_industries": distinct_basic,
            "sector_counts": dict(sector_counts),
        }
    finally:
        if should_close and conn:
            conn.close()
