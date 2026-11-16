import time
import logging
from datetime import datetime
from typing import List, Tuple, Any
import numpy as np
import pandas as pd
from psycopg2.extras import execute_batch

from pipeline.db import get_connection
from pipeline.smartapi_client import SmartAPIClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("sync_angel_candles")

def attach_emas(df: pd.DataFrame) -> pd.DataFrame:
    """Computes EMA 10, 20, 50, 200 for a chronological DataFrame."""
    df = df.copy()
    for p in [10, 20, 50, 200]:
        df[f"ema_{p}"] = df["close"].ewm(span=p, adjust=False).mean()
    return df

def sync_all_screener_candles():
    logger.info("Initializing SmartAPI client for full historical candle sync...")
    client = SmartAPIClient(requests_per_sec=2.5)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT token, symbol
                FROM daily_screener_results
                ORDER BY symbol;
            """)
            stocks = cur.fetchall()

        logger.info(f"Found {len(stocks)} distinct screener tokens to sync with full Angel One history.")

        total_inserted = 0
        from_date = "2015-01-01 09:15"
        to_date = f"{datetime.now().strftime('%Y-%m-%d')} 15:30"

        for idx, (token, symbol) in enumerate(stocks, 1):
            logger.info(f"[{idx}/{len(stocks)}] Fetching all candles for {symbol} (token {token})...")
            raw = client.get_candle_data(
                exchange="NSE",
                symbol_token=str(token),
                interval="ONE_DAY",
                from_date=from_date,
                to_date=to_date
            )

            if not raw:
                logger.warning(f"No candles returned by Angel One for {symbol} ({token}). Skipping.")
                continue

            records = []
            for r in raw:
                # r: [timestamp, open, high, low, close, volume]
                d_str = r[0].split("T")[0]
                records.append({
                    "trade_date": d_str,
                    "open": float(r[1]),
                    "high": float(r[2]),
                    "low": float(r[3]),
                    "close": float(r[4]),
                    "volume": int(r[5])
                })

            df = pd.DataFrame(records)
            df = df.drop_duplicates(subset=["trade_date"]).sort_values("trade_date").reset_index(drop=True)
            df = attach_emas(df)

            candle_rows = []
            for _, row in df.iterrows():
                candle_rows.append((
                    int(token),
                    row["trade_date"],
                    row["open"],
                    row["high"],
                    row["low"],
                    row["close"],
                    int(row["volume"]),
                    round(float(row["ema_10"]), 2) if pd.notna(row["ema_10"]) else None,
                    round(float(row["ema_20"]), 2) if pd.notna(row["ema_20"]) else None,
                    round(float(row["ema_50"]), 2) if pd.notna(row["ema_50"]) else None,
                    round(float(row["ema_200"]), 2) if pd.notna(row["ema_200"]) else None,
                ))

            with conn.cursor() as cur:
                # Insert or update
                insert_sql = """
                    INSERT INTO screener_candles (
                        token, trade_date, open, high, low, close, volume,
                        sma_10, sma_20, sma_50, sma_200
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (token, trade_date) DO UPDATE
                    SET open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume,
                        sma_10 = EXCLUDED.sma_10,
                        sma_20 = EXCLUDED.sma_20,
                        sma_50 = EXCLUDED.sma_50,
                        sma_200 = EXCLUDED.sma_200;
                """
                execute_batch(cur, insert_sql, candle_rows, page_size=1000)

            conn.commit()
            total_inserted += len(candle_rows)
            logger.info(f"Synced {len(candle_rows)} candles for {symbol}. Total in DB: {total_inserted}")

        logger.info(f"Successfully finished full candle sync from Angel One: {total_inserted} total candles stored.")

    finally:
        client.logout()
        conn.close()

if __name__ == "__main__":
    sync_all_screener_candles()

