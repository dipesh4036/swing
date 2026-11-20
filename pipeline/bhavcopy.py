import io
import os
import sys
import time
import zipfile
import logging
import random
from datetime import datetime, date, timedelta, timezone
from typing import Dict, List, Any, Optional, Tuple, Set

import requests
import pandas as pd

from pipeline.config import RETENTION_YEARS, EQUITY_PARQUET_PATH
from pipeline.alerts import send_telegram_alert
from pipeline.db import get_connection
from pipeline.smartapi_client import SmartAPIClient
from pipeline.ingest import (
    SCHEMA_COLUMNS,
    log_ingest_run,
    log_price_adjustments,
    fetch_equity_candles,
    is_genuine_corporate_action,
)

logger = logging.getLogger("pipeline.bhavcopy")

PRIMARY_NSE_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"
FALLBACK_NSE_URL = "https://archives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.nseindia.com/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

class BhavcopyValidationError(Exception):
    """Raised when Bhavcopy CSV fails validation checks."""
    pass

def get_ist_today() -> date:
    """Returns today's date in Indian Standard Time (UTC+5:30)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).date()

def download_bhavcopy_raw(
    target_date: date,
    timeout: int = 30,
    session: Optional[requests.Session] = None
) -> Tuple[Optional[bytes], Dict[str, Any]]:
    """
    Downloads the Bhavcopy zip archive for a given target date.
    Tries primary NSE host first, then fallback host.
    Returns (content_bytes, metadata_dict).
    If 404, returns (None, {"status_code": 404, ...}).
    """
    date_str = target_date.strftime("%Y%m%d")
    urls = [
        PRIMARY_NSE_URL.format(date_str=date_str),
        FALLBACK_NSE_URL.format(date_str=date_str),
    ]

    req = session if session is not None else requests
    last_meta = {"status_code": 0, "host": "", "bytes": 0, "last_modified": None}

    for url in urls:
        host = "nsearchives.nseindia.com" if "nsearchives" in url else "archives.nseindia.com"
        try:
            logger.info(f"Downloading Bhavcopy for {target_date} from {url}...")
            resp = req.get(url, headers=NSE_HEADERS, timeout=timeout)
            last_meta = {
                "status_code": resp.status_code,
                "host": host,
                "bytes": len(resp.content),
                "last_modified": resp.headers.get("Last-Modified"),
                "url": url
            }
            logger.info(
                f"NSE Bhavcopy response: host={host}, status={resp.status_code}, "
                f"bytes={len(resp.content)}, Last-Modified={last_meta['last_modified']}"
            )
            if resp.status_code == 200:
                return resp.content, last_meta
            elif resp.status_code == 404:
                return None, last_meta
            else:
                logger.warning(f"Unexpected status code {resp.status_code} from {host}")
        except Exception as e:
            logger.warning(f"Request failed for {url}: {e}")
            last_meta["error"] = str(e)

    return None, last_meta

def parse_and_validate_bhavcopy(
    zip_bytes: bytes,
    target_date: date,
    min_rows: int = 1500
) -> pd.DataFrame:
    """
    Parses zip archive containing Bhavcopy CSV, filters and validates:
    - Filters: Sgmt == 'CM', SctySrs in ('EQ', 'BE'), ISIN starting 'INE'
    - Validates:
      * TradDt == target_date
      * rows >= min_rows
      * no NaN / <= 0 in OHLC
      * high >= low
      * close between low and high
    Returns DataFrame with columns:
    [token, symbol, trade_date, open, high, low, close, volume, traded_val, prev_close]
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()
        csv_files = [n for n in namelist if n.endswith(".csv")]
        if not csv_files:
            raise BhavcopyValidationError("No CSV file found inside Bhavcopy zip archive.")
        csv_name = csv_files[0]
        with zf.open(csv_name) as f:
            df = pd.read_csv(f)

    df.columns = [c.strip() for c in df.columns]

    required_raw_cols = [
        "TradDt", "Sgmt", "FinInstrmId", "ISIN", "TckrSymb",
        "SctySrs", "OpnPric", "HghPric", "LwPric", "ClsPric",
        "PrvsClsgPric", "TtlTradgVol"
    ]
    missing_cols = [c for c in required_raw_cols if c not in df.columns]
    if missing_cols:
        raise BhavcopyValidationError(f"Missing required Bhavcopy columns: {missing_cols}")

    # B2 Filter: Sgmt == 'CM', SctySrs in ('EQ', 'BE'), ISIN starts with 'INE'
    df["Sgmt"] = df["Sgmt"].astype(str).str.strip()
    df["SctySrs"] = df["SctySrs"].astype(str).str.strip()
    df["ISIN"] = df["ISIN"].astype(str).str.strip()

    filtered = df[
        (df["Sgmt"] == "CM") &
        (df["SctySrs"].isin(["EQ", "BE"])) &
        (df["ISIN"].str.startswith("INE"))
    ].copy()

    # Normalize TradDt
    filtered["trade_date"] = pd.to_datetime(filtered["TradDt"]).dt.strftime("%Y-%m-%d")
    target_str = target_date.strftime("%Y-%m-%d")

    # Validation: trade_date
    if not (filtered["trade_date"] == target_str).all():
        wrong_dates = filtered[filtered["trade_date"] != target_str]["trade_date"].unique()
        raise BhavcopyValidationError(f"TradDt does not match requested date {target_str}. Found: {wrong_dates}")

    # Validation: row count
    if len(filtered) < min_rows:
        raise BhavcopyValidationError(f"Row count {len(filtered)} is below minimum floor of {min_rows}.")

    # Type casting & mappings
    filtered["token"] = filtered["FinInstrmId"].astype(int)
    filtered["symbol"] = filtered["TckrSymb"].astype(str).str.strip()
    filtered["open"] = filtered["OpnPric"].astype(float)
    filtered["high"] = filtered["HghPric"].astype(float)
    filtered["low"] = filtered["LwPric"].astype(float)
    filtered["close"] = filtered["ClsPric"].astype(float)
    filtered["volume"] = filtered["TtlTradgVol"].astype(int)
    filtered["traded_val"] = (filtered["close"] * filtered["volume"]).round(2)
    filtered["prev_close"] = filtered["PrvsClsgPric"].astype(float)

    # Validation: OHLC checks
    for col in ["open", "high", "low", "close"]:
        if filtered[col].isna().any():
            raise BhavcopyValidationError(f"NaN values found in column {col}")
        if (filtered[col] <= 0).any():
            invalid_cnt = (filtered[col] <= 0).sum()
            raise BhavcopyValidationError(f"Found {invalid_cnt} non-positive values in column {col}")

    # high >= low
    if (filtered["high"] < filtered["low"]).any():
        bad = filtered[filtered["high"] < filtered["low"]]
        raise BhavcopyValidationError(f"Found {len(bad)} rows where high < low.")

    # close within [low, high]
    # Note: allow minor floating rounding (e.g. 1e-4)
    if ((filtered["close"] < filtered["low"] - 1e-4) | (filtered["close"] > filtered["high"] + 1e-4)).any():
        bad = filtered[(filtered["close"] < filtered["low"] - 1e-4) | (filtered["close"] > filtered["high"] + 1e-4)]
        raise BhavcopyValidationError(f"Found {len(bad)} rows where close is outside [low, high].")

    result_cols = SCHEMA_COLUMNS + ["prev_close"]
    filtered["isin"] = filtered["ISIN"].astype(str).str.strip()
    return filtered[result_cols + ["isin"]].copy()

def get_missing_trading_dates(
    stored_latest_date: Optional[date],
    now_ist: Optional[Any] = None
) -> List[date]:
    """
    Returns list of missing weekdays (Mon-Fri) from (stored_latest_date + 1 day) up to candidate date.
    Today is only included if now_ist is at or after 18:30 IST.
    Sorted oldest to newest.
    """
    ist = timezone(timedelta(hours=5, minutes=30))
    if now_ist is None:
        now_dt = datetime.now(ist)
    elif isinstance(now_ist, datetime):
        now_dt = now_ist
    elif isinstance(now_ist, date):
        now_dt = datetime(now_ist.year, now_ist.month, now_ist.day, 19, 0, tzinfo=ist)
    else:
        now_dt = datetime.now(ist)

    # 18:30 IST rule: only include today if IST time >= 18:30
    today_ist = now_dt.date()
    include_today = (now_dt.hour > 18 or (now_dt.hour == 18 and now_dt.minute >= 30))
    candidate_end = today_ist if include_today else (today_ist - timedelta(days=1))

    if stored_latest_date is None:
        return [candidate_end] if candidate_end.weekday() < 5 else []

    missing = []
    curr = stored_latest_date + timedelta(days=1)
    while curr <= candidate_end:
        if curr.weekday() < 5:  # 0=Monday, 4=Friday
            missing.append(curr)
        curr += timedelta(days=1)
    return missing

def check_nifty_candle_exists(target_date: date, conn=None) -> bool:
    """
    Checks if Neon DB has a NIFTY 50 candle for the given date.
    Returns True if candle exists, False otherwise.
    """
    target_str = target_date.strftime("%Y-%m-%d")
    should_close = False
    try:
        if conn is None:
            from pipeline.db import get_connection
            conn = get_connection()
            should_close = True
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM daily_index_ohlcv
                WHERE index_name = 'NIFTY 50' AND trade_date = %s
                LIMIT 1;
            """, (target_str,))
            return cur.fetchone() is not None
    except Exception as e:
        logger.debug(f"Could not query Nifty candle for {target_str}: {e}")
        return False
    finally:
        if should_close and conn:
            try:
                conn.close()
            except Exception:
                pass

def ingest_bhavcopy(
    parquet_path: Optional[str] = None,
    tokens_limit: Optional[int] = None,
    conn=None,
    sleep_fn=time.sleep,
    min_rows: int = 1500
) -> Dict[str, Any]:
    """
    Step 6 Bhavcopy daily ingest pipeline.
    Replaces ingest_equities when DAILY_SOURCE=bhavcopy.
    """
    started_at = datetime.now()
    if parquet_path is None:
        parquet_path = EQUITY_PARQUET_PATH

    logger.info(f"Starting Bhavcopy daily ingest on store: {parquet_path}")

    # Read existing store
    existing_df = pd.DataFrame(columns=SCHEMA_COLUMNS)
    latest_stored_date: Optional[date] = None

    if os.path.exists(parquet_path):
        try:
            existing_df = pd.read_parquet(parquet_path)
            if not existing_df.empty and "trade_date" in existing_df.columns:
                max_d_str = existing_df["trade_date"].max()
                latest_stored_date = datetime.strptime(max_d_str, "%Y-%m-%d").date()
                logger.info(f"Parquet store currently has {len(existing_df)} rows. Latest trade date: {latest_stored_date}")
        except Exception as e:
            logger.warning(f"Could not read existing parquet {parquet_path}: {e}")

    today_ist = get_ist_today()
    missing_dates = get_missing_trading_dates(latest_stored_date, today_ist)
    logger.info(f"Missing candidate dates up to {today_ist}: {[d.strftime('%Y-%m-%d') for d in missing_dates]}")

    # B3: If more than 10 missing dates, route to Angel path for repair
    if len(missing_dates) > 10:
        msg = f"More than 10 missing dates ({len(missing_dates)}). Routing to Angel path for multi-date repair."
        logger.info(msg)
        from pipeline.ingest import ingest_equities
        return ingest_equities(parquet_path=parquet_path, tokens_limit=tokens_limit)

    if not missing_dates:
        logger.info("No missing trading dates. Parquet store is already up to date.")
        return {
            "status": "success",
            "dates_ingested": 0,
            "rows": 0,
            "refetched": 0,
            "new_tokens": 0,
            "absent": 0
        }

    # Fetch active instruments from Neon for new tokens check
    active_instruments: Set[int] = set()
    stored_token_to_isin: Dict[int, str] = {}
    isin_to_stored_token: Dict[str, int] = {}
    try:
        from pipeline.db import get_connection
        should_close = False
        db_conn = conn
        if db_conn is None:
            db_conn = get_connection()
            should_close = True
        with db_conn.cursor() as cur:
            cur.execute("SELECT token, isin FROM instruments WHERE is_active = TRUE;")
            for row in cur.fetchall():
                t = int(row[0])
                active_instruments.add(t)
                if row[1]:
                    isin_code = str(row[1]).strip()
                    stored_token_to_isin[t] = isin_code
                    isin_to_stored_token[isin_code] = t

            # Also load any inactive instruments for ISIN resolution of series moves
            cur.execute("SELECT token, isin FROM instruments WHERE is_active = FALSE AND isin IS NOT NULL;")
            for row in cur.fetchall():
                t = int(row[0])
                if row[1]:
                    isin_code = str(row[1]).strip()
                    stored_token_to_isin[t] = isin_code
                    if isin_code not in isin_to_stored_token:
                        isin_to_stored_token[isin_code] = t

        if should_close:
            db_conn.close()
    except Exception as e:
        logger.warning(f"Could not query instruments from DB: {e}")

    dates_ingested = []
    total_new_rows = 0
    all_refetched_tokens: Set[int] = set()
    all_new_tokens_fetched: Set[int] = set()
    total_absent_count = 0
    any_cap_hit = False

    client: Optional[SmartAPIClient] = None

    for target_date in missing_dates:
        target_str = target_date.strftime("%Y-%m-%d")
        logger.info(f"Processing candidate date {target_str} via Bhavcopy...")

        zip_bytes = None
        meta = {}

        if target_date < today_ist:
            # Past date: download once
            zip_bytes, meta = download_bhavcopy_raw(target_date)
            if zip_bytes is None:
                # Fix 2: Nifty-based holiday check for past date
                nifty_exists = check_nifty_candle_exists(target_date, conn=conn)
                if not nifty_exists:
                    logger.info(f"Bhavcopy for past date {target_str} returned 404 and Nifty has no candle. Skipping as market holiday.")
                    continue
                else:
                    # Nifty has a candle, but Bhavcopy is 404/unreachable -> confirmed trading day missing!
                    err_msg = f"Bhavcopy unreachable for confirmed trading day {target_str} (Nifty candle exists, status={meta.get('status_code')}). Falling back to Angel."
                    logger.warning(err_msg)
                    send_telegram_alert(f"⚠️ {err_msg}")
                    from pipeline.ingest import ingest_equities
                    return ingest_equities(parquet_path=parquet_path, tokens_limit=tokens_limit)
        else:
            # Today's date: decide trading day from Nifty 50 candle (Fix 2)
            nifty_exists = check_nifty_candle_exists(target_date, conn=conn)
            max_attempts = 8 if nifty_exists else 3
            logger.info(f"Today's date check: Nifty 50 candle exists={nifty_exists}. Max polling attempts: {max_attempts}.")

            for attempt in range(1, max_attempts + 1):
                logger.info(f"Checking today's Bhavcopy ({target_str}), attempt {attempt}/{max_attempts}...")
                zip_bytes, meta = download_bhavcopy_raw(target_date)
                if zip_bytes is not None:
                    break
                if not nifty_exists:
                    nifty_exists = check_nifty_candle_exists(target_date, conn=conn)
                    if nifty_exists:
                        max_attempts = 8
                        logger.info("Nifty 50 candle detected in Neon; extending Bhavcopy polling to 8 attempts (40 min).")
                if attempt < max_attempts:
                    logger.info("File not published yet. Sleeping 5 minutes before next poll...")
                    sleep_fn(300)

            if zip_bytes is None:
                if not nifty_exists:
                    logger.info(f"No Bhavcopy and no Nifty candle for today ({target_str}) after polling. Market holiday detected: skipping with success.")
                    continue
                else:
                    fail_msg = f"Today's Bhavcopy ({target_str}) was not published after 40 minutes of polling on a confirmed trading day."
                    logger.error(fail_msg)
                    send_telegram_alert(f"🚨 {fail_msg}")
                    # Fix 2: Partial progress upload if previous dates succeeded
                    if dates_ingested:
                        try:
                            from pipeline.store import upload_parquet_store
                            upload_parquet_store(parquet_path, job_succeeded=True)
                        except Exception as ue:
                            logger.warning(f"Notice: partial progress upload: {ue}")
                        # S0-8: Authentic counts on partial run
                        latest_date = dates_ingested[-1]
                        latest_date_df = existing_df[existing_df["trade_date"] == latest_date]
                        latest_tokens = set(latest_date_df["token"].unique())
                        expected_set = set(t for t in stored_prev_closes.keys() if t in active_instruments) if stored_prev_closes else active_instruments
                        p_tot = len(expected_set) if expected_set else len(latest_tokens)
                        p_succ = len(latest_tokens & expected_set) if expected_set else len(latest_tokens)
                        p_fail = max(0, p_tot - p_succ)
                        log_ingest_run(
                            run_type="equities",
                            status="partial",
                            total=p_tot,
                            success=p_succ,
                            failed=p_fail,
                            started_at=started_at,
                            error_msg=fail_msg,
                            quality_gate_passed=True,
                            conn=conn
                        )
                        return {"status": "partial", "dates_ingested": dates_ingested, "error": fail_msg}
                    else:
                        log_ingest_run(
                            run_type="equities",
                            status="failed",
                            total=len(active_instruments),
                            success=0,
                            failed=len(active_instruments),
                            started_at=started_at,
                            error_msg=fail_msg,
                            quality_gate_passed=False,
                            conn=conn
                        )
                        return {"status": "failed", "error": fail_msg}

        # Parse & Validate
        try:
            bhav_df = parse_and_validate_bhavcopy(zip_bytes, target_date, min_rows=min_rows)
        except BhavcopyValidationError as ve:
            # B4: Fallback on validation failure
            err_msg = f"Bhavcopy validation failed for {target_str}: {ve}. Falling back to Angel."
            logger.warning(err_msg)
            send_telegram_alert(f"⚠️ {err_msg}")
            from pipeline.ingest import ingest_equities
            return ingest_equities(parquet_path=parquet_path, tokens_limit=tokens_limit)

        # ---------------------------------------------------------------------
        # Corporate Action & Tokens Analysis BEFORE appending date
        # ---------------------------------------------------------------------
        refetch_tokens: List[Tuple[int, str, float, float]] = []  # (token, symbol, ratio, diff_pct)

        # Build stored close lookup for previous session
        stored_prev_closes: Dict[int, float] = {}
        stored_tokens_set: Set[int] = set()

        if not existing_df.empty:
            stored_tokens_set = set(existing_df["token"].unique())
            prev_session_date = existing_df["trade_date"].max()
            prev_df = existing_df[existing_df["trade_date"] == prev_session_date]
            stored_prev_closes = dict(zip(prev_df["token"], prev_df["close"]))

        # Fix 7a: Series moves (identity key = ISIN)
        # Re-key stored rows if token changed but ISIN is already in store
        # S0-7: Track rekeyed tokens on this date to skip them in the prev-close check
        rekeyed_tokens_on_date = set()
        for _, brow in bhav_df.iterrows():
            f_tok = int(brow["token"])
            f_isin = str(brow.get("isin", "")).strip()
            f_sym = str(brow["symbol"]).strip()

            if f_tok not in stored_tokens_set and f_isin:
                # Find matching stored token with this ISIN
                old_tok = None
                for s_tok in list(stored_tokens_set):
                    if stored_token_to_isin.get(s_tok) == f_isin:
                        old_tok = s_tok
                        break
                if old_tok is not None:
                    logger.info(f"Series move OLD->NEW for {f_sym} ({f_isin}): re-keying stored token {old_tok} -> {f_tok}")
                    existing_df.loc[existing_df["token"] == old_tok, "token"] = f_tok
                    stored_tokens_set.discard(old_tok)
                    stored_tokens_set.add(f_tok)
                    if old_tok in stored_prev_closes:
                        stored_prev_closes[f_tok] = stored_prev_closes.pop(old_tok)
                    stored_token_to_isin[f_tok] = f_isin
                    isin_to_stored_token[f_isin] = f_tok
                    rekeyed_tokens_on_date.add(f_tok)

        file_tokens_set = set(bhav_df["token"].unique())

        # Check PrvsClsgPric vs stored close
        # S0-7: Skip re-keyed tokens for series moves (NSE's previous close can differ due to series move)
        for _, row in bhav_df.iterrows():
            tok = int(row["token"])
            if tok in rekeyed_tokens_on_date:
                continue
            sym = str(row["symbol"])
            prev_close = float(row["prev_close"])

            if tok in stored_prev_closes:
                stored_cl = stored_prev_closes[tok]
                if stored_cl > 0:
                    diff_pct = abs(prev_close - stored_cl) / stored_cl
                    if diff_pct > 0.005:  # > 0.5%
                        ratio = round(stored_cl / prev_close, 4) if prev_close > 0 else 1.0
                        refetch_tokens.append((tok, sym, ratio, diff_pct))

        # Check cap for corporate actions (cap 200)
        corporate_actions_cap_hit = False
        if len(refetch_tokens) > 200:
            corporate_actions_cap_hit = True
            any_cap_hit = True
            msg = f"⚠️ Corporate action cap (200 tokens) hit during Bhavcopy ingest ({len(refetch_tokens)} detected). Refetching top 200."
            logger.warning(msg)
            send_telegram_alert(msg)
            refetch_tokens.sort(key=lambda x: x[3], reverse=True)
            refetch_tokens = refetch_tokens[:200]

        # New tokens: in file, active in instruments, NOT in Parquet (and not series-moved)
        new_tokens = [tok for tok in file_tokens_set if tok in active_instruments and tok not in stored_tokens_set]
        new_tokens_cap_hit = False
        if len(new_tokens) > 100:
            new_tokens_cap_hit = True
            any_cap_hit = True
            msg = f"⚠️ New tokens cap (100) exceeded during Bhavcopy ingest ({len(new_tokens)} found). Refetching first 100."
            logger.warning(msg)
            send_telegram_alert(msg)
            new_tokens = new_tokens[:100]

        # Tokens in Parquet but absent from file
        absent_tokens = stored_tokens_set - file_tokens_set
        total_absent_count += len(absent_tokens)
        if absent_tokens:
            sample_syms = existing_df[existing_df["token"].isin(list(absent_tokens)[:20])]["symbol"].unique().tolist()
            logger.info(f"Tokens in Parquet but absent from Bhavcopy: {len(absent_tokens)} (sample: {sample_syms})")

        # Append new date rows (9 schema columns)
        clean_date_df = bhav_df[SCHEMA_COLUMNS].copy()
        existing_df = pd.concat([existing_df, clean_date_df], ignore_index=True)
        existing_df = existing_df.drop_duplicates(subset=["token", "trade_date"], keep="last")
        existing_df = existing_df.sort_values(by=["token", "trade_date"])

        # Execute corporate action refetches & new token fetches from Angel
        to_refetch = [t[0] for t in refetch_tokens]
        if to_refetch or new_tokens:
            if client is None:
                client = SmartAPIClient.login_from_env()

            from_d = (datetime.now() - timedelta(days=RETENTION_YEARS * 365 + 30)).strftime("%Y-%m-%d 00:00")
            to_d = datetime.now().strftime("%Y-%m-%d 23:59")

            # 1. Refetch corporate action tokens with Fix 7e older history check
            corp_adjustments = []
            for tok, sym, ratio, diff in refetch_tokens:
                logger.info(f"Re-fetching full window for corporate action token {sym} ({tok})...")
                try:
                    candles = fetch_equity_candles(client, tok, sym, from_d, to_d)
                    if candles:
                        c_df = pd.DataFrame(candles)[SCHEMA_COLUMNS]

                        # S0-4 / Fix 7e: Shared helper compares closes older than last 5 sessions (< 0.1% = reference price change)
                        tok_stored = existing_df[existing_df["token"] == tok]
                        stored_map = dict(zip(tok_stored["trade_date"], tok_stored["close"])) if not tok_stored.empty else {}
                        is_genuine_adj = is_genuine_corporate_action(stored_map, candles, symbol=sym, token=tok)

                        # Replace rows in existing_df
                        existing_df = existing_df[existing_df["token"] != tok]
                        existing_df = pd.concat([existing_df, c_df], ignore_index=True)
                        all_refetched_tokens.add(tok)

                        if is_genuine_adj:
                            corp_adjustments.append({
                                "token": tok,
                                "symbol": sym,
                                "ex_date": target_str,
                                "action_type": "SPLIT_OR_BONUS",
                                "ratio": ratio
                            })
                except Exception as ex:
                    logger.warning(f"Error refetching corporate action token {sym}: {ex}")

            if corp_adjustments:
                log_price_adjustments(corp_adjustments, conn=conn)

            # 2. Fetch new tokens full window
            token_symbol_map = dict(zip(bhav_df["token"], bhav_df["symbol"]))
            for tok in new_tokens:
                sym = token_symbol_map.get(tok, str(tok))
                logger.info(f"Fetching full window for new token {sym} ({tok})...")
                try:
                    candles = fetch_equity_candles(client, tok, sym, from_d, to_d)
                    if candles:
                        c_df = pd.DataFrame(candles)[SCHEMA_COLUMNS]
                        existing_df = pd.concat([existing_df, c_df], ignore_index=True)
                        all_new_tokens_fetched.add(tok)
                except Exception as ex:
                    logger.warning(f"Error fetching new token {sym}: {ex}")

        # Atomic write parquet
        existing_df = existing_df.drop_duplicates(subset=["token", "trade_date"], keep="last")
        existing_df = existing_df.sort_values(by=["token", "trade_date"])
        temp_path = f"{parquet_path}.tmp"
        existing_df.to_parquet(temp_path, index=False, compression="snappy")
        os.replace(temp_path, parquet_path)

        dates_ingested.append(target_str)
        total_new_rows += len(clean_date_df)
        logger.info(f"Successfully merged Bhavcopy for {target_str} ({len(clean_date_df)} rows).")

    # Record run in ingest_runs (Fix 6: Log partial when caps hit)
    # S0-8: Authentic counts on the bhavcopy path
    run_status = "partial" if any_cap_hit else "success"
    if not dates_ingested:
        total_count = 0
        success_count = 0
        failed_count = 0
        summary_msg = "Bhavcopy ingest completed: holiday or no dates ingested (0/0/0)"
    else:
        # total = tokens expected (previous session's tokens that are still active)
        # success = tokens present in the merged bhavcopy rows for the latest ingested date
        # failed = expected minus success
        expected_set = set(t for t in stored_prev_closes.keys() if t in active_instruments) if stored_prev_closes else active_instruments
        total_count = len(expected_set) if expected_set else total_new_rows
        latest_date = dates_ingested[-1]
        latest_date_df = existing_df[existing_df["trade_date"] == latest_date]
        latest_tokens = set(latest_date_df["token"].unique())
        success_count = len(latest_tokens & expected_set) if expected_set else len(latest_tokens)
        failed_count = max(0, total_count - success_count)
        summary_msg = (
            f"Bhavcopy: dates={len(dates_ingested)}, rows={total_new_rows}, "
            f"refetched={len(all_refetched_tokens)}, new_tokens={len(all_new_tokens_fetched)}, "
            f"absent={total_absent_count} (status={run_status})"
        )

    logger.info(f"Bhavcopy ingest completed: {summary_msg}")
    log_ingest_run(
        run_type="equities",
        status=run_status,
        total=total_count,
        success=success_count,
        failed=failed_count,
        started_at=started_at,
        error_msg=summary_msg,
        quality_gate_passed=True,
        conn=conn
    )

    return {
        "status": run_status,
        "dates_ingested": dates_ingested,
        "rows": total_new_rows,
        "refetched": len(all_refetched_tokens),
        "new_tokens": len(all_new_tokens_fetched),
        "absent": total_absent_count
    }

def verify_bhavcopy_command(parquet_path: Optional[str] = None) -> int:
    """
    CLI command 'verify-bhavcopy' (B5).
    Writes nothing to Parquet or Neon.
    - Downloads latest available bhavcopy (tries today, backs up to 5 days).
    - Takes 30 tokens (25 highest traded_val + 5 random).
    - Fetches Angel ONE_DAY candle for that date (1 req/s).
    - Compares OHLC and volume.
    - Compares PrvsClsgPric with stored Parquet close for previous session.
    - Exits 1 if volume or OHLC fails for > 10% of the sample.
    """
    if parquet_path is None:
        parquet_path = EQUITY_PARQUET_PATH

    today_ist = get_ist_today()
    target_date: Optional[date] = None
    zip_bytes: Optional[bytes] = None
    meta_info: Dict[str, Any] = {}

    print("=== NSE Bhavcopy Verification ===")
    for back in range(6):
        d = today_ist - timedelta(days=back)
        if d.weekday() >= 5:  # Weekend
            continue
        print(f"Checking Bhavcopy for candidate date: {d}...")
        b, meta = download_bhavcopy_raw(d)
        if b is not None:
            target_date = d
            zip_bytes = b
            meta_info = meta
            break

    if target_date is None or zip_bytes is None:
        print("Error: Could not find or download any Bhavcopy in the last 5 days.")
        return 1

    print(f"Found Bhavcopy for date: {target_date}")
    print(f"Host: {meta_info.get('host')}")
    print(f"HTTP Status: {meta_info.get('status_code')}")
    print(f"Bytes: {meta_info.get('bytes')}")
    print(f"Last-Modified: {meta_info.get('last_modified')}")

    try:
        bhav_df = parse_and_validate_bhavcopy(zip_bytes, target_date, min_rows=1000)
    except Exception as e:
        print(f"Error parsing Bhavcopy: {e}")
        return 1

    print(f"Parsed {len(bhav_df)} valid EQ/BE instruments for {target_date}.")

    # Login to Angel
    print("Logging into Angel One SmartAPI for verification sample...")
    try:
        client = SmartAPIClient.login_from_env()
    except Exception as e:
        print(f"Error logging into SmartAPI: {e}")
        return 1

    # Take 30 tokens: 25 highest traded_val + 5 random
    top25 = bhav_df.sort_values(by="traded_val", ascending=False).head(25)
    remaining = bhav_df[~bhav_df["token"].isin(top25["token"])]
    random5 = remaining.sample(n=min(5, len(remaining)), random_state=42)
    sample_df = pd.concat([top25, random5], ignore_index=True)

    date_str = target_date.strftime("%Y-%m-%d")
    mismatches = []
    ohlc_failures = 0
    volume_failures = 0
    worst_vol_diff_pct = 0.0
    field_mismatch_counts = {"open": 0, "high": 0, "low": 0, "close": 0, "volume": 0}

    print("\nComparing 30 sample tokens between Bhavcopy and Angel SmartAPI...")
    for idx, row in sample_df.iterrows():
        tok = int(row["token"])
        sym = str(row["symbol"])
        candles = client.get_candle_data(
            exchange="NSE",
            symbol_token=str(tok),
            interval="ONE_DAY",
            from_date=f"{date_str} 00:00",
            to_date=f"{date_str} 23:59"
        )
        if not candles:
            print(f"Warning: No Angel candle returned for {sym} ({tok}) on {date_str}")
            ohlc_failures += 1
            volume_failures += 1
            continue

        c = candles[-1]
        if isinstance(c, dict):
            a_open = float(c["open"])
            a_high = float(c["high"])
            a_low = float(c["low"])
            a_close = float(c["close"])
            a_vol = int(c.get("volume", 0))
        else:
            a_open = float(c[1])
            a_high = float(c[2])
            a_low = float(c[3])
            a_close = float(c[4])
            a_vol = int(c[5]) if len(c) > 5 and c[5] is not None else 0

        b_open = float(row["open"])
        b_high = float(row["high"])
        b_low = float(row["low"])
        b_close = float(row["close"])
        b_vol = int(row["volume"])

        def ohlc_match(a, b):
            diff = abs(a - b)
            return diff <= (0.0005 * b) or diff <= 0.05

        op_ok = ohlc_match(a_open, b_open)
        hi_ok = ohlc_match(a_high, b_high)
        lo_ok = ohlc_match(a_low, b_low)
        cl_ok = ohlc_match(a_close, b_close)

        vol_diff_pct = abs(a_vol - b_vol) / max(b_vol, 1) * 100.0
        if vol_diff_pct > worst_vol_diff_pct:
            worst_vol_diff_pct = vol_diff_pct
        vol_ok = (vol_diff_pct <= 1.0)

        if not op_ok: field_mismatch_counts["open"] += 1
        if not hi_ok: field_mismatch_counts["high"] += 1
        if not lo_ok: field_mismatch_counts["low"] += 1
        if not cl_ok: field_mismatch_counts["close"] += 1
        if not vol_ok: field_mismatch_counts["volume"] += 1

        stock_ohlc_failed = not (op_ok and hi_ok and lo_ok and cl_ok)
        if stock_ohlc_failed:
            ohlc_failures += 1
        if not vol_ok:
            volume_failures += 1

        if stock_ohlc_failed or not vol_ok:
            mismatches.append({
                "symbol": sym,
                "token": tok,
                "bhav_ohlc": [b_open, b_high, b_low, b_close],
                "angel_ohlc": [a_open, a_high, a_low, a_close],
                "bhav_vol": b_vol,
                "angel_vol": a_vol,
                "vol_diff_pct": round(vol_diff_pct, 2)
            })

    # Summary
    sample_size = len(sample_df)
    ohlc_ok = (ohlc_failures / sample_size) <= 0.10
    volume_ok = (volume_failures / sample_size) <= 0.10

    print("\n--- Verification Sample Mismatch Table ---")
    if mismatches:
        for m in mismatches:
            print(
                f"Symbol: {m['symbol']} ({m['token']}) | Bhav OHLC: {m['bhav_ohlc']} | "
                f"Angel OHLC: {m['angel_ohlc']} | Bhav Vol: {m['bhav_vol']} | "
                f"Angel Vol: {m['angel_vol']} ({m['vol_diff_pct']}%)"
            )
    else:
        print("All 30 sample tokens matched perfectly between Bhavcopy and Angel!")

    summary = {
        "sample_size": sample_size,
        "ohlc_ok": ohlc_ok,
        "volume_ok": volume_ok,
        "ohlc_failures": ohlc_failures,
        "volume_failures": volume_failures,
        "worst_volume_diff_pct": round(worst_vol_diff_pct, 2),
        "per_field_mismatch_counts": field_mismatch_counts
    }
    import json
    print("\n--- JSON Summary ---")
    print(json.dumps(summary, indent=2))

    # Compare PrvsClsgPric with stored parquet previous session close
    if os.path.exists(parquet_path):
        try:
            pq_df = pd.read_parquet(parquet_path)
            # Find stored date just prior to target_date
            pq_dates = sorted([d for d in pq_df["trade_date"].unique() if d < date_str])
            if pq_dates:
                prev_date = pq_dates[-1]
                prev_session_df = pq_df[pq_df["trade_date"] == prev_date]
                stored_closes = dict(zip(prev_session_df["token"], prev_session_df["close"]))

                matched_count = 0
                mismatch_symbols = []
                for _, row in bhav_df.iterrows():
                    tok = int(row["token"])
                    sym = str(row["symbol"])
                    prev_cl = float(row["prev_close"])
                    if tok in stored_closes:
                        matched_count += 1
                        st_cl = stored_closes[tok]
                        if st_cl > 0:
                            diff_pct = abs(prev_cl - st_cl) / st_cl
                            if diff_pct > 0.005:  # > 0.5%
                                mismatch_symbols.append(f"{sym} (stored={st_cl}, bhav_prev={prev_cl}, diff={diff_pct*100:.1f}%)")

                print(f"\n--- Previous Session Close Comparison (vs Parquet {prev_date}) ---")
                print(f"Common tokens compared: {matched_count}")
                print(f"Mismatches > 0.5%: {len(mismatch_symbols)}")
                if mismatch_symbols:
                    print("Mismatch symbols (first 30):")
                    for s in mismatch_symbols[:30]:
                        print(f"  - {s}")
        except Exception as e:
            print(f"Could not compare against stored Parquet: {e}")

    if not ohlc_ok or not volume_ok:
        print("\nVerification FAILED: mismatch rate exceeded 10% threshold.")
        return 1

    print("\nVerification PASSED: Bhavcopy matches Angel data within tolerance.")
    return 0
