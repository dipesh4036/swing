import os
import sys
import time
import logging
from datetime import datetime, timedelta, date
from typing import List, Dict, Any, Optional, Set
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pipeline.config import RETENTION_YEARS, EQUITY_PARQUET_PATH
from pipeline.db import get_connection
from pipeline.smartapi_client import SmartAPIClient

logger = logging.getLogger("pipeline.ingest")

def load_target_instruments(conn=None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Returns the list of active instruments to ingest (Nifty 500 first, then remaining liquid/traded).
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            query = """
            SELECT i.token, i.symbol,
                   MIN(CASE WHEN ic.index_name = 'nifty500' THEN 0 ELSE 1 END) AS priority
            FROM instruments i
            LEFT JOIN index_constituents ic ON i.symbol = ic.symbol
            WHERE i.is_active = TRUE
            GROUP BY i.token, i.symbol
            ORDER BY priority, i.symbol
            """
            if limit:
                query += f" LIMIT {int(limit)}"
            cur.execute(query)
            rows = cur.fetchall()
            return [{"token": r[0], "symbol": r[1]} for r in rows]
    finally:
        if should_close:
            conn.close()

def log_ingest_run(
    run_type: str,
    status: str,
    total: int,
    success: int,
    failed: int,
    started_at: datetime,
    error_msg: Optional[str] = None,
    quality_gate_passed: bool = True,
    conn=None
) -> int:
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute("""
            INSERT INTO ingest_runs (
                run_type, started_at, completed_at, status, instruments_total,
                instruments_success, instruments_failed, quality_gate_passed, error_message
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING run_id;
            """, (run_type, started_at, datetime.now(), status, total, success, failed, quality_gate_passed, error_msg))
            run_id = cur.fetchone()[0]
        conn.commit()
        return run_id
    finally:
        if should_close:
            conn.close()

def fetch_equity_candles(
    client: SmartAPIClient,
    token: int,
    symbol: str,
    from_date_str: str,
    to_date_str: str
) -> List[Dict[str, Any]]:
    candles = client.get_candle_data(
        exchange="NSE",
        symbol_token=str(token),
        interval="ONE_DAY",
        from_date=from_date_str,
        to_date=to_date_str
    )
    if not candles:
        return []

    records = []
    for c in candles:
        t_date = c[0].split("T")[0]
        o = float(c[1])
        h = float(c[2])
        l = float(c[3])
        cl = float(c[4])
        v = int(c[5]) if len(c) > 5 and c[5] is not None else 0
        records.append({
            "token": int(token),
            "symbol": str(symbol),
            "trade_date": t_date,
            "open": o,
            "high": h,
            "low": l,
            "close": cl,
            "volume": v,
            "traded_val": cl * v
        })
    return records

def ingest_equities(
    client: Optional[SmartAPIClient] = None,
    tokens_limit: Optional[int] = None,
    years: int = RETENTION_YEARS,
    parquet_path: str = EQUITY_PARQUET_PATH,
    batch_save_size: int = 50
) -> Dict[str, Any]:
    """
    Ingests daily equity candles for all target instruments.
    Supports incremental update or backfill.
    Saves to parquet atomically.
    """
    started_at = datetime.now()
    created_client = False
    if client is None:
        client = SmartAPIClient()
        created_client = True

    instruments = load_target_instruments(limit=tokens_limit)
    total_inst = len(instruments)
    logger.info(f"Target instruments for ingest: {total_inst}")

    os.makedirs(os.path.dirname(os.path.abspath(parquet_path)), exist_ok=True)
    
    # Check existing data
    existing_df = None
    existing_tokens = set()
    if os.path.exists(parquet_path):
        try:
            existing_df = pd.read_parquet(parquet_path)
            existing_tokens = set(existing_df["token"].unique())
            logger.info(f"Loaded existing parquet with {len(existing_df)} rows across {len(existing_tokens)} tokens.")
        except Exception as e:
            logger.warning(f"Could not read existing parquet: {e}. Starting fresh.")

    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365 + 30)
    from_date_str = start_date.strftime("%Y-%m-%d 00:00")
    to_date_str = end_date.strftime("%Y-%m-%d 23:59")

    new_records = []
    success_count = 0
    fail_count = 0

    all_dfs = [existing_df] if existing_df is not None and not existing_df.empty else []

    try:
        for idx, inst in enumerate(instruments, 1):
            tok = inst["token"]
            sym = inst["symbol"]
            
            # If already in existing parquet with sufficient sessions, we only need incremental 10 sessions
            # For backfill of missing tokens, fetch full window
            if existing_df is not None and tok in existing_tokens:
                # 15 days lookback for incremental & Case A check
                inc_start = (end_date - timedelta(days=20)).strftime("%Y-%m-%d 00:00")
                candles = fetch_equity_candles(client, tok, sym, inc_start, to_date_str)
            else:
                candles = fetch_equity_candles(client, tok, sym, from_date_str, to_date_str)

            if candles:
                new_records.extend(candles)
                success_count += 1
            else:
                fail_count += 1

            if idx % 10 == 0 or idx == total_inst:
                logger.info(f"Progress: {idx}/{total_inst} instruments processed ({success_count} success, {fail_count} failed).")

            # Intermediate save every batch_save_size
            if len(new_records) >= batch_save_size * 500 or (idx == total_inst and new_records):
                batch_df = pd.DataFrame(new_records)
                all_dfs.append(batch_df)
                combined = pd.concat(all_dfs, ignore_index=True)
                # Deduplicate by token and trade_date (keep latest)
                combined.drop_duplicates(subset=["token", "trade_date"], keep="last", inplace=True)
                combined.sort_values(by=["token", "trade_date"], inplace=True)
                
                temp_path = f"{parquet_path}.tmp"
                combined.to_parquet(temp_path, index=False, compression="snappy")
                os.replace(temp_path, parquet_path)
                logger.info(f"Saved checkpoint: {len(combined)} rows in {parquet_path}.")
                
                all_dfs = [combined]
                new_records = []

        status = "success" if success_count > 0 else "failed"
        log_ingest_run("equities", status, total_inst, success_count, fail_count, started_at)
        return {
            "status": status,
            "total": total_inst,
            "success": success_count,
            "failed": fail_count
        }
    except Exception as e:
        logger.error(f"Ingest failed: {e}")
        log_ingest_run("equities", "failed", total_inst, success_count, fail_count, started_at, error_msg=str(e))
        raise
    finally:
        if created_client and client:
            client.logout()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ingest_equities()
