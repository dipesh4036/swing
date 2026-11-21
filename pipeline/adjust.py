import os
import logging
from typing import Optional, Dict, Any, List
import pandas as pd
from pipeline.config import EQUITY_PARQUET_PATH
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.adjust")

def run_adjustments(
    client: Optional[Any] = None,
    parquet_path: str = EQUITY_PARQUET_PATH,
    conn=None,
    tokens_limit: Optional[int] = None
) -> bool:
    """
    Step 7/9: adjust (no Angel calls).
    Scans stored history in parquet for any 1-day move of 20% or more,
    and logs them to the price_adjustments table. Zero network/Angel calls.
    """
    logger.info("Step 7/9: adjust (no Angel calls)")
    if not os.path.exists(parquet_path):
        logger.info(f"Parquet file {parquet_path} does not exist. Skipping adjustments.")
        return True

    try:
        df = pd.read_parquet(parquet_path, columns=["token", "symbol", "trade_date", "close"])
    except Exception as e:
        logger.error(f"Error reading parquet for adjustments: {e}")
        return False

    if df.empty or "token" not in df.columns:
        logger.info("Empty parquet data. Skipping adjustments.")
        return True

    tokens = df["token"].unique()
    if tokens_limit:
        df = df[df["token"].isin(tokens[:tokens_limit])]

    large_moves_detected = []
    try:
        from pipeline.compute import attach_adjacent_prev_close
        df_sorted = df.sort_values(by=["token", "trade_date"]).copy()
        df_sorted = attach_adjacent_prev_close(df_sorted)
        df_sorted["move_pct"] = (df_sorted["close"] - df_sorted["prev_close"]).abs() / df_sorted["prev_close"]
        large_move_rows = df_sorted[df_sorted["move_pct"] >= 0.20]
        if not large_move_rows.empty:
            logger.info(f"Scanned {len(large_move_rows)} instances of >=20% 1-day moves in stored history.")
            for _, r in large_move_rows.iterrows():
                prev_c = float(r["prev_close"])
                curr_c = float(r["close"])
                if prev_c > 0:
                    large_moves_detected.append({
                        "token": int(r["token"]),
                        "symbol": str(r["symbol"]),
                        "ex_date": str(r["trade_date"]),
                        "action_type": "LARGE_MOVE_20PCT",
                        "ratio": round(curr_c / prev_c, 4)
                    })
    except Exception as e:
        logger.warning(f"Warning during 20% move scan: {e}")

    if large_moves_detected:
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
                    for a in large_moves_detected
                ]
                execute_batch(cur, insert_sql, records, page_size=1000)
            conn.commit()
            logger.info(f"Recorded {len(large_moves_detected)} large move events in price_adjustments table.")
        except Exception as e:
            logger.warning(f"Could not persist price_adjustments to database: {e}")
        finally:
            if close_conn and conn:
                conn.close()

    return True
