import os
import time
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

def _parse_fii_dii_val(val: Any) -> Optional[float]:
    """
    Parses FII/DII numeric string. Returns None for missing/empty/'-' values.
    Never invents 0 for absent fields (R21).
    """
    if val is None:
        return None
    val_str = str(val).strip().replace(",", "")
    if not val_str or val_str in ("-", "—", "null", "none", "nan", "NA", "N/A"):
        return None
    try:
        return float(val_str)
    except (ValueError, TypeError):
        return None

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
            cat = str(item.get("category", "")).upper()
            if parsed_date not in data_by_date:
                data_by_date[parsed_date] = {
                    "fii_buy": None,
                    "fii_sell": None,
                    "fii_net": None,
                    "dii_buy": None,
                    "dii_sell": None,
                    "dii_net": None,
                }

            if "DII" in cat:
                data_by_date[parsed_date]["dii_buy"] = _parse_fii_dii_val(item.get("buyValue"))
                data_by_date[parsed_date]["dii_sell"] = _parse_fii_dii_val(item.get("sellValue"))
                data_by_date[parsed_date]["dii_net"] = _parse_fii_dii_val(item.get("netValue"))
            elif "FII" in cat or "FPI" in cat:
                data_by_date[parsed_date]["fii_buy"] = _parse_fii_dii_val(item.get("buyValue"))
                data_by_date[parsed_date]["fii_sell"] = _parse_fii_dii_val(item.get("sellValue"))
                data_by_date[parsed_date]["fii_net"] = _parse_fii_dii_val(item.get("netValue"))

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
        msg = f"FII/DII cash flow fetch failure: {e}"
        logger.error(msg)
        raise RuntimeError(msg)
    finally:
        if should_close:
            conn.close()

def resolve_sector_angel_tokens(scrip_master: Optional[List[dict]] = None) -> Dict[str, Dict[str, Any]]:
    """
    Dynamically resolves Angel One tokens for canonical sectors from OpenAPIScripMaster.json.
    Matches exact upper-case trimmed name or symbol for NSE index instruments.
    Sectors without an official spot token (or where no master token matches)
    are designated with source='equal_weight'.
    """
    from pipeline.sectors import SECTORS

    lookup = {}
    if scrip_master:
        for item in scrip_master:
            if item.get("exch_seg") == "NSE":
                sym = (item.get("symbol") or "").strip().upper()
                nm = (item.get("name") or "").strip().upper()
                token = item.get("token")
                itype = (item.get("instrumenttype") or "").strip()
                if token and (str(token).startswith("999") or itype == "AMXIDX"):
                    if nm:
                        lookup[nm] = str(token)
                    if sym:
                        lookup[sym] = str(token)

    resolved = {}
    for sec in SECTORS:
        key = sec["key"]
        angel_name = (sec.get("angel_name") or "").strip().upper()
        index_name = (sec.get("index_name") or "").strip().upper()

        token = None
        matched_by = None
        if lookup:
            if angel_name and angel_name in lookup:
                token = lookup[angel_name]
                matched_by = angel_name
            elif index_name and index_name in lookup:
                token = lookup[index_name]
                matched_by = index_name

        if token:
            logger.info(f"Sector '{key}' resolved to official token {token} (matched by '{matched_by}')")
            resolved[key] = {
                "key": key,
                "index_name": sec["index_name"],
                "token": token,
                "source": "official"
            }
        else:
            resolved[key] = {
                "key": key,
                "index_name": sec["index_name"],
                "token": None,
                "source": "equal_weight"
            }
    return resolved

def sync_sector_indices(client: Optional[SmartAPIClient] = None, years: int = 3, conn=None, scrip_master=None) -> Dict[str, Any]:
    """
    Fetches daily OHLCV for official sector indices from SmartAPI and upserts into `daily_index_ohlcv`.
    Respects Angel One 3 req/sec rate limit.
    Dynamically fetches OpenAPIScripMaster.json if not provided.
    Rejects candles if last close is zero/None or date range < 100 sessions.
    Equal-weight sectors are recorded with source='equal_weight' and 0 rows (handled in Phase 3).
    """
    from pipeline.instruments import ANGEL_SCRIP_MASTER_URL

    if scrip_master is None:
        try:
            logger.info(f"Fetching Angel scrip master for sector index resolution from {ANGEL_SCRIP_MASTER_URL}...")
            resp = requests.get(ANGEL_SCRIP_MASTER_URL, timeout=60)
            if resp.status_code == 200:
                scrip_master = resp.json()
            else:
                logger.warning(f"Failed to fetch Angel scrip master (HTTP {resp.status_code}). Skipping Angel sector fetch.")
                return {"status": "partial", "degraded": True, "error": f"HTTP {resp.status_code} fetching scrip master"}
        except Exception as e:
            logger.warning(f"Error fetching Angel scrip master: {e}. Skipping Angel sector fetch.")
            return {"status": "partial", "degraded": True, "error": str(e)}

    tokens_map = resolve_sector_angel_tokens(scrip_master)

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    if client is None:
        client = SmartAPIClient()

    results = {}
    end_date = datetime.now()
    start_date = end_date - timedelta(days=years * 365 + 30)
    from_str = start_date.strftime("%Y-%m-%d 00:00")
    to_str = end_date.strftime("%Y-%m-%d 23:59")

    try:
        with conn.cursor() as cur:
            for key, info in tokens_map.items():
                if info["source"] == "equal_weight" or not info["token"]:
                    logger.info(f"Sector '{key}' ({info['index_name']}) has no official spot index; marked for equal_weight synthesis.")
                    results[key] = {"rows": 0, "source": "equal_weight", "index_name": info["index_name"]}
                    continue

                token = info["token"]
                idx_name = info["index_name"]
                logger.info(f"Fetching {years}y candles for sector index {idx_name} (token {token})...")

                try:
                    candles = client.get_candle_data(
                        exchange="NSE",
                        symbol_token=token,
                        interval="ONE_DAY",
                        from_date=from_str,
                        to_date=to_str
                    )
                except Exception as ex:
                    logger.warning(f"Failed to fetch candles for sector index {idx_name} ({token}): {ex}")
                    candles = None

                # Sleep to respect SmartAPI rate limit (<= 3 req/sec)
                time.sleep(0.35)

                if not candles:
                    logger.warning(f"No candles returned for sector index {idx_name}.")
                    results[key] = {"rows": 0, "source": "official", "index_name": idx_name}
                    continue

                # Sanity-check the fetched candles: reject if < 100 sessions or last close is zero/None
                if len(candles) < 100:
                    logger.warning(f"Sanity check failed for {idx_name}: insufficient candles ({len(candles)} < 100). Rejecting and keeping stored data.")
                    results[key] = {"rows": 0, "source": "official", "index_name": idx_name, "rejected": "insufficient_history"}
                    continue

                last_close = float(candles[-1][4]) if len(candles[-1]) > 4 and candles[-1][4] is not None else 0.0
                if last_close <= 0:
                    logger.warning(f"Sanity check failed for {idx_name}: invalid last close ({last_close} <= 0). Rejecting and keeping stored data.")
                    results[key] = {"rows": 0, "source": "official", "index_name": idx_name, "rejected": "invalid_last_close"}
                    continue

                records = []
                for c in candles:
                    t_date = c[0].split("T")[0]
                    records.append((
                        t_date,
                        idx_name,
                        float(c[1]),
                        float(c[2]),
                        float(c[3]),
                        float(c[4]),
                        int(c[5]) if len(c) > 5 and c[5] is not None else 0
                    ))

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
                results[key] = {"rows": len(records), "source": "official", "index_name": idx_name}
                logger.info(f"Upserted {len(records)} rows for sector index {idx_name}.")

        conn.commit()
        return results
    finally:
        if should_close:
            conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sync_indices()
    sync_macro()
    sync_fii_dii()

