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


def compute_industry_metrics(
    df_ind,
    conn=None,
    publish_floor_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Computes daily industry breadth, ranking, equal-weight indices, and industry stock metrics (I2).
    - Universe: liquid stocks (close >= 20 AND vol_sma_50 >= 25k) that are mapped in stock_industry.
    - Rolling returns & 20d high/low computed on FULL per-token sequence BEFORE liquidity filtering (T4).
    - Equal-weight index: chain-linked base 100 on daily_industry_index.
    - Breadth: medians, % above 50/200 DMA, 20d highs/lows, % leaders, mcap_cr.
    - Rank: percentile-based rank for industries with n_stocks >= 5.
    - Latest stock metrics stored in industry_stock_metrics.
    """
    import pandas as pd
    import numpy as np

    if df_ind is None or df_ind.empty:
        logger.warning("Empty df_ind provided to compute_industry_metrics.")
        return {"status": "skipped", "reason": "empty_df"}

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # 1. Fetch stock_industry mappings from DB
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, macro, sector, industry, basic_industry FROM stock_industry;")
            ind_rows = cur.fetchall()

        if not ind_rows:
            logger.warning("No stock_industry mappings found in database. Skipping industry metrics.")
            return {"status": "skipped", "reason": "no_mappings"}

        sym_to_ind = {
            r[0]: {
                "macro": r[1],
                "sector": r[2],
                "industry": r[3],
                "basic_industry": r[4],
            }
            for r in ind_rows
        }

        # 2. Fetch stock_mcap from DB
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, mcap_rs, issue_size FROM stock_mcap;")
            mcap_rows = cur.fetchall()
        sym_to_mcap = {
            r[0]: {
                "mcap_rs": float(r[1]) if r[1] is not None else None,
                "issue_size": int(r[2]) if r[2] is not None else None,
                "mcap_cr": round(float(r[1]) / 1e7, 2) if r[1] is not None else None,
            }
            for r in mcap_rows
        }

        # 3. Compute per-token rolling returns & 20d high/low on FULL sequence BEFORE liquidity filtering (T4)
        group_col = "token" if "token" in df_ind.columns else "symbol"
        df_ind = df_ind.sort_values(by=[group_col, "trade_date"]).copy()

        df_ind["ret_1d_pct"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(1)) / s.shift(1) * 100.0
        )
        df_ind["ret_5d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(5)) / s.shift(5) * 100.0
        )
        df_ind["ret_22d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(22)) / s.shift(22) * 100.0
        )
        df_ind["ret_64d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(64)) / s.shift(64) * 100.0
        )
        df_ind["ret_126d"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: (s - s.shift(126)) / s.shift(126) * 100.0
        )

        # 20-session high/low close (inclusive of today)
        df_ind["roll_max_20"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: s.rolling(20, min_periods=1).max()
        )
        df_ind["roll_min_20"] = df_ind.groupby(group_col)["close"].transform(
            lambda s: s.rolling(20, min_periods=1).min()
        )
        df_ind["at_20d_high"] = (df_ind["close"] == df_ind["roll_max_20"])
        df_ind["at_20d_low"] = (df_ind["close"] == df_ind["roll_min_20"])

        # Liquidity filter
        vol_col = "vol_sma_50" if "vol_sma_50" in df_ind.columns else "volume" if "volume" in df_ind.columns else None
        if vol_col is not None:
            is_liquid = (df_ind["close"] >= 20) & (df_ind[vol_col] >= 25000) & df_ind[vol_col].notna()
        else:
            is_liquid = df_ind["close"] >= 20
        df_ind["in_universe"] = is_liquid

        # Attach industry mapping
        df_ind["macro"] = df_ind["symbol"].map(lambda s: sym_to_ind.get(s, {}).get("macro"))
        df_ind["sector_mapped"] = df_ind["symbol"].map(lambda s: sym_to_ind.get(s, {}).get("sector"))
        df_ind["industry_mapped"] = df_ind["symbol"].map(lambda s: sym_to_ind.get(s, {}).get("industry"))
        df_ind["basic_industry"] = df_ind["symbol"].map(lambda s: sym_to_ind.get(s, {}).get("basic_industry"))
        df_ind["mcap_cr"] = df_ind["symbol"].map(lambda s: sym_to_mcap.get(s, {}).get("mcap_cr"))

        # 4. Synthesize equal-weight daily index series for each basic_industry
        # (chain-linked base 100, applied to historical trade dates)
        distinct_industries = sorted([ind for ind in df_ind["basic_industry"].dropna().unique() if ind])
        logger.info(f"Synthesizing equal-weight indices for {len(distinct_industries)} basic industries...")

        ew_index_records = []
        for b_ind in distinct_industries:
            sub_ind_df = df_ind[(df_ind["basic_industry"] == b_ind) & df_ind["in_universe"]].copy()
            if sub_ind_df.empty:
                continue

            daily_agg = sub_ind_df.groupby("trade_date").agg(
                mean_ret=("ret_1d_pct", "mean"),
                n_members=("symbol", "nunique")
            ).reset_index().sort_values("trade_date")

            if daily_agg.empty:
                continue

            cum_close = 100.0
            for _, r in daily_agg.iterrows():
                t_date = r["trade_date"]
                m_ret = r["mean_ret"]
                if pd.notna(m_ret):
                    cum_close = cum_close * (1.0 + float(m_ret) / 100.0)
                n_m = int(r["n_members"]) if pd.notna(r["n_members"]) else 0
                ew_index_records.append((t_date, b_ind, round(cum_close, 4), n_m))

        if ew_index_records:
            with conn.cursor() as cur:
                insert_ew_sql = """
                    INSERT INTO daily_industry_index (trade_date, basic_industry, ew_close, n_members)
                    VALUES %s
                    ON CONFLICT (trade_date, basic_industry) DO UPDATE SET
                        ew_close = EXCLUDED.ew_close,
                        n_members = EXCLUDED.n_members;
                """
                execute_values(cur, insert_ew_sql, ew_index_records, page_size=2000)
            conn.commit()
            logger.info(f"Upserted {len(ew_index_records)} rows into daily_industry_index.")

        # 5. Compute daily_industry_breadth and rankings
        # Filter to liquid classified stocks
        df_classified_liquid = df_ind[df_ind["in_universe"] & df_ind["basic_industry"].notna()].copy()
        if df_classified_liquid.empty:
            logger.warning("No liquid stocks mapped in stock_industry.")
            return {"status": "success", "breadth_rows": 0, "stocks_published": 0}

        all_trade_dates = sorted(df_classified_liquid["trade_date"].unique())
        if publish_floor_date:
            all_trade_dates = [d for d in all_trade_dates if str(d) >= str(publish_floor_date)]

        breadth_records_to_upsert = []

        for t_date in all_trade_dates:
            date_df = df_classified_liquid[df_classified_liquid["trade_date"] == t_date]
            if date_df.empty:
                continue

            ind_groups = date_df.groupby("basic_industry")
            date_summary = []

            for b_ind, grp in ind_groups:
                sec_name = str(grp["sector_mapped"].iloc[0]) if pd.notna(grp["sector_mapped"].iloc[0]) else "Unclassified"
                n_stocks = len(grp)

                mask_50 = (grp["has_valid_50sma"] == 1) if "has_valid_50sma" in grp.columns else grp["close"].notna()
                mask_200 = (grp["has_valid_200sma"] == 1) if "has_valid_200sma" in grp.columns else pd.Series(False, index=grp.index)

                n_val_50 = int(mask_50.sum())
                n_val_200 = int(mask_200.sum())

                pct_50 = round(float(grp.loc[mask_50, "above_50sma"].sum() / n_val_50 * 100.0), 2) if n_val_50 > 0 else None
                pct_200 = round(float(grp.loc[mask_200, "above_200sma"].sum() / n_val_200 * 100.0), 2) if n_val_200 > 0 else None

                m_1d = round(float(grp["ret_1d_pct"].median()), 4) if grp["ret_1d_pct"].notna().any() else None
                m_1w = round(float(grp["ret_5d"].median()), 4) if grp["ret_5d"].notna().any() else None
                m_1m = round(float(grp["ret_22d"].median()), 4) if grp["ret_22d"].notna().any() else None
                m_3m = round(float(grp["ret_64d"].median()), 4) if grp["ret_64d"].notna().any() else None
                m_6m = round(float(grp["ret_126d"].median()), 4) if grp["ret_126d"].notna().any() else None

                n_hi = int(grp["at_20d_high"].sum())
                n_lo = int(grp["at_20d_low"].sum())

                # pct_leaders = share of members with rs_rank >= 70
                if "rs_rank" in grp.columns and grp["rs_rank"].notna().any():
                    pct_lead = round(float((grp["rs_rank"] >= 70).sum() / n_stocks * 100.0), 2)
                else:
                    pct_lead = 0.0

                # sum of mcap_cr
                mcap_sum = round(float(grp["mcap_cr"].sum()), 2) if grp["mcap_cr"].notna().any() else None

                date_summary.append({
                    "trade_date": t_date,
                    "sector": sec_name,
                    "basic_industry": b_ind,
                    "n_stocks": n_stocks,
                    "n_valid_50": n_val_50,
                    "n_valid_200": n_val_200,
                    "median_1d": m_1d,
                    "median_1w": m_1w,
                    "median_1m": m_1m,
                    "median_3m": m_3m,
                    "median_6m": m_6m,
                    "pct_above_50": pct_50,
                    "pct_above_200": pct_200,
                    "n_20d_high": n_hi,
                    "n_20d_low": n_lo,
                    "pct_leaders": pct_lead,
                    "mcap_cr": mcap_sum,
                    "rank": None,
                })

            # Calculate rank among industries with n_stocks >= 5
            # RANKING FORMULA:
            # trend = mean(pct_rank(median_1m), pct_rank(median_3m), pct_rank(median_6m))
            # breadth = mean(pct_rank(pct_above_50), pct_rank(pct_above_200))
            # leaders = pct_rank(pct_leaders)
            # final = (trend + breadth + leaders) / 3
            # rank = 1..N by final desc, ties by n_stocks desc, then basic_industry asc.
            sum_df = pd.DataFrame(date_summary)
            ranked_mask = sum_df["n_stocks"] >= 5

            if ranked_mask.any():
                rf = sum_df[ranked_mask].copy()

                # Safe percentile rank helper
                def calc_pct_rank(series):
                    s = series.fillna(0.0)
                    if len(s) <= 1:
                        return pd.Series(100.0, index=s.index)
                    return s.rank(pct=True, ascending=True) * 100.0

                p_1m = calc_pct_rank(rf["median_1m"])
                p_3m = calc_pct_rank(rf["median_3m"])
                p_6m = calc_pct_rank(rf["median_6m"])
                trend = (p_1m + p_3m + p_6m) / 3.0

                p_50 = calc_pct_rank(rf["pct_above_50"])
                p_200 = calc_pct_rank(rf["pct_above_200"])
                breadth = (p_50 + p_200) / 2.0

                leaders = calc_pct_rank(rf["pct_leaders"])

                rf["final_score"] = (trend + breadth + leaders) / 3.0

                rf = rf.sort_values(
                    by=["final_score", "n_stocks", "basic_industry"],
                    ascending=[False, False, True]
                )
                rf["rank"] = range(1, len(rf) + 1)

                # Merge back rank aligning on index
                sum_df.loc[rf.index, "rank"] = rf["rank"]

            for _, row_s in sum_df.iterrows():
                r_val = int(row_s["rank"]) if pd.notna(row_s["rank"]) else None
                breadth_records_to_upsert.append((
                    row_s["trade_date"],
                    row_s["sector"],
                    row_s["basic_industry"],
                    int(row_s["n_stocks"]),
                    int(row_s["n_valid_50"]) if pd.notna(row_s["n_valid_50"]) else None,
                    int(row_s["n_valid_200"]) if pd.notna(row_s["n_valid_200"]) else None,
                    row_s["median_1d"],
                    row_s["median_1w"],
                    row_s["median_1m"],
                    row_s["median_3m"],
                    row_s["median_6m"],
                    row_s["pct_above_50"],
                    row_s["pct_above_200"],
                    int(row_s["n_20d_high"]),
                    int(row_s["n_20d_low"]),
                    row_s["pct_leaders"],
                    row_s["mcap_cr"],
                    r_val,
                ))

        if breadth_records_to_upsert:
            with conn.cursor() as cur:
                insert_brd_sql = """
                    INSERT INTO daily_industry_breadth (
                        trade_date, sector, basic_industry, n_stocks, n_valid_50, n_valid_200,
                        median_1d, median_1w, median_1m, median_3m, median_6m,
                        pct_above_50, pct_above_200, n_20d_high, n_20d_low, pct_leaders, mcap_cr, rank
                    ) VALUES %s
                    ON CONFLICT (trade_date, basic_industry) DO UPDATE SET
                        sector = EXCLUDED.sector,
                        n_stocks = EXCLUDED.n_stocks,
                        n_valid_50 = EXCLUDED.n_valid_50,
                        n_valid_200 = EXCLUDED.n_valid_200,
                        median_1d = EXCLUDED.median_1d,
                        median_1w = EXCLUDED.median_1w,
                        median_1m = EXCLUDED.median_1m,
                        median_3m = EXCLUDED.median_3m,
                        median_6m = EXCLUDED.median_6m,
                        pct_above_50 = EXCLUDED.pct_above_50,
                        pct_above_200 = EXCLUDED.pct_above_200,
                        n_20d_high = EXCLUDED.n_20d_high,
                        n_20d_low = EXCLUDED.n_20d_low,
                        pct_leaders = EXCLUDED.pct_leaders,
                        mcap_cr = EXCLUDED.mcap_cr,
                        rank = EXCLUDED.rank;
                """
                execute_values(cur, insert_brd_sql, breadth_records_to_upsert, page_size=2000)
            conn.commit()
            logger.info(f"Upserted {len(breadth_records_to_upsert)} rows into daily_industry_breadth.")

        # 6. Upsert latest industry_stock_metrics
        latest_d = df_ind["trade_date"].max()
        df_latest = df_ind[df_ind["trade_date"] == latest_d].copy()

        # Company names lookup
        names_by_sym = {}
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT symbol, name FROM instruments WHERE exchange = 'NSE';")
                for r in cur.fetchall():
                    if r[0]:
                        names_by_sym[str(r[0])] = str(r[1] or r[0])
        except Exception:
            pass

        stock_metrics_records = []
        for _, row in df_latest.iterrows():
            sym = str(row["symbol"])
            tok = int(row["token"]) if pd.notna(row.get("token")) else None
            if not tok:
                continue

            raw_b_ind = row.get("basic_industry")
            b_ind = str(raw_b_ind).strip() if pd.notna(raw_b_ind) and str(raw_b_ind).strip() not in ("", "nan", "NaN") else None

            raw_sec = row.get("sector_mapped")
            sec = str(raw_sec).strip() if pd.notna(raw_sec) and str(raw_sec).strip() not in ("", "nan", "NaN") else ("Unclassified" if not b_ind else None)

            raw_macro = row.get("macro")
            macro = str(raw_macro).strip() if pd.notna(raw_macro) and str(raw_macro).strip() not in ("", "nan", "NaN") else None

            raw_ind = row.get("industry_mapped")
            ind = str(raw_ind).strip() if pd.notna(raw_ind) and str(raw_ind).strip() not in ("", "nan", "NaN") else None

            # Only include mapped stocks or liquid universe stocks
            in_univ = bool(row["in_universe"])
            if not b_ind and not in_univ:
                continue
            cls_val = round(float(row["close"]), 2) if pd.notna(row.get("close")) else None

            r1d = round(float(row["ret_1d_pct"]), 4) if pd.notna(row.get("ret_1d_pct")) else None
            r1w = round(float(row["ret_5d"]), 4) if pd.notna(row.get("ret_5d")) else None
            r1m = round(float(row["ret_22d"]), 4) if pd.notna(row.get("ret_22d")) else None
            r3m = round(float(row["ret_64d"]), 4) if pd.notna(row.get("ret_64d")) else None
            r6m = round(float(row["ret_126d"]), 4) if pd.notna(row.get("ret_126d")) else None

            h52 = row.get("high_52w")
            if pd.notna(h52) and float(h52) > 0 and cls_val is not None:
                pct_52h = round(float((cls_val - float(h52)) / float(h52) * 100.0), 2)
                if pct_52h > 0:
                    pct_52h = 0.0
            else:
                pct_52h = None

            ab_20 = bool(row["above_20ema"] == 1) if pd.notna(row.get("above_20ema")) and row.get("has_valid_20ema") == 1 else None
            ab_50 = bool(row["above_50sma"] == 1) if pd.notna(row.get("above_50sma")) and row.get("has_valid_50sma") == 1 else None
            ab_200 = bool(row["above_200sma"] == 1) if pd.notna(row.get("above_200sma")) and row.get("has_valid_200sma") == 1 else None

            stg = int(row["stage"]) if pd.notna(row.get("stage")) else None
            vr = round(float(row["volume_ratio"]), 2) if pd.notna(row.get("volume_ratio")) else None
            atv = round(float(row["avg_traded_val_50"]), 2) if pd.notna(row.get("avg_traded_val_50")) else None
            rs_r = int(row["rs_rank"]) if pd.notna(row.get("rs_rank")) else None

            screeners = []
            for sc_name in ["stage2", "vcp", "minervini", "pocket_pivot"]:
                if row.get(sc_name) == 1:
                    screeners.append(sc_name)

            m_cr = float(row["mcap_cr"]) if pd.notna(row.get("mcap_cr")) else None
            hi_20 = bool(row.get("at_20d_high", False))
            lo_20 = bool(row.get("at_20d_low", False))

            stock_metrics_records.append((
                latest_d,
                tok,
                sym,
                names_by_sym.get(sym, sym),
                macro,
                sec,
                ind,
                b_ind,
                in_univ,
                cls_val,
                r1d,
                r1w,
                r1m,
                r3m,
                r6m,
                pct_52h,
                ab_20,
                ab_50,
                ab_200,
                stg,
                vr,
                atv,
                rs_r,
                screeners,
                m_cr,
                hi_20,
                lo_20,
            ))

        if stock_metrics_records:
            with conn.cursor() as cur:
                insert_sm_sql = """
                    INSERT INTO industry_stock_metrics (
                        trade_date, token, symbol, name, macro, sector, industry, basic_industry,
                        in_universe, close, ret_1d, ret_1w, ret_1m, ret_3m, ret_6m, pct_from_52w_high,
                        above_20ema, above_50dma, above_200dma, stage, vol_ratio, avg_traded_value,
                        rs_rank, screeners, mcap_cr, at_20d_high, at_20d_low
                    ) VALUES %s
                    ON CONFLICT (token) DO UPDATE SET
                        trade_date = EXCLUDED.trade_date,
                        symbol = EXCLUDED.symbol,
                        name = EXCLUDED.name,
                        macro = EXCLUDED.macro,
                        sector = EXCLUDED.sector,
                        industry = EXCLUDED.industry,
                        basic_industry = EXCLUDED.basic_industry,
                        in_universe = EXCLUDED.in_universe,
                        close = EXCLUDED.close,
                        ret_1d = EXCLUDED.ret_1d,
                        ret_1w = EXCLUDED.ret_1w,
                        ret_1m = EXCLUDED.ret_1m,
                        ret_3m = EXCLUDED.ret_3m,
                        ret_6m = EXCLUDED.ret_6m,
                        pct_from_52w_high = EXCLUDED.pct_from_52w_high,
                        above_20ema = EXCLUDED.above_20ema,
                        above_50dma = EXCLUDED.above_50dma,
                        above_200dma = EXCLUDED.above_200dma,
                        stage = EXCLUDED.stage,
                        vol_ratio = EXCLUDED.vol_ratio,
                        avg_traded_value = EXCLUDED.avg_traded_value,
                        rs_rank = EXCLUDED.rs_rank,
                        screeners = EXCLUDED.screeners,
                        mcap_cr = EXCLUDED.mcap_cr,
                        at_20d_high = EXCLUDED.at_20d_high,
                        at_20d_low = EXCLUDED.at_20d_low,
                        updated_at = NOW();
                """
                execute_values(cur, insert_sm_sql, stock_metrics_records, page_size=1000)
                # Purge stale snapshot rows from prior dates
                cur.execute("DELETE FROM industry_stock_metrics WHERE trade_date < %s;", (latest_d,))
            conn.commit()
            logger.info(f"Upserted {len(stock_metrics_records)} rows into industry_stock_metrics for date {latest_d}.")

        return {
            "status": "success",
            "breadth_rows": len(breadth_records_to_upsert),
            "ew_index_rows": len(ew_index_records),
            "stock_metrics_rows": len(stock_metrics_records),
            "latest_date": str(latest_d),
        }
    finally:
        if should_close and conn:
            conn.close()


def backfill_industry_metrics(
    parquet_path: Optional[str] = None,
    conn=None,
) -> Dict[str, Any]:
    """
    Backfills daily industry breadth and index for the last 250 trading sessions (I2).
    Idempotent.
    """
    import os
    import pandas as pd
    from pipeline.config import EQUITY_PARQUET_PATH
    from pipeline.compute import compute_stock_indicators
    from pipeline.screeners import compute_screener_indicators

    p_path = parquet_path or EQUITY_PARQUET_PATH
    if not os.path.exists(p_path):
        raise FileNotFoundError(f"Parquet file {p_path} not found.")

    logger.info(f"Starting backfill_industry_metrics on {p_path}...")
    df_raw = pd.read_parquet(p_path)
    logger.info("Computing stock indicators...")
    df_ind = compute_stock_indicators(df_raw)
    logger.info("Computing screener indicators...")
    df_ind = compute_screener_indicators(df_ind)

    all_dates = sorted(df_ind["trade_date"].unique())
    publish_floor_date = all_dates[-250] if len(all_dates) >= 250 else all_dates[0]
    logger.info(f"Publish floor date for 250-session backfill: {publish_floor_date}")

    return compute_industry_metrics(df_ind, conn=conn, publish_floor_date=publish_floor_date)

