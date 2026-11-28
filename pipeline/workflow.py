import logging
import os
import time
from datetime import datetime, date, timedelta, timezone
from typing import Dict, Any, Callable, Optional
from pipeline.config import RETENTION_YEARS, EQUITY_PARQUET_PATH
from pipeline.alerts import send_telegram_alert
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.workflow")

def get_latest_completed_trading_day(now_ist: Optional[datetime] = None, conn=None) -> date:
    """
    Returns latest completed trading day in IST based on time only (S0-1):
    - Today if weekday (Mon-Fri) and IST >= 18:30 (matching bhavcopy publication rule)
    - Else the previous weekday.
    No Neon Nifty queries (avoids circular dependency with workflow sync steps).
    """
    if now_ist is None:
        ist = timezone(timedelta(hours=5, minutes=30))
        now_ist = datetime.now(ist)
    today = now_ist.date()
    # Market closes at 15:30 IST; by 18:30 IST bhavcopy and daily session are complete
    if today.weekday() < 5 and (now_ist.hour > 18 or (now_ist.hour == 18 and now_ist.minute >= 30)):
        return today
    # Prior weekday
    curr = today - timedelta(days=1)
    while curr.weekday() >= 5:
        curr -= timedelta(days=1)
    return curr

def check_workflow_branch(
    parquet_path: str,
    conn=None,
    now_ist: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Evaluates Parquet date vs Neon daily_market_breadth date (C2):
    - 'idempotent_no_op': parquet_max == breadth_max and no weekday gap up to latest completed trading day
    - 'compute_only': parquet_max > breadth_max (previous publish failed, skip ingest)
    - 'full_workflow': all other cases
    """
    if not os.path.exists(parquet_path):
        return {"branch": "full_workflow", "reason": "parquet_missing"}

    try:
        import pandas as pd
        df = pd.read_parquet(parquet_path, columns=["trade_date"])
        if df.empty or "trade_date" not in df.columns:
            return {"branch": "full_workflow", "reason": "parquet_empty"}
        parquet_max = df["trade_date"].max()
    except Exception as e:
        logger.warning(f"Error reading parquet for branch check: {e}")
        return {"branch": "full_workflow", "reason": str(e)}

    breadth_max = None
    should_close = False
    try:
        if conn is None:
            from pipeline.db import get_connection
            conn = get_connection()
            should_close = True
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(trade_date)::text FROM daily_market_breadth;")
            row = cur.fetchone()
            if row and row[0]:
                breadth_max = str(row[0]).split("T")[0]
    except Exception as e:
        logger.warning(f"Could not query max trade_date from daily_market_breadth: {e}")
    finally:
        if should_close and conn:
            try:
                conn.close()
            except Exception:
                pass

    if not breadth_max:
        return {"branch": "full_workflow", "reason": "breadth_empty", "parquet_max": parquet_max}

    latest_trading_day = get_latest_completed_trading_day(now_ist=now_ist, conn=conn)
    latest_day_str = latest_trading_day.strftime("%Y-%m-%d")

    # If parquet is newer than breadth: previous publish failed, skip ingest and run compute only
    if parquet_max > breadth_max:
        return {
            "branch": "compute_only",
            "parquet_max": parquet_max,
            "breadth_max": breadth_max,
            "latest_trading_day": latest_day_str
        }

    # If parquet equals breadth and no weekday gap exists up to latest completed trading day
    if parquet_max == breadth_max and parquet_max >= latest_day_str:
        return {
            "branch": "idempotent_no_op",
            "parquet_max": parquet_max,
            "breadth_max": breadth_max,
            "latest_trading_day": latest_day_str
        }

    return {
        "branch": "full_workflow",
        "parquet_max": parquet_max,
        "breadth_max": breadth_max,
        "latest_trading_day": latest_day_str
    }

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
    conn = None
    try:
        from pipeline.db import get_connection
        conn = get_connection()
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
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass
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

    # C2 Idempotent no-op and compute-only branch checks
    branch_info = check_workflow_branch(pq_path)
    branch = branch_info.get("branch", "full_workflow")
    logger.info(f"Daily workflow branch decision: {branch} (details: {branch_info})")

    if branch == "idempotent_no_op":
        msg = (
            f"Idempotent no-op: Parquet newest date ({branch_info.get('parquet_max')}) "
            f"equals breadth max date ({branch_info.get('breadth_max')}) and is up to date "
            f"with latest trading day ({branch_info.get('latest_trading_day')}). Exiting success in under 1 minute."
        )
        logger.info(msg)
        return {
            "status": "success",
            "branch": "idempotent_no_op",
            "parquet_max": branch_info.get("parquet_max"),
            "breadth_max": branch_info.get("breadth_max"),
            "elapsed_seconds": round(time.time() - workflow_start_time, 2),
            "trimmed": False
        }

    if branch == "compute_only":
        logger.info(
            f"Compute-only branch: Parquet newest date ({branch_info.get('parquet_max')}) is newer than "
            f"breadth max date ({branch_info.get('breadth_max')}). Skipping ingest steps 1-7, running compute only."
        )

    res6 = None
    equities_run_id = None
    degraded_steps = []
    if branch != "compute_only":
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

        # Step 1b. Incremental NSE 4-level classification sync (non-fatal: preserves prior valid mappings)
        if sync_instruments_fn is None:
            try:
                from pipeline.classification import sync_classification
                cls_res = sync_classification(fetch_equity=True)
                logger.info(f"Step 1b complete: classification sync ({cls_res}).")
            except Exception as ce:
                logger.warning(f"Step 1b (sync_classification) failed, preserving prior mappings: {ce}")
                degraded_steps.append("sync_classification")

        # 2. sync_constituents (non-core: degraded if stored constituents exist)
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
            from pipeline.instruments import check_stored_constituents_exist
            if check_stored_constituents_exist():
                logger.warning(f"Using stored constituents because sync_constituents failed: {e}")
                degraded_steps.append("sync_constituents")
            else:
                msg = f"Step 2 (sync_constituents) failed and index_constituents is missing or incomplete: {e}"
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

        # 4. sync_macro (non-core: degraded)
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
            logger.warning(f"Step 4 (sync_macro) failed, continuing in degraded mode: {e}")
            degraded_steps.append("sync_macro")

        # 5. sync_fii_dii (non-core: degraded)
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
            logger.warning(f"Step 5 (sync_fii_dii) failed, continuing in degraded mode: {e}")
            degraded_steps.append("sync_fii_dii")

        # 6. ingest_equities
        logger.info("Step 6/9: ingest_equities")
        t0 = time.time()
        try:
            # S0-2: Dedupe store if duplicate symbols across tokens exist (cheap, no Angel calls, writes backup)
            if os.path.exists(pq_path):
                try:
                    import pandas as _pd
                    _chk_df = _pd.read_parquet(pq_path, columns=["symbol", "token"])
                    if not _chk_df.empty and (_chk_df.groupby("symbol")["token"].nunique() > 1).any():
                        logger.info("Duplicate symbols across tokens found in Parquet. Running dedupe before ingest...")
                        from pipeline.dedupe import dedupe_equity_parquet
                        dedupe_equity_parquet(parquet_path=pq_path, conn=conn)
                except Exception as _dedup_err:
                    logger.warning(f"Notice: pre-ingest dedupe check encountered: {_dedup_err}")

            fn6 = ingest_equities_fn
            if fn6 is None:
                daily_source = os.environ.get("DAILY_SOURCE", "bhavcopy").strip().lower()
                if daily_source == "bhavcopy":
                    logger.info("Using DAILY_SOURCE=bhavcopy for equities ingest.")
                    from pipeline.bhavcopy import ingest_bhavcopy
                    fn6 = ingest_bhavcopy
                else:
                    logger.info("Using DAILY_SOURCE=angel for equities ingest.")
                    from pipeline.ingest import ingest_equities
                    fn6 = ingest_equities
            res6 = fn6(parquet_path=pq_path, tokens_limit=tokens_limit)
            if isinstance(res6, dict):
                equities_run_id = res6.get("run_id")
                if res6.get("status") == "failed":
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

        # 6b. sync_mcap (Tab 3 Industry Rotation I1)
        logger.info("Step 6b: sync_stock_mcap (bulk market cap and issue size)")
        try:
            from pipeline.industries import sync_stock_mcap
            res_mcap = sync_stock_mcap(conn=conn)
            logger.info(f"Step 6b sync_stock_mcap result: {res_mcap}")
        except Exception as _mcap_err:
            logger.warning(f"Step 6b sync_stock_mcap encountered error (non-fatal): {_mcap_err}")

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
        if os.path.exists(pq_path):
            try:
                import pandas as _pd
                _chk_df = _pd.read_parquet(pq_path, columns=["symbol", "token"])
                if not _chk_df.empty and (_chk_df.groupby("symbol")["token"].nunique() > 1).any():
                    logger.info("Duplicate symbols found before quality gate. Running dedupe...")
                    from pipeline.dedupe import dedupe_equity_parquet
                    dedupe_equity_parquet(parquet_path=pq_path, conn=conn)
            except Exception as _dedup_err:
                logger.warning(f"Notice: pre-quality-gate dedupe check encountered: {_dedup_err}")

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
        if isinstance(res8, dict) and res8.get("sector_degraded"):
            logger.warning("compute_sector_metrics reported degradation in Step 8.")
            degraded_steps.append("compute_sector_metrics")
        logger.info(f"Step 8 complete: breadth computed and published. Step 8/9 done in {time.time() - t0:.1f}s")
    except Exception as e:
        msg = f"Step 8 (compute_and_publish_all) failed: {e}"
        logger.error(msg)
        send_telegram_alert(msg)
        return {"status": "failed", "step": "compute_and_publish_all", "error": str(e), "trimmed": False}

    # Step 8b. build_daily_plan (non-fatal)
    try:
        from pipeline.plan import build_daily_plan
        logger.info("Step 8b: build_daily_plan")
        res8b = build_daily_plan(store_control=True)
        logger.info(f"Step 8b complete: daily_plan built ({res8b}).")
    except Exception as pe:
        logger.warning(f"Step 8b (build_daily_plan) failed, continuing non-fatally: {pe}")

    # Step 8c. compute_plan_outcomes (non-fatal)
    try:
        from pipeline.plan_outcomes import compute_plan_outcomes
        logger.info("Step 8c: compute_plan_outcomes")
        res8c = compute_plan_outcomes(default_source="live")
        logger.info(f"Step 8c complete: plan_outcomes updated ({res8c}).")
    except Exception as oe:
        logger.warning(f"Step 8c (compute_plan_outcomes) failed, continuing non-fatally: {oe}")

    # Step 8d. send_daily_plan_telegram (non-fatal, idempotent)
    try:
        from pipeline.plan_notify import send_daily_plan_telegram
        logger.info("Step 8d: send_daily_plan_telegram")
        res8d = send_daily_plan_telegram()
        logger.info(f"Step 8d complete: telegram summary ({res8d}).")
    except Exception as te:
        logger.warning(f"Step 8d (send_daily_plan_telegram) failed, continuing non-fatally: {te}")

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
    from pipeline.smartapi_client import get_angel_stats
    stats = get_angel_stats()
    angel_calls = stats["calls"]
    throttle_count = stats["throttles"]
    rate_at_end = stats["rate"]
    logger.info(
        f"Workflow Summary: Total time: {workflow_total_time:.1f}s | "
        f"Angel calls: {angel_calls} | Throttles: {throttle_count} | End rate: {rate_at_end:.2f} req/s"
    )

    if degraded_steps:
        alert_msg = f"[Pipeline Alert] Non-core step(s) degraded: {', '.join(degraded_steps)}"
        logger.warning(alert_msg)
        send_telegram_alert(alert_msg)
        conn = None
        try:
            from pipeline.db import get_connection
            conn = get_connection()
            with conn.cursor() as cur:
                if equities_run_id is not None:
                    cur.execute("""
                        UPDATE ingest_runs
                        SET status = 'partial',
                            error_message = CASE
                                WHEN error_message IS NULL OR error_message = '' THEN %s
                                ELSE error_message || ' | ' || %s
                            END
                        WHERE run_id = %s;
                    """, (f"degraded_steps: {degraded_steps}", f"degraded_steps: {degraded_steps}", equities_run_id))
                else:
                    from pipeline.ingest import log_ingest_run
                    log_ingest_run(
                        run_type="daily_workflow",
                        status="partial",
                        total=0,
                        success=0,
                        failed=0,
                        started_at=datetime.fromtimestamp(workflow_start_time),
                        error_msg=f"degraded_steps: {degraded_steps}",
                        quality_gate_passed=True,
                        conn=conn
                    )
            conn.commit()
        except Exception as _e:
            logger.warning(f"Could not update ingest_runs for degraded status: {_e}")
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass

    status = "partial" if degraded_steps else "success"
    result_payload = {
        "status": status,
        "branch": branch,
        "trimmed": True,
        "trim_result": trim_res,
    }
    if degraded_steps:
        result_payload["degraded_steps"] = degraded_steps

    return result_payload

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

    # Item 7b: Run dedupe automatically at start of weekly full refetch
    try:
        from pipeline.dedupe import dedupe_equity_parquet
        dedupe_equity_parquet(parquet_path=pq_path)
    except Exception as de:
        logger.warning(f"Notice: pre-weekly refetch dedupe encountered: {de}")

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
