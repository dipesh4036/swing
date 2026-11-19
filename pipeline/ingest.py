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
from pipeline.smartapi_client import SmartAPIClient, SmartAPIThrottledError
from pipeline.alerts import send_telegram_alert

logger = logging.getLogger("pipeline.ingest")

SCHEMA_COLUMNS = ["token", "symbol", "trade_date", "open", "high", "low", "close", "volume", "traded_val"]

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

def log_price_adjustments(adjustments: List[Dict[str, Any]], conn=None):
    if not adjustments:
        return
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        from psycopg2.extras import execute_batch
        with conn.cursor() as cur:
            insert_sql = """
            INSERT INTO price_adjustments (token, symbol, ex_date, action_type, ratio, detected_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (token, ex_date, action_type) DO UPDATE
            SET ratio = EXCLUDED.ratio, detected_at = NOW();
            """
            records = [
                (a["token"], a["symbol"], a["ex_date"], a["action_type"], a["ratio"])
                for a in adjustments
            ]
            execute_batch(cur, insert_sql, records, page_size=1000)
        conn.commit()
        logger.info(f"Recorded {len(adjustments)} adjustments in price_adjustments table.")
    except Exception as e:
        logger.warning(f"Could not persist price_adjustments: {e}")
    finally:
        if should_close and conn:
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
            "trade_date": str(t_date),
            "open": o,
            "high": h,
            "low": l,
            "close": cl,
            "volume": v,
            "traded_val": round(cl * v, 2)
        })
    return records

def ingest_equities(
    client: Optional[SmartAPIClient] = None,
    tokens_limit: Optional[int] = None,
    years: int = RETENTION_YEARS,
    parquet_path: str = EQUITY_PARQUET_PATH,
    batch_save_size: int = 50,
    target_trade_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    Ingests daily equity candles for all target instruments.
    Supports incremental update or backfill.
    Performs Case A corporate action detection in-line before merging.
    Saves to parquet atomically with 9-column schema.
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
    stored_closes_by_token: Dict[int, Dict[str, float]] = {}

    if os.path.exists(parquet_path):
        try:
            existing_df = pd.read_parquet(parquet_path)
            # Ensure 9 standard columns only
            for col in SCHEMA_COLUMNS:
                if col not in existing_df.columns:
                    if col == "traded_val":
                        existing_df["traded_val"] = existing_df["close"] * existing_df["volume"]
            existing_df = existing_df[SCHEMA_COLUMNS].copy()
            existing_tokens = set(existing_df["token"].unique())
            logger.info(f"Loaded existing parquet with {len(existing_df)} rows across {len(existing_tokens)} tokens.")

            # Build stored close mapping for corporate action checks
            for tok, g in existing_df.groupby("token"):
                stored_closes_by_token[tok] = dict(zip(g["trade_date"].astype(str), g["close"].astype(float)))
        except Exception as e:
            logger.warning(f"Could not read existing parquet: {e}. Starting fresh.")
            existing_df = None
            existing_tokens = set()

    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365 + 30)
    from_date_str = start_date.strftime("%Y-%m-%d 00:00")
    to_date_str = end_date.strftime("%Y-%m-%d 23:59")
    inc_start = (end_date - timedelta(days=20)).strftime("%Y-%m-%d 00:00")

    new_records = []
    tokens_to_replace: Dict[int, List[Dict[str, Any]]] = {}
    corporate_actions = []
    corporate_actions_cap_hit = False

    success_tokens: Set[int] = set()
    no_data_tokens: Set[int] = set()
    throttled_tokens: Set[int] = set()

    # Track newest target trade date seen across candles
    latest_seen_date = target_trade_date
    token_candle_map: Dict[int, List[Dict[str, Any]]] = {}

    try:
        for idx, inst in enumerate(instruments, 1):
            tok = inst["token"]
            sym = inst["symbol"]

            is_incremental = (existing_df is not None and tok in existing_tokens)
            fetch_from = inc_start if is_incremental else from_date_str

            candles = []
            try:
                candles = fetch_equity_candles(client, tok, sym, fetch_from, to_date_str)
            except SmartAPIThrottledError:
                throttled_tokens.add(tok)
                candles = []
            except Exception as e:
                logger.warning(f"Error fetching candles for {sym} ({tok}): {e}")
                candles = []

            token_candle_map[tok] = candles

            if candles:
                # Update latest_seen_date dynamically
                candle_dates = [c["trade_date"] for c in candles]
                max_d = max(candle_dates)
                if latest_seen_date is None or max_d > latest_seen_date:
                    latest_seen_date = max_d

                # Corporate action check on incremental fetches (BEFORE merge)
                if is_incremental and tok in stored_closes_by_token:
                    stored_map = stored_closes_by_token[tok]
                    diff_detected = False
                    discrepancy_date = None
                    ratio = 1.0

                    for c in candles:
                        t_date = c["trade_date"]
                        new_cl = c["close"]
                        if t_date in stored_map and stored_map[t_date] > 0:
                            stored_cl = stored_map[t_date]
                            diff_pct = abs(new_cl - stored_cl) / stored_cl
                            if diff_pct > 0.01:
                                diff_detected = True
                                discrepancy_date = t_date
                                ratio = round(stored_cl / new_cl, 4)
                                logger.info(
                                    f"Corporate action detected for {sym} ({tok}) on {t_date}: "
                                    f"stored={stored_cl}, new={new_cl}, ratio={ratio} ({diff_pct*100:.1f}%)"
                                )
                                break

                    if diff_detected:
                        if len(corporate_actions) < 200:
                            logger.info(f"Re-fetching full window for corporate-adjusted token {sym} ({tok})...")
                            try:
                                full_c = fetch_equity_candles(client, tok, sym, from_date_str, to_date_str)
                                if full_c:
                                    tokens_to_replace[tok] = full_c
                                    corporate_actions.append({
                                        "token": tok,
                                        "symbol": sym,
                                        "ex_date": discrepancy_date,
                                        "action_type": "SPLIT_OR_BONUS",
                                        "ratio": ratio
                                    })
                            except Exception as re_err:
                                logger.warning(f"Failed full re-fetch for adjusted token {sym}: {re_err}")
                        else:
                            if not corporate_actions_cap_hit:
                                corporate_actions_cap_hit = True
                                msg = "⚠️ Corporate action cap (200 tokens) hit during equities ingest!"
                                logger.warning(msg)
                                send_telegram_alert(msg)

                if tok not in tokens_to_replace:
                    new_records.extend(candles)
            else:
                if tok not in throttled_tokens:
                    no_data_tokens.add(tok)

            if idx % 50 == 0 or idx == total_inst:
                logger.info(
                    f"Progress: {idx}/{total_inst} instruments processed "
                    f"({len(new_records) + sum(len(v) for v in tokens_to_replace.values())} candles, "
                    f"{len(throttled_tokens)} throttled, {len(no_data_tokens)} no-data)."
                )

        # ---------------------------------------------------------------------
        # Evaluation of target trade date presence
        # ---------------------------------------------------------------------
        for tok, candles in token_candle_map.items():
            if tok in tokens_to_replace:
                candles = tokens_to_replace[tok]

            if candles and (latest_seen_date is None or any(c["trade_date"] == latest_seen_date for c in candles)):
                success_tokens.add(tok)
            elif tok not in throttled_tokens:
                no_data_tokens.add(tok)

        # ---------------------------------------------------------------------
        # End-of-run retry pass for throttled tokens at half speed (max 5 minutes)
        # ---------------------------------------------------------------------
        if throttled_tokens:
            logger.info(f"Retrying {len(throttled_tokens)} throttled tokens at half speed (max 5 min)...")
            retry_start = time.time()
            client.set_rate(max(0.2, client.current_req_per_sec / 2.0))
            inst_map = {inst["token"]: inst for inst in instruments}

            for tok in list(throttled_tokens):
                if (time.time() - retry_start) > 300:  # 5 minutes max
                    logger.warning("Throttled retry time limit (5m) reached. Ending retry pass.")
                    break
                inst = inst_map.get(tok)
                if not inst:
                    continue
                sym = inst["symbol"]
                is_incremental = (existing_df is not None and tok in existing_tokens)
                fetch_from = inc_start if is_incremental else from_date_str

                try:
                    c = fetch_equity_candles(client, tok, sym, fetch_from, to_date_str)
                    throttled_tokens.remove(tok)
                    if c:
                        # Corporate action check in retry pass (Fix 6)
                        if is_incremental and tok in stored_closes_by_token:
                            stored_map = stored_closes_by_token[tok]
                            diff_detected = False
                            discrepancy_date = None
                            ratio = 1.0
                            for cd in c:
                                t_date = cd["trade_date"]
                                new_cl = cd["close"]
                                if t_date in stored_map and stored_map[t_date] > 0:
                                    stored_cl = stored_map[t_date]
                                    diff_pct = abs(new_cl - stored_cl) / stored_cl
                                    if diff_pct > 0.01:
                                        diff_detected = True
                                        discrepancy_date = t_date
                                        ratio = round(stored_cl / new_cl, 4)
                                        break
                            if diff_detected and len(corporate_actions) < 200:
                                try:
                                    full_c = fetch_equity_candles(client, tok, sym, from_date_str, to_date_str)
                                    if full_c:
                                        tokens_to_replace[tok] = full_c
                                        corporate_actions.append({
                                            "token": tok,
                                            "symbol": sym,
                                            "ex_date": discrepancy_date,
                                            "action_type": "SPLIT_OR_BONUS",
                                            "ratio": ratio
                                        })
                                except Exception as re_err:
                                    logger.warning(f"Failed full re-fetch for adjusted token {sym} in retry pass: {re_err}")

                        if tok not in tokens_to_replace:
                            new_records.extend(c)
                        if latest_seen_date is None or any(cd["trade_date"] == latest_seen_date for cd in c):
                            success_tokens.add(tok)
                        else:
                            no_data_tokens.add(tok)
                    else:
                        no_data_tokens.add(tok)
                except SmartAPIThrottledError:
                    pass
                except Exception:
                    throttled_tokens.discard(tok)
                    no_data_tokens.add(tok)

        # ---------------------------------------------------------------------
        # Final DataFrame Assembly and Atomic Parquet Write
        # ---------------------------------------------------------------------
        all_dfs = []
        if existing_df is not None and not existing_df.empty:
            # Exclude tokens whose entire history was replaced by corporate action
            if tokens_to_replace:
                existing_df = existing_df[~existing_df["token"].isin(tokens_to_replace.keys())]
            all_dfs.append(existing_df)

        if new_records:
            all_dfs.append(pd.DataFrame(new_records))

        for tok, full_recs in tokens_to_replace.items():
            if full_recs:
                all_dfs.append(pd.DataFrame(full_recs))

        if all_dfs:
            combined = pd.concat(all_dfs, ignore_index=True)
            # Ensure strict 9 columns
            combined = combined[SCHEMA_COLUMNS].copy()
            # Deduplicate by token and trade_date (keep latest)
            combined = combined.drop_duplicates(subset=["token", "trade_date"], keep="last")
            combined = combined.sort_values(by=["token", "trade_date"])

            temp_path = f"{parquet_path}.tmp"
            combined.to_parquet(temp_path, index=False, compression="snappy")
            os.replace(temp_path, parquet_path)
            logger.info(f"Saved atomic parquet update: {len(combined)} rows across {combined['token'].nunique()} tokens.")

        # Persist corporate action adjustments to Neon DB
        if corporate_actions:
            log_price_adjustments(corporate_actions)

        # ---------------------------------------------------------------------
        # Status Accounting (Fix 3: Expected set based on previous session + active)
        # ---------------------------------------------------------------------
        active_tokens_set = {inst["token"] for inst in instruments}
        expected_set = active_tokens_set
        if existing_df is not None and not existing_df.empty and "trade_date" in existing_df.columns:
            prev_trade_date = existing_df["trade_date"].max()
            prev_session_tokens = set(existing_df[existing_df["trade_date"] == prev_trade_date]["token"].unique())
            if prev_session_tokens:
                expected_set = prev_session_tokens.intersection(active_tokens_set)
                if not expected_set:
                    expected_set = active_tokens_set

        absent_suspended_tokens = active_tokens_set - expected_set
        if absent_suspended_tokens:
            logger.info(f"Notice: {len(absent_suspended_tokens)} active instruments were absent from previous session (suspended/new/illiquid).")

        expected_total = len(expected_set)
        expected_success = len(expected_set.intersection(success_tokens))
        expected_failed = expected_total - expected_success
        missing_pct = ((expected_total - expected_success) / expected_total * 100.0) if expected_total > 0 else 0.0

        success_count = len(success_tokens)
        throttled_count = len(throttled_tokens)
        no_data_count = len(no_data_tokens)
        failed_count = throttled_count + no_data_count

        if missing_pct > 2.0:
            status = "failed"
        elif missing_pct >= 0.5:
            status = "partial"
        else:
            status = "success"

        summary_msg = (
            f"expected_total={expected_total}, expected_success={expected_success}, "
            f"expected_failed={expected_failed}, missing_pct={missing_pct:.2f}%, "
            f"absent_suspended={len(absent_suspended_tokens)}, throttled={throttled_count}, "
            f"no_data={no_data_count} (status={status})"
        )
        logger.info(f"Ingest summary: {summary_msg}")

        if status in ("partial", "failed"):
            alert_msg = f"⚠️ Equities ingest status is '{status}': {summary_msg}"
            logger.warning(alert_msg)
            send_telegram_alert(alert_msg)

        log_ingest_run("equities", status, expected_total, expected_success, expected_failed, started_at, error_msg=summary_msg)

        return {
            "status": status,
            "total": total_inst,
            "success": success_count,
            "failed": failed_count,
            "expected_total": expected_total,
            "expected_success": expected_success,
            "expected_failed": expected_failed,
            "absent_suspended": len(absent_suspended_tokens),
            "no_data": no_data_count,
            "throttled": throttled_count,
            "missing_pct": missing_pct,
            "corporate_actions_count": len(corporate_actions)
        }
    except Exception as e:
        logger.error(f"Ingest failed with exception: {e}")
        log_ingest_run("equities", "failed", total_inst, len(success_tokens), total_inst - len(success_tokens), started_at, error_msg=str(e))
        raise
    finally:
        if created_client and client:
            client.logout()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ingest_equities()
