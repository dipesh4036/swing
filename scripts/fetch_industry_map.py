#!/usr/bin/env python3
"""
Fetch NSE 4-level industry classification map.
Tab 3: Industry Rotation (I1).
Manual runner: Mac-only, never in CI, never in pipeline.

Polite:
- User-Agent: swing-personal-research/1.0
- 2.5s delay between requests
- Home-page cookie refresh every 200 requests
- Resumable: skips symbols already present in data/industry_map.csv or data/industry_unmapped.csv
- Checkpoint every 25 symbols
- STOP at first 403/429 immediately
"""

import os
import sys
import time
import csv
import random
import argparse
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from typing import Dict, Any, List, Optional, Set, Tuple

import requests
from dotenv import load_dotenv

load_dotenv(".env")

# Paths
MAP_CSV_PATH = "data/industry_map.csv"
UNMAPPED_CSV_PATH = "data/industry_unmapped.csv"

# Request config
DELAY_SECONDS = 2.5
COOKIE_REFRESH_INTERVAL = 200
USER_AGENT = "swing-personal-research/1.0"

BASE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def refresh_home_cookies(session: requests.Session) -> bool:
    """Visits the NSE homepage to establish/refresh session cookies."""
    try:
        url = "https://www.nseindia.com/"
        resp = session.get(url, headers=BASE_HEADERS, timeout=15)
        if resp.status_code == 200:
            return True
        elif resp.status_code in (403, 429):
            print(f"\n[BLOCKED] HTTP {resp.status_code} during home-page cookie refresh.")
            return False
        else:
            print(f"\n[WARN] Home-page cookie refresh status: {resp.status_code}")
            return False
    except Exception as e:
        print(f"\n[ERROR] Home-page cookie refresh failed: {e}")
        return False


def get_symbols_to_fetch(include_be: bool = True) -> List[Dict[str, str]]:
    """
    Retrieves NSE symbols from DB instruments that have a close in the last 30 days.
    Returns list of dicts with 'symbol', 'instrument_type', 'name'.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL is not set.")

    import psycopg2
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            allowed_types = ("EQ", "BE") if include_be else ("EQ",)
            cur.execute("""
                SELECT symbol, instrument_type, name 
                FROM instruments 
                WHERE exchange = 'NSE' AND instrument_type IN %s
                ORDER BY symbol;
            """, (allowed_types,))
            rows = cur.fetchall()
            instruments_map = {r[0]: {"symbol": r[0], "instrument_type": r[1], "name": r[2]} for r in rows}
    finally:
        conn.close()

    # Filter to those with a close in last 30 days of data
    active_symbols = set()
    parquet_path = "data/equity_ohlcv.parquet"
    if os.path.exists(parquet_path):
        try:
            import pandas as pd
            df_pq = pd.read_parquet(parquet_path, columns=["symbol", "trade_date"])
            if not df_pq.empty:
                max_d = df_pq["trade_date"].max()
                min_30d = (pd.to_datetime(max_d) - pd.Timedelta(days=30)).strftime("%Y-%m-%d")
                active_symbols = set(df_pq[df_pq["trade_date"] >= min_30d]["symbol"].dropna().unique())
        except Exception as e:
            print(f"[WARN] Parquet read error: {e}. Falling back to DB.")

    if not active_symbols:
        # Fallback to DB
        active_symbols = set(instruments_map.keys())

    candidate_symbols = [
        instruments_map[s] for s in sorted(active_symbols)
        if s in instruments_map
    ]
    return candidate_symbols


def load_existing_progress() -> Tuple[Set[str], Set[str]]:
    """Loads already mapped and unmapped symbols from CSV files."""
    mapped: Set[str] = set()
    unmapped: Set[str] = set()

    if os.path.exists(MAP_CSV_PATH):
        try:
            with open(MAP_CSV_PATH, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    sym = r.get("symbol", "").strip()
                    if sym:
                        mapped.add(sym)
        except Exception as e:
            print(f"[WARN] Error reading {MAP_CSV_PATH}: {e}")

    if os.path.exists(UNMAPPED_CSV_PATH):
        try:
            with open(UNMAPPED_CSV_PATH, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for r in reader:
                    sym = r.get("symbol", "").strip()
                    if sym:
                        unmapped.add(sym)
        except Exception as e:
            print(f"[WARN] Error reading {UNMAPPED_CSV_PATH}: {e}")

    return mapped, unmapped


def append_checkpoint(
    mapped_records: List[Dict[str, Any]],
    unmapped_records: List[Dict[str, Any]],
):
    """Flushes buffered records to disk."""
    os.makedirs(os.path.dirname(MAP_CSV_PATH), exist_ok=True)

    if mapped_records:
        file_exists = os.path.exists(MAP_CSV_PATH) and os.path.getsize(MAP_CSV_PATH) > 0
        with open(MAP_CSV_PATH, "a", newline="", encoding="utf-8") as f:
            fieldnames = ["symbol", "macro", "sector", "industry", "basic_industry", "fetched_at"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            for r in mapped_records:
                writer.writerow(r)
            f.flush()
        mapped_records.clear()

    if unmapped_records:
        file_exists = os.path.exists(UNMAPPED_CSV_PATH) and os.path.getsize(UNMAPPED_CSV_PATH) > 0
        with open(UNMAPPED_CSV_PATH, "a", newline="", encoding="utf-8") as f:
            fieldnames = ["symbol", "reason", "fetched_at"]
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            for r in unmapped_records:
                writer.writerow(r)
            f.flush()
        unmapped_records.clear()


def fetch_symbol_industry(
    session: requests.Session,
    symbol: str,
    series: str = "EQ",
) -> Tuple[int, Optional[Dict[str, str]], Optional[str]]:
    """
    Fetches industry classification for a symbol.
    Returns (status_code, dict_of_4_fields or None, reason or None).
    """
    enc_sym = quote(symbol, safe="")
    api_hdrs = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.nseindia.com/get-quotes/equity?symbol={enc_sym}",
        "X-Requested-With": "XMLHttpRequest",
    }

    # 1. Primary endpoint
    url1 = f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series={series}&symbol={enc_sym}"
    try:
        resp = session.get(url1, headers=api_hdrs, timeout=12)
        st = resp.status_code
        if st in (403, 429):
            return st, None, "BLOCKED"
        if st == 200:
            data = resp.json()
            eq_resp = data.get("equityResponse", [])
            sec_info = eq_resp[0].get("secInfo") if eq_resp else None
            if sec_info and isinstance(sec_info, dict):
                macro = str(sec_info.get("macro") or "").strip()
                sector = str(sec_info.get("sector") or "").strip()
                ind = str(sec_info.get("industryInfo") or sec_info.get("industry") or "").strip()
                basic = str(sec_info.get("basicIndustry") or "").strip()
                if macro and sector and ind and basic:
                    return 200, {
                        "macro": macro,
                        "sector": sector,
                        "industry": ind,
                        "basic_industry": basic,
                    }, None
    except Exception as e:
        return 0, None, f"request_error: {e}"

    # If series is not EQ or secInfo was empty, try series=EQ if we tried something else
    if series != "EQ":
        time.sleep(1.0)
        url1_eq = f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol={enc_sym}"
        try:
            resp = session.get(url1_eq, headers=api_hdrs, timeout=12)
            st = resp.status_code
            if st in (403, 429):
                return st, None, "BLOCKED"
            if st == 200:
                data = resp.json()
                eq_resp = data.get("equityResponse", [])
                sec_info = eq_resp[0].get("secInfo") if eq_resp else None
                if sec_info and isinstance(sec_info, dict):
                    macro = str(sec_info.get("macro") or "").strip()
                    sector = str(sec_info.get("sector") or "").strip()
                    ind = str(sec_info.get("industryInfo") or sec_info.get("industry") or "").strip()
                    basic = str(sec_info.get("basicIndustry") or "").strip()
                    if macro and sector and ind and basic:
                        return 200, {
                            "macro": macro,
                            "sector": sector,
                            "industry": ind,
                            "basic_industry": basic,
                        }, None
        except Exception:
            pass

    # If not found or secInfo missing in GetQuoteApi, mark as unmapped
    return 200, None, "missing_secInfo"


def main():
    parser = argparse.ArgumentParser(description="Fetch NSE 4-level industry classification map")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of symbols to fetch (for gate test)")
    parser.add_argument("--seed", type=int, default=42, help="Seed for random sample when limit is used (default: 42)")
    parser.add_argument("--new-only", action="store_true", help="Skip symbols already present in CSVs")
    parser.add_argument("--no-be", action="store_true", help="Exclude BE series symbols (fetch EQ only)")
    parser.add_argument("--checkpoint-interval", type=int, default=25, help="Flush to CSV every N symbols (default: 25)")
    parser.add_argument("--batch-size", type=int, default=500, help="Number of symbols per batch before taking a rest (default: 500)")
    parser.add_argument("--batch-rest", type=int, default=300, help="Rest duration in seconds between batches (default: 300)")
    args = parser.parse_args()

    print("=" * 65)
    print("NSE INDUSTRY MAPPER — RESUMABLE FETCHER")
    print(f"Delay: {DELAY_SECONDS}s | Seed: {args.seed} | Limit: {args.limit} | New-only: {args.new_only}")
    print("=" * 65)

    all_candidates = get_symbols_to_fetch(include_be=not args.no_be)
    print(f"Discovered {len(all_candidates)} eligible active NSE equity symbols in instruments.")

    mapped_existing, unmapped_existing = load_existing_progress()
    already_done = mapped_existing.union(unmapped_existing)
    print(f"Existing progress: {len(mapped_existing)} mapped, {len(unmapped_existing)} unmapped ({len(already_done)} total).")

    # Determine symbols queue
    if args.new_only:
        queue = [item for item in all_candidates if item["symbol"] not in already_done]
    else:
        queue = list(all_candidates)

    # When limit is specified (Gate test), pick a seeded random sample across the list
    if args.limit is not None and args.limit < len(queue):
        rng = random.Random(args.seed)
        queue = rng.sample(queue, args.limit)
        print(f"Seeded random sample selected: {len(queue)} symbols (seed={args.seed}).")

    if not queue:
        print("No symbols left to fetch. Everything is up to date!")
        return

    # Session setup
    session = requests.Session()
    print("Visiting NSE homepage to receive session cookies...")
    if not refresh_home_cookies(session):
        print("Could not obtain session cookies. Halting.")
        sys.exit(1)

    mapped_buffer: List[Dict[str, Any]] = []
    unmapped_buffer: List[Dict[str, Any]] = []

    status_counts: Dict[int, int] = {}
    sample_symbols_for_report: List[Dict[str, Any]] = []
    total_to_run = len(queue)
    start_time = time.time()
    req_counter = 0

    session_mapped = 0
    session_unmapped = 0

    try:
        for idx, item in enumerate(queue, 1):
            sym = item["symbol"]
            ser = item["instrument_type"] or "EQ"

            # Skip if already done
            if sym in already_done and args.new_only:
                continue

            time.sleep(DELAY_SECONDS)
            req_counter += 1

            # Check if batch rest is due
            if args.batch_size > 0 and req_counter % args.batch_size == 0 and idx < total_to_run:
                append_checkpoint(mapped_buffer, unmapped_buffer)
                print(f"\n[BATCH REST] Completed batch of {args.batch_size} requests. Resting for {args.batch_rest}s ({args.batch_rest/60.0:.1f} min)...")
                time.sleep(args.batch_rest)
                print("[BATCH RESUME] Rest complete. Refreshing session cookies...")
                if not refresh_home_cookies(session):
                    print("[STOP] Cookie refresh failed or was blocked after rest. Halting.")
                    break
            elif req_counter % COOKIE_REFRESH_INTERVAL == 0:
                # Refresh home cookies every 200 requests within a batch
                print(f"[COOKIE] Refreshing home session cookies at request #{req_counter}...")
                if not refresh_home_cookies(session):
                    print("[STOP] Cookie refresh failed or was blocked. Halting.")
                    break

            status, fields, reason = fetch_symbol_industry(session, sym, series=ser)
            status_counts[status] = status_counts.get(status, 0) + 1
            now_iso = datetime.now(timezone.utc).isoformat()

            if status in (403, 429):
                print(f"\n[BLOCKED] Received HTTP {status} for {sym}!")
                print(f"Progress is preserved. To resume, run:")
                print(f"  python scripts/fetch_industry_map.py --new-only")
                append_checkpoint(mapped_buffer, unmapped_buffer)
                sys.exit(1)

            if fields is not None:
                session_mapped += 1
                rec = {
                    "symbol": sym,
                    "macro": fields["macro"],
                    "sector": fields["sector"],
                    "industry": fields["industry"],
                    "basic_industry": fields["basic_industry"],
                    "fetched_at": now_iso,
                }
                mapped_buffer.append(rec)
                already_done.add(sym)

                # Collect for gate report if interesting type
                if len(sample_symbols_for_report) < 15:
                    sample_symbols_for_report.append({
                        "symbol": sym,
                        "type": ser,
                        "name": item.get("name", sym),
                        **fields,
                    })
            else:
                session_unmapped += 1
                unmap_rec = {
                    "symbol": sym,
                    "reason": reason or f"http_{status}",
                    "fetched_at": now_iso,
                }
                unmapped_buffer.append(unmap_rec)
                already_done.add(sym)

            # Checkpoint every 25
            if idx % args.checkpoint_interval == 0 or idx == total_to_run:
                append_checkpoint(mapped_buffer, unmapped_buffer)
                elapsed = time.time() - start_time
                print(f"[{idx:>4}/{total_to_run}] Mapped: {session_mapped:<4} | Unmapped: {session_unmapped:<3} | Elapsed: {elapsed:.1f}s | Latest: {sym} ({status})")

    except KeyboardInterrupt:
        print("\n[INTERRUPTED] Saving checkpoint before exiting...")
    finally:
        append_checkpoint(mapped_buffer, unmapped_buffer)

    total_time = time.time() - start_time
    total_processed = session_mapped + session_unmapped
    mapped_pct = (session_mapped / total_processed * 100.0) if total_processed > 0 else 0.0

    print("\n" + "=" * 65)
    print("FETCH COMPLETE / GATE SUMMARY")
    print("=" * 65)
    print(f"Total Processed in this run: {total_processed}")
    print(f"Mapped: {session_mapped} ({mapped_pct:.2f}%)")
    print(f"Unmapped: {session_unmapped}")
    print(f"HTTP Status Codes: {dict(status_counts)}")
    print(f"Any 403 / 429: {'YES - BLOCKED' if (403 in status_counts or 429 in status_counts) else 'NO'}")
    print(f"Total Elapsed Time: {total_time:.1f}s ({total_time/60.0:.1f}m)")
    print("=" * 65)

    if sample_symbols_for_report:
        print("\nSample Mapped Symbols Across Different Types:")
        print(f"{'Symbol':<12} {'Type':<6} {'Macro':<20} {'Sector':<20} {'Industry':<20} {'Basic Industry'}")
        print("-" * 105)
        for s in sample_symbols_for_report[:8]:
            print(f"{s['symbol']:<12} {s['type']:<6} {s['macro']:<20} {s['sector']:<20} {s['industry']:<20} {s['basic_industry']}")


if __name__ == "__main__":
    main()
