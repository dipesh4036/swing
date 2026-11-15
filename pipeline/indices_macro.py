import os
import logging
from datetime import datetime, timedelta, date
from typing import Dict, List, Any, Optional
import requests
import pandas as pd
import yfinance as yf
from psycopg2.extras import execute_batch
from pipeline.db import get_connection
from pipeline.smartapi_client import SmartAPIClient

logger = logging.getLogger("pipeline.indices_macro")

INDEX_TOKENS = {
    "NIFTY 50": "99926000",
    "NIFTY 500": "99926004",
    "NIFTY MIDCAP 150": "99926060",
    "NIFTY SMALLCAP 250": "99926062",
    "INDIA VIX": "99926017",
}

def sync_indices(client: Optional[SmartAPIClient] = None, years: int = 3, conn=None) -> Dict[str, int]:
    """
    Fetches daily OHLCV for the 5 key indices from SmartAPI and upserts into `daily_index_ohlcv`
    and `trading_days`.
    """
    if client is None:
        client = SmartAPIClient()

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    results = {}
    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365 + 30)

    from_str = start_date.strftime("%Y-%m-%d 00:00")
    to_str = end_date.strftime("%Y-%m-%d 23:59")

    try:
        with conn.cursor() as cur:
            all_dates = set()
            for index_name, token in INDEX_TOKENS.items():
                logger.info(f"Fetching {years}y candles for index {index_name} (token {token})...")
                candles = client.get_candle_data(
                    exchange="NSE",
                    symbol_token=token,
                    interval="ONE_DAY",
                    from_date=from_str,
                    to_date=to_str
                )
                if not candles:
                    logger.warning(f"No candles returned for index {index_name}.")
                    results[index_name] = 0
                    continue

                records = []
                for c in candles:
                    # c format: [timestamp_str, open, high, low, close, volume]
                    # timestamp_str: '2024-11-14T00:00:00+05:30'
                    t_date = c[0].split("T")[0]
                    records.append((
                        t_date,
                        index_name,
                        float(c[1]),
                        float(c[2]),
                        float(c[3]),
                        float(c[4]),
                        int(c[5]) if len(c) > 5 and c[5] is not None else 0
                    ))
                    if index_name == "NIFTY 50":
                        all_dates.add(t_date)

                insert_sql = """
                INSERT INTO daily_index_ohlcv (trade_date, index_name, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (trade_date, index_name) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume;
                """
                execute_batch(cur, insert_sql, records, page_size=1000)
                results[index_name] = len(records)
                logger.info(f"Upserted {len(records)} rows for {index_name}.")

            # Populate trading_days from Nifty 50 dates
            if all_dates:
                td_records = [(d, True, None, False) for d in sorted(all_dates)]
                td_sql = """
                INSERT INTO trading_days (trade_date, is_trading_day, holiday_name, settlement_holiday)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (trade_date) DO NOTHING;
                """
                execute_batch(cur, td_sql, td_records, page_size=1000)
                logger.info(f"Populated {len(td_records)} trading days in trading_days table.")

        conn.commit()
        return results
    finally:
        if should_close:
            conn.close()

def sync_macro(years: int = 3, conn=None) -> Dict[str, int]:
    """
    Fetches USD/INR and Brent Crude daily rates via yfinance and upserts into `daily_macro_rates`.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    results = {}
    try:
        logger.info(f"Downloading macro series (USDINR=X, BZ=F) for {years}y...")
        data = yf.download(["USDINR=X", "BZ=F"], period=f"{years}y", progress=False)
        closes = data["Close"]

        records = []
        for dt, row in closes.iterrows():
            d_str = dt.strftime("%Y-%m-%d")
            brent_val = row.get("BZ=F")
            usdinr_val = row.get("USDINR=X")
            if pd.notna(brent_val):
                records.append((d_str, "BRENT", float(brent_val)))
            if pd.notna(usdinr_val):
                records.append((d_str, "USDINR", float(usdinr_val)))

        with conn.cursor() as cur:
            insert_sql = """
            INSERT INTO daily_macro_rates (trade_date, series, close)
            VALUES (%s, %s, %s)
            ON CONFLICT (trade_date, series) DO UPDATE SET
                close = EXCLUDED.close;
            """
            execute_batch(cur, insert_sql, records, page_size=1000)
        conn.commit()
        results["macro_rows"] = len(records)
        logger.info(f"Upserted {len(records)} macro rate records into daily_macro_rates.")
        return results
    finally:
        if should_close:
            conn.close()

def sync_fii_dii(conn=None) -> int:
    """
    Fetches latest FII/DII cash flow data from NSE and upserts into `daily_fii_dii_cash`.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        logger.info("Fetching FII/DII cash flow data from NSE...")
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        s = requests.Session()
        s.headers.update(headers)
        s.get("https://www.nseindia.com", timeout=10)
        resp = s.get("https://www.nseindia.com/api/fiidiiTradeReact", timeout=10)
        resp.raise_for_status()
        items = resp.json()

        # Parse date and category
        # Format: [{"buyValue":"11745.95","category":"DII","date":"13-Nov-2026","netValue":"-2253.58","sellValue":"13999.53"}, ...]
        data_by_date = {}
        for item in items:
            date_str = item.get("date", "").strip()
            if not date_str:
                continue
            parsed_date = datetime.strptime(date_str, "%d-%b-%Y").strftime("%Y-%m-%d")
            cat = item.get("category", "").upper()
            if parsed_date not in data_by_date:
                data_by_date[parsed_date] = {}

            if "DII" in cat:
                data_by_date[parsed_date]["dii_buy"] = float(item.get("buyValue", 0))
                data_by_date[parsed_date]["dii_sell"] = float(item.get("sellValue", 0))
                data_by_date[parsed_date]["dii_net"] = float(item.get("netValue", 0))
            elif "FII" in cat or "FPI" in cat:
                data_by_date[parsed_date]["fii_buy"] = float(item.get("buyValue", 0))
                data_by_date[parsed_date]["fii_sell"] = float(item.get("sellValue", 0))
                data_by_date[parsed_date]["fii_net"] = float(item.get("netValue", 0))

        records = []
        for d, vals in data_by_date.items():
            records.append((
                d,
                vals.get("fii_buy"),
                vals.get("fii_sell"),
                vals.get("fii_net"),
                vals.get("dii_buy"),
                vals.get("dii_sell"),
                vals.get("dii_net")
            ))

        with conn.cursor() as cur:
            insert_sql = """
            INSERT INTO daily_fii_dii_cash (trade_date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (trade_date) DO UPDATE SET
                fii_buy = EXCLUDED.fii_buy,
                fii_sell = EXCLUDED.fii_sell,
                fii_net = EXCLUDED.fii_net,
                dii_buy = EXCLUDED.dii_buy,
                dii_sell = EXCLUDED.dii_sell,
                dii_net = EXCLUDED.dii_net;
            """
            execute_batch(cur, insert_sql, records)
        conn.commit()
        logger.info(f"Upserted {len(records)} FII/DII cash records into daily_fii_dii_cash.")
        return len(records)
    except Exception as e:
        logger.error(f"Error fetching FII/DII data: {e}")
        return 0
    finally:
        if should_close:
            conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sync_indices()
    sync_macro()
    sync_fii_dii()

