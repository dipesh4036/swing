import os
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import pandas as pd
from pipeline.config import EQUITY_PARQUET_PATH, RETENTION_YEARS
from pipeline.smartapi_client import SmartAPIClient, get_smartapi_client
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.adjust")

def run_adjustments(
    client: Optional[SmartAPIClient] = None,
    parquet_path: str = EQUITY_PARQUET_PATH,
    conn=None,
    tokens_limit: Optional[int] = None
) -> bool:
    """
    Split/bonus handling (Case A, candles are pre-adjusted):
    For each token in the parquet store:
      - Compares re-fetched overlapping 10 sessions against stored rows.
      - If any close differs by more than 1%, re-fetches that token's full history,
        replaces all its rows in the parquet store, and logs to price_adjustments table.
      - Scans and logs every stock with an adjusted 1-day move of 20% or more to price_adjustments.
    """
    if not os.path.exists(parquet_path):
        logger.info(f"Parquet file {parquet_path} does not exist. Skipping adjustments.")
        return True

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        logger.error(f"Error reading parquet for adjustments: {e}")
        return False

    if df.empty or "token" not in df.columns:
        logger.info("Empty parquet data. Skipping adjustments.")
        return True

    logger.info("Running Case A split/bonus verification and 20% move scanning...")

    tokens = df["token"].unique()
    if tokens_limit:
        tokens = tokens[:tokens_limit]

    adjustments_detected = []
    large_moves_detected = []
    parquet_modified = False

    created_client = False
    if client is None:
        try:
            client = get_smartapi_client()
            created_client = True
        except Exception as e:
            logger.warning(f"Could not initialize SmartAPIClient for adjustments verification: {e}")
            client = None

    try:
        if client:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=RETENTION_YEARS * 365 + 30)
            from_date_full = start_date.strftime("%Y-%m-%d 00:00")
            to_date_full = end_date.strftime("%Y-%m-%d 23:59")
            overlap_start = (end_date - timedelta(days=20)).strftime("%Y-%m-%d 00:00")

            for idx, tok in enumerate(tokens, 1):
                tok_df = df[df["token"] == tok].sort_values(by="trade_date")
                if len(tok_df) < 5:
                    continue

                sym = str(tok_df["symbol"].iloc[0])
                stored_recent = tok_df.tail(10)
                stored_map = {r["trade_date"]: float(r["close"]) for _, r in stored_recent.iterrows()}

                # Re-fetch 10 overlapping sessions
                overlap_candles = client.get_candle_data(
                    exchange="NSE",
                    symbol_token=str(tok),
                    interval="ONE_DAY",
                    from_date=overlap_start,
                    to_date=to_date_full
                )
                if not overlap_candles:
                    continue

                diff_detected = False
                discrepancy_date = None
                ratio = 1.0

                for c in overlap_candles:
                    t_date = c[0].split("T")[0]
                    new_cl = float(c[4])
                    if t_date in stored_map:
                        stored_cl = stored_map[t_date]
                        if stored_cl > 0:
                            diff_pct = abs(new_cl - stored_cl) / stored_cl
                            if diff_pct > 0.01:
                                diff_detected = True
                                discrepancy_date = t_date
                                ratio = round(stored_cl / new_cl, 4)
                                logger.info(
                                    f"Corporate action detected for {sym} (token {tok}) on {t_date}: "
                                    f"stored={stored_cl}, new={new_cl}, ratio={ratio} (diff={diff_pct*100:.1f}%)"
                                )
                                break

                if diff_detected:
                    # Re-fetch full history for that token
                    full_candles = client.get_candle_data(
                        exchange="NSE",
                        symbol_token=str(tok),
                        interval="ONE_DAY",
                        from_date=from_date_full,
                        to_date=to_date_full
                    )
                    if full_candles:
                        new_token_records = []
                        for c in full_candles:
                            new_token_records.append({
                                "token": int(tok),
                                "isin": str(tok_df["isin"].iloc[0]),
                                "symbol": sym,
                                "series": str(tok_df["series"].iloc[0]),
                                "trade_date": c[0].split("T")[0],
                                "open": float(c[1]),
                                "high": float(c[2]),
                                "low": float(c[3]),
                                "close": float(c[4]),
                                "volume": int(c[5]) if len(c) > 5 and c[5] is not None else 0,
                                "turnover_cr_est": round(float(c[4]) * (int(c[5]) if len(c) > 5 and c[5] is not None else 0) / 1e7, 4),
                                "adj_factor": 1.0,
                            })

                        # Replace rows in dataframe
                        df = df[df["token"] != tok]
                        df = pd.concat([df, pd.DataFrame(new_token_records)], ignore_index=True)
                        parquet_modified = True

                        adjustments_detected.append({
                            "token": int(tok),
                            "symbol": sym,
                            "ex_date": discrepancy_date,
                            "action_type": "SPLIT_OR_BONUS",
                            "ratio": ratio
                        })
    finally:
        if created_client and client:
            client.logout()

    # Save updated parquet if any token was re-fetched
    if parquet_modified:
        df = df.sort_values(by=["token", "trade_date"])
        temp_path = f"{parquet_path}.adjust.tmp"
        df.to_parquet(temp_path, index=False)
        os.replace(temp_path, parquet_path)
        logger.info(f"Updated {len(adjustments_detected)} corporate-adjusted tokens in {parquet_path}.")

    # Scan and detect all adjusted 1-day moves >= 20%
    try:
        df_sorted = df.sort_values(by=["token", "trade_date"])
        df_sorted["prev_close"] = df_sorted.groupby("token")["close"].shift(1)
        df_sorted["move_pct"] = (df_sorted["close"] - df_sorted["prev_close"]).abs() / df_sorted["prev_close"]
        large_move_rows = df_sorted[df_sorted["move_pct"] >= 0.20]
        if not large_move_rows.empty:
            logger.info(f"Scanned {len(large_move_rows)} instances of >=20% 1-day moves in stored history.")
            for _, r in large_move_rows.iterrows():
                large_moves_detected.append({
                    "token": int(r["token"]),
                    "symbol": str(r["symbol"]),
                    "ex_date": str(r["trade_date"]),
                    "action_type": "LARGE_MOVE_20PCT",
                    "ratio": round(float(r["close"]) / float(r["prev_close"]), 4) if r["prev_close"] > 0 else 1.0
                })
    except Exception as e:
        logger.warning(f"Warning during 20% move scan: {e}")

    # Log adjustments and large moves to Neon PostgreSQL table `price_adjustments`
    all_events_to_log = adjustments_detected + large_moves_detected
    if all_events_to_log:
        close_conn = False
        try:
            if conn is None:
                conn = get_connection()
                close_conn = True
            with conn.cursor() as cur:
                from psycopg2.extras import execute_batch
                insert_sql = """
                INSERT INTO price_adjustments (token, symbol, ex_date, action_type, ratio, detected_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (token, ex_date, action_type) DO UPDATE
                SET ratio = EXCLUDED.ratio, detected_at = NOW();
                """
                records = [
                    (a["token"], a["symbol"], a["ex_date"], a["action_type"], a["ratio"])
                    for a in all_events_to_log
                ]
                execute_batch(cur, insert_sql, records, page_size=1000)
            conn.commit()
            logger.info(f"Recorded {len(all_events_to_log)} adjustment/move events in price_adjustments table.")
        except Exception as e:
            logger.warning(f"Could not persist price_adjustments to database: {e}")
        finally:
            if close_conn and conn:
                conn.close()

    return True
