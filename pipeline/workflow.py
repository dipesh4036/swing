import logging
import os
import time
from datetime import datetime
from typing import Dict, Any, Callable, Optional
from pipeline.config import RETENTION_YEARS, EQUITY_PARQUET_PATH
from pipeline.alerts import send_telegram_alert

logger = logging.getLogger("pipeline.workflow")

def check_storage_guard_and_prune() -> Dict[str, Any]:
    """
    At the start of the daily job, checks database size:
    SELECT pg_database_size(current_database());
    If it exceeds 700 MB, sends a Telegram alert and prunes rows older than 90 days from ingest_runs.
    Aggregates (daily_market_breadth and daily_fii_dii_cash) are small and must never be pruned.
    """
    threshold_bytes = 700 * 1024 * 1024  # 700 MB
    db_size = 0
    pruned_count = 0
    exceeded = False
    try:
        from pipeline.db import get_connection
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_database_size(current_database());")
                row = cur.fetchone()
                if row:
                    db_size = row[0]
                size_mb = db_size / (1024 * 1024)
                logger.info(f"Neon database size check: {size_mb:.2f} MB (threshold: 700 MB)")
                if db_size > threshold_bytes:
                    exceeded = True
                    msg = (
                        f"⚠️ Neon DB size warning: Current database size is {size_mb:.1f} MB, "
                        f"exceeding safe threshold of 700 MB. Pruning ingest_runs older than 90 days."
                    )
                    logger.warning(msg)
                    send_telegram_alert(msg)
                    cur.execute("DELETE FROM ingest_runs WHERE started_at < NOW() - INTERVAL '90 days';")
                    pruned_count = cur.rowcount
                    conn.commit()
                    logger.info(f"Pruned {pruned_count} old records from ingest_runs.")
    except Exception as e:
        logger.error(f"Storage guard check failed: {e}")
    return {"db_size_bytes": db_size, "exceeded": exceeded, "pruned_count": pruned_count}

def run_daily_workflow(
    sync_instruments_fn: Optional[Callable] = None,
    sync_constituents_fn: Optional[Callable] = None,
    sync_indices_fn: Optional[Callable] = None,
    sync_macro_fn: Optional[Callable] = None,
    sync_fii_dii_fn: Optional[Callable] = None,
    ingest_equities_fn: Optional[Callable] = None,
    adjust_fn: Optional[Callable] = None,
    quality_gate_fn: Optional[Callable] = None,
    compute_fn: Optional[Callable] = None,
    trim_fn: Optional[Callable] = None,
    parquet_path: Optional[str] = None,
    tokens_limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Runs the daily pipeline sequence strictly in this order:
    1. sync_instruments
    2. sync_constituents
    3. sync_indices
    4. sync_macro
    5. sync_fii_dii
    6. ingest_equities
    7. adjust
    8. compute_and_publish_all
    9. trim (LAST step, ONLY if all prior steps succeeded)

    If any step fails, stop and do NOT trim.
    """
    logger.info("Starting daily market breadth workflow...")
    workflow_start_time = time.time()
    pq_path = parquet_path or EQUITY_PARQUET_PATH

    # Check Neon storage guard (threshold 700 MB) and prune ingest_runs if needed
    check_storage_guard_and_prune()

    # 1. sync_instruments
    logger.info("Step 1/9: sync_instruments")
    t0 = time.time()
    try:
        fn1 = sync_instruments_fn
        if fn1 is None:
            from pipeline.instruments import sync_instruments
            fn1 = sync_instruments
        res1 = fn1()
        logger.info(f"Step 1 complete: {res1} instruments synced. Step 1/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 1 (sync_instruments) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "sync_instruments", "error": str(e), "trimmed": False}

    # 2. sync_constituents
    logger.info("Step 2/9: sync_constituents")
    t0 = time.time()
    try:
        fn2 = sync_constituents_fn
        if fn2 is None:
            from pipeline.instruments import sync_constituents
            fn2 = sync_constituents
        res2 = fn2()
        logger.info(f"Step 2 complete: constituents synced ({res2}). Step 2/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 2 (sync_constituents) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "sync_constituents", "error": str(e), "trimmed": False}

    # 3. sync_indices
    logger.info("Step 3/9: sync_indices")
    t0 = time.time()
    try:
        fn3 = sync_indices_fn
        if fn3 is None:
            from pipeline.indices_macro import sync_indices
            fn3 = sync_indices
        res3 = fn3()
        logger.info(f"Step 3 complete: indices synced ({res3}). Step 3/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 3 (sync_indices) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "sync_indices", "error": str(e), "trimmed": False}

    # 4. sync_macro
    logger.info("Step 4/9: sync_macro")
    t0 = time.time()
    try:
        fn4 = sync_macro_fn
        if fn4 is None:
            from pipeline.indices_macro import sync_macro
            fn4 = sync_macro
        res4 = fn4()
        logger.info(f"Step 4 complete: macro synced ({res4}). Step 4/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 4 (sync_macro) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "sync_macro", "error": str(e), "trimmed": False}

    # 5. sync_fii_dii
    logger.info("Step 5/9: sync_fii_dii")
    t0 = time.time()
    try:
        fn5 = sync_fii_dii_fn
        if fn5 is None:
            from pipeline.indices_macro import sync_fii_dii
            fn5 = sync_fii_dii
        res5 = fn5()
        logger.info(f"Step 5 complete: FII/DII synced ({res5}). Step 5/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 5 (sync_fii_dii) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "sync_fii_dii", "error": str(e), "trimmed": False}

    # 6. ingest_equities
    logger.info("Step 6/9: ingest_equities")
    t0 = time.time()
    try:
        fn6 = ingest_equities_fn
        if fn6 is None:
            from pipeline.ingest import ingest_equities
            fn6 = ingest_equities
        res6 = fn6(parquet_path=pq_path, tokens_limit=tokens_limit)
        if isinstance(res6, dict) and res6.get("status") == "failed":
            raise RuntimeError(f"Ingest reported failure: {res6}")
        logger.info(f"Step 6 complete: equities ingested ({res6}). Step 6/9 done in {time.time() - t0:.1f}s")

        # A4. Early save: upload immediately if step 6 succeeded and latest date has >= 1,500 tokens
        if os.path.exists(pq_path):
            try:
                import pandas as _pd
                _df = _pd.read_parquet(pq_path, columns=["token", "trade_date"])
                if not _df.empty:
                    _latest = _df["trade_date"].max()
                    _active_count = _df[_df["trade_date"] == _latest]["token"].nunique()
                    min_floor = 1500 if tokens_limit is None else min(tokens_limit, 1500)
                    if _active_count >= min_floor:
                        logger.info(f"Step 6 early upload: latest date {_latest} has {_active_count} tokens >= {min_floor}. Uploading store...")
                        from pipeline.store import upload_parquet_store
                        upload_parquet_store(pq_path, job_succeeded=True)
            except Exception as _ue:
                logger.warning(f"Early upload notice after step 6: {_ue}")
    except Exception as e:
        msg = f"Step 6 (ingest_equities) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "ingest_equities", "error": str(e), "trimmed": False}

    # 7. adjust
    logger.info("Step 7/9: adjust (no Angel calls)")
    t0 = time.time()
    try:
        fn7 = adjust_fn
        if fn7 is None:
            from pipeline.adjust import run_adjustments
            fn7 = run_adjustments
        res7 = fn7(parquet_path=pq_path, tokens_limit=tokens_limit)
        if res7 is False:
            raise RuntimeError("Adjustments returned False")
        logger.info(f"Step 7 complete: adjustments verified. Step 7/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 7 (adjust) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "adjust", "error": str(e), "trimmed": False}

    # Quality Gate Verification (Before compute, publish or trim)
    logger.info("Verifying Quality Gate prior to compute and publish...")
    t0 = time.time()
    try:
        fn_qg = quality_gate_fn
        if fn_qg is None:
            from pipeline.quality_gate import verify_quality_gate
            fn_qg = verify_quality_gate
        fn_qg(parquet_path=pq_path, tokens_limit=tokens_limit, ingest_result=res6 if 'res6' in locals() else None)
        logger.info(f"Quality gate verified successfully in {time.time() - t0:.1f}s.")
    except Exception as e:
        msg = f"Quality Gate failed: {e}. Aborting publish and trim."
        logger.error(msg)
        send_telegram_alert(msg)
        # Record failed quality gate in ingest_runs
        try:
            from pipeline.ingest import log_ingest_run
            log_ingest_run("equities", "failed", 0, 0, 0, datetime.now(), error_msg=str(e), quality_gate_passed=False)
        except Exception:
            pass
        return {"status": "failed", "step": "quality_gate", "error": str(e), "trimmed": False}

    # 8. compute_and_publish_all
    logger.info("Step 8/9: compute_and_publish_all")
    t0 = time.time()
    try:
        fn8 = compute_fn
        if fn8 is None:
            from pipeline.compute import compute_and_publish_all
            fn8 = compute_and_publish_all
        res8 = fn8(parquet_path=pq_path)
        if res8 is False:
            raise RuntimeError("Compute and publish failed")
        logger.info(f"Step 8 complete: breadth computed and published. Step 8/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 8 (compute_and_publish_all) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "compute_and_publish_all", "error": str(e), "trimmed": False}

    # 9. trim (LAST step, executed only after all prior steps succeed)
    logger.info(f"Step 9/9: trim (retention={RETENTION_YEARS}y)")
    t0 = time.time()
    try:
        fn9 = trim_fn
        if fn9 is None:
            from pipeline.trim import trim_equity_parquet
            fn9 = trim_equity_parquet
        trim_res = fn9(parquet_path=pq_path, retention_years=RETENTION_YEARS)
        logger.info(f"Step 9 complete: trim succeeded: {trim_res}. Step 9/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 9 (trim) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "trim", "error": str(e), "trimmed": False}

    workflow_total_time = time.time() - workflow_start_time
    from pipeline.smartapi_client import _client_instance
    angel_calls = getattr(_client_instance, "total_calls", 0) if _client_instance else 0
    throttle_count = getattr(_client_instance, "throttle_count", 0) if _client_instance else 0
    rate_at_end = getattr(_client_instance, "current_req_per_sec", 0.0) if _client_instance else 0.0
    logger.info(
        f"Workflow Summary: Total time: {workflow_total_time:.1f}s | "
        f"Angel calls: {angel_calls} | Throttles: {throttle_count} | End rate: {rate_at_end:.2f} req/s"
    )

    return {
        "status": "success",
        "trimmed": True,
        "trim_result": trim_res,
    }

def run_weekly_refetch(
    retention_years: int = RETENTION_YEARS,
    parquet_path: Optional[str] = None,
    tokens_limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Weekly full re-fetch: requests exactly RETENTION_YEARS of history, not more.
    Executes the full pipeline sequence refreshing all data stores.
    """
    logger.info(f"Initiating weekly full re-fetch for {retention_years} years of history...")
    pq_path = parquet_path or EQUITY_PARQUET_PATH

    # Wire ingest_equities explicitly configured with years=retention_years
    from pipeline.ingest import ingest_equities
    def weekly_ingest(**kwargs):
        return ingest_equities(
            years=retention_years,
            parquet_path=kwargs.get("parquet_path", pq_path),
            tokens_limit=kwargs.get("tokens_limit", tokens_limit)
        )

    from pipeline.indices_macro import sync_indices, sync_macro
    def weekly_indices():
        return sync_indices(years=retention_years)

    def weekly_macro():
        return sync_macro(years=retention_years)

    res = run_daily_workflow(
        sync_indices_fn=weekly_indices,
        sync_macro_fn=weekly_macro,
        ingest_equities_fn=weekly_ingest,
        parquet_path=pq_path,
        tokens_limit=tokens_limit
    )

    if res.get("status") == "success":
        try:
            from pipeline.store import backup_weekly_release
            logger.info("Executing weekly release backup (breadth table export & dated parquet)...")
            backup_weekly_release(parquet_path=pq_path)
            logger.info("Weekly backup complete.")
        except Exception as e:
            logger.error(f"Weekly backup failed: {e}")

    return res
