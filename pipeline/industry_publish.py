"""
Atomic batch transactional publication for industry_snapshots, industry_groups,
daily_industry_strength, and latest_industry_stock_metrics.

Ensures readers only ever observe completed snapshots, enforces free-tier DB
storage guard (700 MB), and prunes superseded stock snapshot rows.
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from psycopg2.extras import execute_values

from pipeline.db import get_connection
from pipeline.industry_strength import (
    ComputedIndustrySnapshot,
    METHODOLOGY_VERSION,
    compute_industry_strength_snapshot,
    prepare_stock_arrays,
)

logger = logging.getLogger("pipeline.industry_publish")

DB_SIZE_LIMIT_MB = int(os.environ.get("DB_SIZE_LIMIT_MB", "450"))
MAX_DB_SIZE_BYTES = DB_SIZE_LIMIT_MB * 1024 * 1024
STOCK_CANDLE_WINDOW = 260


def check_db_storage_guard(conn) -> int:
    """Verify current DB size is below MAX_DB_SIZE_BYTES before publishing."""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_database_size(current_database());")
        row = cur.fetchone()
        size_bytes = int(row[0]) if row and row[0] else 0
    if size_bytes >= MAX_DB_SIZE_BYTES:
        raise RuntimeError(
            f"Database storage guard triggered: {size_bytes / (1024*1024):.1f} MB >= {DB_SIZE_LIMIT_MB} MB limit"
        )
    return size_bytes


def publish_industry_snapshot(
    snapshot: ComputedIndustrySnapshot,
    conn=None,
    keep_stock_snapshots: int = 3,
) -> Dict[str, Any]:
    """
    Atomically publish a ComputedIndustrySnapshot.
    If any write fails, rolls back completely so readers continue seeing the prior
    completed snapshot without partial state.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    snapshot_id = (
        f"{snapshot.trade_date.replace('-', '')}_"
        f"{datetime.now(timezone.utc).strftime('%H%M%S')}_{uuid.uuid4().hex[:6]}"
    )

    try:
        db_bytes = check_db_storage_guard(conn)

        with conn.cursor() as cur:
            # 1. Create pending snapshot record
            cur.execute(
                """
                INSERT INTO industry_snapshots (
                    snapshot_id, trade_date, classification_date, methodology_version,
                    total_stocks, classified_stocks, eligible_stocks, group_count, status
                ) VALUES (%s, %s, CURRENT_DATE, %s, %s, %s, %s, %s, 'pending');
                """,
                (
                    snapshot_id,
                    snapshot.trade_date,
                    METHODOLOGY_VERSION,
                    snapshot.total_stocks,
                    snapshot.classified_stocks,
                    snapshot.eligible_stocks,
                    len(snapshot.groups),
                ),
            )

            # 2. Upsert industry_groups
            if snapshot.groups:
                grp_tuples = [
                    (
                        g["group_id"],
                        g["level"],
                        g["label"],
                        g["parent_id"],
                        g["macro_label"],
                        g["sector_label"],
                        g["industry_label"],
                        g["basic_industry_label"],
                        g["full_path"],
                    )
                    for g in snapshot.groups
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO industry_groups (
                        group_id, level, label, parent_id,
                        macro_label, sector_label, industry_label, basic_industry_label, full_path
                    ) VALUES %s
                    ON CONFLICT (group_id) DO UPDATE SET
                        level = EXCLUDED.level,
                        label = EXCLUDED.label,
                        parent_id = EXCLUDED.parent_id,
                        macro_label = EXCLUDED.macro_label,
                        sector_label = EXCLUDED.sector_label,
                        industry_label = EXCLUDED.industry_label,
                        basic_industry_label = EXCLUDED.basic_industry_label,
                        full_path = EXCLUDED.full_path;
                    """,
                    grp_tuples,
                    page_size=500,
                )

            # 3. Upsert daily_industry_strength
            if snapshot.daily_strength_rows:
                str_tuples = [
                    (
                        r["trade_date"], r["group_id"], r["universe"], r["n_stocks"], r["n_eligible"],
                        r["adv"], r["dec"], r["unch"], r.get("n_20d_high", 0), r.get("n_20d_low", 0),
                        r["ret_1d"], r["ret_1w"], r["ret_1m"], r["ret_3m"], r["ret_6m"],
                        r.get("median_1d"), r.get("median_1w"), r.get("median_1m"),
                        r.get("median_3m"), r.get("median_6m"), r.get("median_1y"), r.get("median_ytd"),
                        r["rs_sts"], r["rs_sts_prev"], r["rs_line"], r["rs_above_ema21"],
                        r["pct_above_20ema"], r["pct_above_50dma"], r["pct_above_200dma"],
                        r["n_valid_20ema"], r["n_valid_50dma"], r["n_valid_200dma"],
                        r["mcap_cr"], r["rank"],
                        r.get("rank_trend"), r.get("rank_trend_prev5"), r.get("rank_trend_change"),
                    )
                    for r in snapshot.daily_strength_rows
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO daily_industry_strength (
                        trade_date, group_id, universe, n_stocks, n_eligible,
                        adv, dec, unch, n_20d_high, n_20d_low,
                        ret_1d, ret_1w, ret_1m, ret_3m, ret_6m,
                        median_1d, median_1w, median_1m, median_3m, median_6m, median_1y, median_ytd,
                        rs_sts, rs_sts_prev, rs_line, rs_above_ema21,
                        pct_above_20ema, pct_above_50dma, pct_above_200dma,
                        n_valid_20ema, n_valid_50dma, n_valid_200dma, mcap_cr, rank,
                        rank_trend, rank_trend_prev5, rank_trend_change
                    ) VALUES %s
                    ON CONFLICT (trade_date, group_id, universe) DO UPDATE SET
                        n_stocks = EXCLUDED.n_stocks,
                        n_eligible = EXCLUDED.n_eligible,
                        adv = EXCLUDED.adv,
                        dec = EXCLUDED.dec,
                        unch = EXCLUDED.unch,
                        n_20d_high = EXCLUDED.n_20d_high,
                        n_20d_low = EXCLUDED.n_20d_low,
                        ret_1d = EXCLUDED.ret_1d,
                        ret_1w = EXCLUDED.ret_1w,
                        ret_1m = EXCLUDED.ret_1m,
                        ret_3m = EXCLUDED.ret_3m,
                        ret_6m = EXCLUDED.ret_6m,
                        median_1d = EXCLUDED.median_1d,
                        median_1w = EXCLUDED.median_1w,
                        median_1m = EXCLUDED.median_1m,
                        median_3m = EXCLUDED.median_3m,
                        median_6m = EXCLUDED.median_6m,
                        median_1y = EXCLUDED.median_1y,
                        median_ytd = EXCLUDED.median_ytd,
                        rs_sts = EXCLUDED.rs_sts,
                        rs_sts_prev = EXCLUDED.rs_sts_prev,
                        rs_line = EXCLUDED.rs_line,
                        rs_above_ema21 = EXCLUDED.rs_above_ema21,
                        pct_above_20ema = EXCLUDED.pct_above_20ema,
                        pct_above_50dma = EXCLUDED.pct_above_50dma,
                        pct_above_200dma = EXCLUDED.pct_above_200dma,
                        n_valid_20ema = EXCLUDED.n_valid_20ema,
                        n_valid_50dma = EXCLUDED.n_valid_50dma,
                        n_valid_200dma = EXCLUDED.n_valid_200dma,
                        mcap_cr = EXCLUDED.mcap_cr,
                        rank = EXCLUDED.rank,
                        rank_trend = EXCLUDED.rank_trend,
                        rank_trend_prev5 = EXCLUDED.rank_trend_prev5,
                        rank_trend_change = EXCLUDED.rank_trend_change;
                    """,
                    str_tuples,
                    page_size=1000,
                )

            # 4. Insert latest_industry_stock_metrics keyed by snapshot_id
            if snapshot.stock_metric_rows:
                sm_tuples = [
                    (
                        snapshot_id, r["trade_date"], r["token"], r["symbol"], r["name"], r["isin"],
                        r["macro"], r["sector"], r["industry"], r["basic_industry"],
                        r["in_universe"], r["is_liquid"], r["is_new_listing"], r["listing_sessions"],
                        r["close"], r["ret_1d"], r["ret_1w"], r["ret_1m"], r["ret_3m"], r["ret_6m"],
                        r.get("ret_1y"), r.get("ret_ytd"), r.get("at_20d_high"), r.get("at_20d_low"),
                        r["pct_from_52w_high"], r["adr_pct"], r["above_20ema"], r["above_50dma"], r["above_200dma"],
                        r["rs_sts"], r["rs_above_ema21"], r["rs_rating"], r["avg_turnover_cr"], r["mcap_cr"],
                    )
                    for r in snapshot.stock_metric_rows
                ]
                execute_values(
                    cur,
                    """
                    INSERT INTO latest_industry_stock_metrics (
                        snapshot_id, trade_date, token, symbol, name, isin,
                        macro, sector, industry, basic_industry,
                        in_universe, is_liquid, is_new_listing, listing_sessions,
                        close, ret_1d, ret_1w, ret_1m, ret_3m, ret_6m,
                        ret_1y, ret_ytd, at_20d_high, at_20d_low,
                        pct_from_52w_high, adr_pct, above_20ema, above_50dma, above_200dma,
                        rs_sts, rs_above_ema21, rs_rating, avg_turnover_cr, mcap_cr
                    ) VALUES %s
                    ON CONFLICT (snapshot_id, token) DO NOTHING;
                    """,
                    sm_tuples,
                    page_size=1000,
                )

            # 5. Mark snapshot completed
            cur.execute(
                """
                UPDATE industry_snapshots
                SET status = 'completed', completed_at = NOW()
                WHERE snapshot_id = %s;
                """,
                (snapshot_id,),
            )

            # 6. Prune old stock snapshot rows beyond keep_stock_snapshots to stay compact
            cur.execute(
                """
                DELETE FROM latest_industry_stock_metrics
                WHERE snapshot_id NOT IN (
                    SELECT snapshot_id FROM industry_snapshots
                    WHERE status = 'completed'
                    ORDER BY completed_at DESC
                    LIMIT %s
                );
                """,
                (keep_stock_snapshots,),
            )

        conn.commit()
        logger.info(
            f"Published industry snapshot {snapshot_id} for {snapshot.trade_date}: "
            f"groups={len(snapshot.groups)}, strength_rows={len(snapshot.daily_strength_rows)}, "
            f"stocks={len(snapshot.stock_metric_rows)}, db_mb={db_bytes / (1024*1024):.1f}"
        )
        return {
            "status": "completed",
            "snapshot_id": snapshot_id,
            "trade_date": snapshot.trade_date,
            "groups": len(snapshot.groups),
            "strength_rows": len(snapshot.daily_strength_rows),
            "stock_rows": len(snapshot.stock_metric_rows),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        if should_close and conn:
            conn.close()


def sync_stock_candles(
    df_ohlcv: pd.DataFrame,
    liquid_tokens: Iterable[int],
    conn=None,
    window_sessions: int = STOCK_CANDLE_WINDOW,
) -> Dict[str, Any]:
    """
    Upsert trailing `window_sessions` (default 260) OHLCV candles into `stock_candles`
    for every liquid classified stock, delete non-liquid tokens, and prune older rows.
    """
    tok_set = sorted({int(t) for t in liquid_tokens})
    if not tok_set or df_ohlcv is None or df_ohlcv.empty:
        return {"status": "skipped", "tokens": 0, "rows": 0}

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        check_db_storage_guard(conn)

        sub = df_ohlcv[df_ohlcv["token"].isin(tok_set)].copy()
        if sub.empty:
            return {"status": "skipped", "tokens": 0, "rows": 0}

        sub["trade_date"] = sub["trade_date"].astype(str).str.slice(0, 10)
        sub = sub.sort_values(["token", "trade_date"])
        sub = sub.groupby("token", sort=False).tail(window_sessions)

        records = [
            (
                int(r.token),
                r.trade_date,
                round(float(r.open), 2) if pd.notna(r.open) else None,
                round(float(r.high), 2) if pd.notna(r.high) else None,
                round(float(r.low), 2) if pd.notna(r.low) else None,
                round(float(r.close), 2),
                int(r.volume) if pd.notna(r.volume) else None,
            )
            for r in sub.itertuples(index=False)
            if pd.notna(r.close) and float(r.close) > 0
        ]

        with conn.cursor() as cur:
            cur.execute("DELETE FROM stock_candles WHERE NOT (token = ANY(%s));", (tok_set,))
            if records:
                execute_values(
                    cur,
                    """
                    INSERT INTO stock_candles (token, trade_date, open, high, low, close, volume)
                    VALUES %s
                    ON CONFLICT (token, trade_date) DO UPDATE SET
                        open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume;
                    """,
                    records,
                    page_size=2000,
                )
            cur.execute(
                """
                DELETE FROM stock_candles
                WHERE (token, trade_date) IN (
                    SELECT token, trade_date FROM (
                        SELECT token, trade_date,
                               ROW_NUMBER() OVER (PARTITION BY token ORDER BY trade_date DESC) AS rn
                        FROM stock_candles
                    ) ranked
                    WHERE rn > %s
                );
                """,
                (window_sessions,),
            )
        conn.commit()
        logger.info(f"Synced {len(records)} stock_candles rows for {len(tok_set)} liquid classified tokens.")
        return {"status": "completed", "tokens": len(tok_set), "rows": len(records)}
    except Exception:
        conn.rollback()
        raise
    finally:
        if should_close and conn:
            conn.close()


def run_industry_strength_job(
    df_ohlcv,
    conn=None,
    as_of_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Helper to load classification lookup, NIFTY 500 benchmark series, and mcap map
    from DB and run compute_industry_strength_snapshot + publish_industry_snapshot.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, name, isin, macro_sector, sector, industry, basic_industry
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                  AND COALESCE(classification_status, '') != 'delisted';
                """
            )
            classifications = {
                int(r[0]): {
                    "symbol": r[1],
                    "name": r[2],
                    "isin": r[3],
                    "macro": r[4],
                    "sector": r[5],
                    "industry": r[6],
                    "basic_industry": r[7],
                }
                for r in cur.fetchall()
            }

            cur.execute(
                """
                SELECT trade_date::text, close
                FROM daily_index_ohlcv
                WHERE index_name = 'NIFTY 500'
                ORDER BY trade_date ASC;
                """
            )
            bench_series = {
                str(r[0]).split("T")[0]: float(r[1])
                for r in cur.fetchall()
                if r[1] is not None and float(r[1]) > 0
            }

            cur.execute(
                """
                SELECT symbol, mcap_rs / 10000000.0 AS mcap_cr
                FROM stock_mcap
                WHERE mcap_rs > 0;
                """
            )
            mcap_map = {str(r[0]).upper(): float(r[1]) for r in cur.fetchall()}

        snapshot = compute_industry_strength_snapshot(
            df_ohlcv=df_ohlcv,
            classifications=classifications,
            bench_series=bench_series,
            mcap_by_symbol=mcap_map,
            as_of_date=as_of_date,
        )
        # Populate rank_trend_prev5 and rank_trend_change from 5 sessions prior
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT trade_date::text
                FROM daily_industry_strength
                WHERE trade_date < %s
                ORDER BY trade_date DESC
                LIMIT 5;
                """,
                (snapshot.trade_date,),
            )
            prior_dates = [str(r[0]).split("T")[0] for r in cur.fetchall()]
            if len(prior_dates) >= 5:
                prev5_date = prior_dates[4]
                cur.execute(
                    "SELECT group_id, universe, rank_trend FROM daily_industry_strength WHERE trade_date = %s;",
                    (prev5_date,),
                )
                prev5_map = {(r[0], r[1]): r[2] for r in cur.fetchall() if r[2] is not None}
                for row in snapshot.daily_strength_rows:
                    p5 = prev5_map.get((row["group_id"], row["universe"]))
                    row["rank_trend_prev5"] = p5
                    if p5 is not None and row.get("rank_trend") is not None:
                        row["rank_trend_change"] = int(p5) - int(row["rank_trend"])

        pub_res = publish_industry_snapshot(snapshot, conn=conn)
        try:
            from pipeline.industry_top_groups import publish_top_groups
            pub_res["top_groups"] = publish_top_groups(snapshot.trade_date, conn=conn, generate_notes=True)
        except Exception as tge:
            logger.warning(f"Non-fatal top_groups publish notice: {tge}")
        try:
            liquid_tokens = [
                r["token"] for r in snapshot.stock_metric_rows
                if r.get("in_universe") and r.get("is_liquid")
            ]
            candle_res = sync_stock_candles(df_ohlcv, liquid_tokens, conn=conn)
            pub_res["stock_candles"] = candle_res
        except Exception as ce:
            logger.warning(f"Non-fatal stock_candles sync notice: {ce}")
        return pub_res
    finally:
        if should_close and conn:
            conn.close()


def backfill_industry_strength(
    df_ohlcv,
    conn=None,
    from_date: Optional[str] = None,
    sessions: int = 250,
) -> Dict[str, Any]:
    """
    Backfill daily_industry_strength across historical sessions (default 250)
    with rank_trend, rank_trend_prev5, rank_trend_change, 20D H/L, and medians,
    then publish the latest completed snapshot atomically.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        db_bytes = check_db_storage_guard(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, name, isin, macro_sector, sector, industry, basic_industry
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                  AND COALESCE(classification_status, '') != 'delisted';
                """
            )
            classifications = {
                int(r[0]): {
                    "symbol": r[1],
                    "name": r[2],
                    "isin": r[3],
                    "macro": r[4],
                    "sector": r[5],
                    "industry": r[6],
                    "basic_industry": r[7],
                }
                for r in cur.fetchall()
            }
            cur.execute(
                "SELECT trade_date::text, close FROM daily_index_ohlcv WHERE index_name = 'NIFTY 500' ORDER BY trade_date ASC;"
            )
            bench_series = {
                str(r[0]).split("T")[0]: float(r[1])
                for r in cur.fetchall()
                if r[1] is not None and float(r[1]) > 0
            }
            cur.execute("SELECT symbol, mcap_rs / 10000000.0 AS mcap_cr FROM stock_mcap WHERE mcap_rs > 0;")
            mcap_map = {str(r[0]).upper(): float(r[1]) for r in cur.fetchall()}

        all_dates = sorted(str(d)[:10] for d in df_ohlcv["trade_date"].unique())
        bench_dates = set(bench_series.keys())
        valid_dates = [d for d in all_dates if d in bench_dates]
        if from_date:
            target_dates = [d for d in valid_dates if d >= from_date]
        else:
            target_dates = valid_dates[-sessions:]

        if not target_dates:
            return {"status": "skipped", "reason": "no_target_dates"}

        if should_close:
            conn.close()
            conn = None

        prepared = prepare_stock_arrays(df_ohlcv, classifications)
        all_groups: Dict[str, Dict[str, Any]] = {}
        all_strength_rows: List[Dict[str, Any]] = []
        latest_snap: Optional[ComputedIndustrySnapshot] = None
        rank_history: Dict[tuple, List[Optional[int]]] = {}

        for d in target_dates:
            snap = compute_industry_strength_snapshot(
                df_ohlcv=None,
                classifications=classifications,
                bench_series=bench_series,
                mcap_by_symbol=mcap_map,
                as_of_date=d,
                prepared_stocks=prepared,
            )
            for g in snap.groups:
                all_groups[g["group_id"]] = g
            for row in snap.daily_strength_rows:
                key = (row["group_id"], row["universe"])
                hist = rank_history.setdefault(key, [])
                cur_rt = row.get("rank_trend")
                if len(hist) >= 5:
                    p5 = hist[-5]
                    row["rank_trend_prev5"] = p5
                    if p5 is not None and cur_rt is not None:
                        row["rank_trend_change"] = int(p5) - int(cur_rt)
                hist.append(cur_rt)
            all_strength_rows.extend(snap.daily_strength_rows)
            latest_snap = snap

        if conn is None:
            conn = get_connection()
            should_close = True

        with conn.cursor() as cur:
            if all_groups:
                execute_values(
                    cur,
                    """
                    INSERT INTO industry_groups (
                        group_id, level, label, parent_id,
                        macro_label, sector_label, industry_label, basic_industry_label, full_path
                    ) VALUES %s
                    ON CONFLICT (group_id) DO UPDATE SET
                        level = EXCLUDED.level, label = EXCLUDED.label, parent_id = EXCLUDED.parent_id,
                        macro_label = EXCLUDED.macro_label, sector_label = EXCLUDED.sector_label,
                        industry_label = EXCLUDED.industry_label,
                        basic_industry_label = EXCLUDED.basic_industry_label,
                        full_path = EXCLUDED.full_path;
                    """,
                    [
                        (
                            g["group_id"], g["level"], g["label"], g["parent_id"],
                            g["macro_label"], g["sector_label"], g["industry_label"],
                            g["basic_industry_label"], g["full_path"],
                        )
                        for g in all_groups.values()
                    ],
                    page_size=500,
                )
            if all_strength_rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO daily_industry_strength (
                        trade_date, group_id, universe, n_stocks, n_eligible,
                        adv, dec, unch, n_20d_high, n_20d_low,
                        ret_1d, ret_1w, ret_1m, ret_3m, ret_6m,
                        median_1d, median_1w, median_1m, median_3m, median_6m, median_1y, median_ytd,
                        rs_sts, rs_sts_prev, rs_line, rs_above_ema21,
                        pct_above_20ema, pct_above_50dma, pct_above_200dma,
                        n_valid_20ema, n_valid_50dma, n_valid_200dma, mcap_cr, rank,
                        rank_trend, rank_trend_prev5, rank_trend_change
                    ) VALUES %s
                    ON CONFLICT (trade_date, group_id, universe) DO UPDATE SET
                        n_stocks = EXCLUDED.n_stocks, n_eligible = EXCLUDED.n_eligible,
                        adv = EXCLUDED.adv, dec = EXCLUDED.dec, unch = EXCLUDED.unch,
                        n_20d_high = EXCLUDED.n_20d_high, n_20d_low = EXCLUDED.n_20d_low,
                        ret_1d = EXCLUDED.ret_1d, ret_1w = EXCLUDED.ret_1w, ret_1m = EXCLUDED.ret_1m,
                        ret_3m = EXCLUDED.ret_3m, ret_6m = EXCLUDED.ret_6m,
                        median_1d = EXCLUDED.median_1d, median_1w = EXCLUDED.median_1w,
                        median_1m = EXCLUDED.median_1m, median_3m = EXCLUDED.median_3m,
                        median_6m = EXCLUDED.median_6m, median_1y = EXCLUDED.median_1y,
                        median_ytd = EXCLUDED.median_ytd,
                        rs_sts = EXCLUDED.rs_sts, rs_sts_prev = EXCLUDED.rs_sts_prev,
                        rs_line = EXCLUDED.rs_line, rs_above_ema21 = EXCLUDED.rs_above_ema21,
                        pct_above_20ema = EXCLUDED.pct_above_20ema,
                        pct_above_50dma = EXCLUDED.pct_above_50dma,
                        pct_above_200dma = EXCLUDED.pct_above_200dma,
                        n_valid_20ema = EXCLUDED.n_valid_20ema,
                        n_valid_50dma = EXCLUDED.n_valid_50dma,
                        n_valid_200dma = EXCLUDED.n_valid_200dma,
                        mcap_cr = EXCLUDED.mcap_cr, rank = EXCLUDED.rank,
                        rank_trend = EXCLUDED.rank_trend,
                        rank_trend_prev5 = EXCLUDED.rank_trend_prev5,
                        rank_trend_change = EXCLUDED.rank_trend_change;
                    """,
                    [
                        (
                            r["trade_date"], r["group_id"], r["universe"], r["n_stocks"], r["n_eligible"],
                            r["adv"], r["dec"], r["unch"], r.get("n_20d_high", 0), r.get("n_20d_low", 0),
                            r["ret_1d"], r["ret_1w"], r["ret_1m"], r["ret_3m"], r["ret_6m"],
                            r.get("median_1d"), r.get("median_1w"), r.get("median_1m"),
                            r.get("median_3m"), r.get("median_6m"), r.get("median_1y"), r.get("median_ytd"),
                            r["rs_sts"], r["rs_sts_prev"], r["rs_line"],
                            r["rs_above_ema21"], r["pct_above_20ema"], r["pct_above_50dma"],
                            r["pct_above_200dma"], r["n_valid_20ema"], r["n_valid_50dma"],
                            r["n_valid_200dma"], r["mcap_cr"], r["rank"],
                            r.get("rank_trend"), r.get("rank_trend_prev5"), r.get("rank_trend_change"),
                        )
                        for r in all_strength_rows
                    ],
                    page_size=2000,
                )
        conn.commit()

        pub_res = publish_industry_snapshot(latest_snap, conn=conn) if latest_snap else {}
        if latest_snap:
            try:
                from pipeline.industry_top_groups import backfill_top_groups
                pub_res["top_groups"] = backfill_top_groups(days=30, conn=conn, generate_notes_latest=False)
            except Exception as tge:
                logger.warning(f"Non-fatal top_groups backfill notice: {tge}")
        return {
            "status": "completed",
            "sessions": len(target_dates),
            "strength_rows": len(all_strength_rows),
            "latest_snapshot": pub_res,
            "db_mb": round(db_bytes / (1024 * 1024), 2),
        }
    finally:
        if should_close and conn:
            conn.close()
