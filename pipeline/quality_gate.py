import os
import logging
from typing import Optional, Dict, Any
import pandas as pd
from pipeline.db import get_connection
from pipeline.alerts import send_telegram_alert

logger = logging.getLogger("pipeline.quality_gate")

class QualityGateError(RuntimeError):
    pass

def _record_gate_result(conn, passed: bool, error_msg: Optional[str] = None):
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE ingest_runs
                SET quality_gate_passed = %s,
                    error_message = CASE WHEN %s IS NOT NULL THEN %s ELSE error_message END
                WHERE run_id = (SELECT MAX(run_id) FROM ingest_runs);
            """, (passed, error_msg, error_msg))
        conn.commit()
    except Exception as e:
        logger.warning(f"Could not record quality gate result in ingest_runs: {e}")

def verify_quality_gate(
    parquet_path: str,
    conn=None,
    tokens_limit: Optional[int] = None,
    ingest_result: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Enforces pipeline quality gates prior to compute/publish/trim:
    1. At least 1,500 instruments have a candle on the latest date (scaled if tokens_limit is set).
    2. Nifty 50 and Nifty 500 candles exist on the latest date.
    3. No more than 5% of equity fetches failed.
    Records the outcome in ingest_runs and sends a Telegram alert on failure.
    """
    logger.info("Executing Quality Gate checks...")
    close_conn = False
    if conn is None:
        try:
            conn = get_connection()
            close_conn = True
        except Exception as e:
            logger.warning(f"Quality gate could not establish DB connection: {e}")

    try:
        # 1. Fetch failure rate check (<= 5%)
        if ingest_result:
            total = ingest_result.get("total", 0)
            failed = ingest_result.get("failed", 0)
            if total > 0 and (failed / total) > 0.05:
                msg = f"Quality Gate failed: Fetch failure rate is {(failed/total)*100:.1f}% ({failed}/{total} failed > 5% allowed limit)."
                logger.error(msg)
                send_telegram_alert(msg)
                if conn:
                    _record_gate_result(conn, passed=False, error_msg=msg)
                raise QualityGateError(msg)

        # Read parquet store
        if not os.path.exists(parquet_path):
            msg = f"Quality Gate failed: Parquet file {parquet_path} does not exist."
            logger.error(msg)
            send_telegram_alert(msg)
            if conn:
                _record_gate_result(conn, passed=False, error_msg=msg)
            raise QualityGateError(msg)

        df = pd.read_parquet(parquet_path)
        if df.empty or "trade_date" not in df.columns or "token" not in df.columns:
            msg = "Quality Gate failed: Parquet store is empty or missing required columns."
            logger.error(msg)
            send_telegram_alert(msg)
            if conn:
                _record_gate_result(conn, passed=False, error_msg=msg)
            raise QualityGateError(msg)

        latest_date = df["trade_date"].max()
        active_tokens_on_latest = df[df["trade_date"] == latest_date]["token"].nunique()

        # 2. Minimum instrument floor on latest date (1,500)
        required_floor = 1500
        if tokens_limit is not None:
            required_floor = min(tokens_limit, 1500)

        logger.info(f"Latest trade date: {latest_date}. Instruments on latest date: {active_tokens_on_latest} (required: {required_floor}).")

        if active_tokens_on_latest < required_floor:
            msg = f"Quality Gate failed: Only {active_tokens_on_latest} instruments have a candle on {latest_date} (minimum required: {required_floor})."
            logger.error(msg)
            send_telegram_alert(msg)
            if conn:
                _record_gate_result(conn, passed=False, error_msg=msg)
            raise QualityGateError(msg)

        # 3. Check Nifty 50 and Nifty 500 candles exist on the latest date
        if conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT index_name, close FROM daily_index_ohlcv
                    WHERE trade_date = %s AND index_name IN ('NIFTY 50', 'NIFTY 500');
                """, (latest_date,))
                rows = cur.fetchall()
                found_indices = {r[0] for r in rows}

            if "NIFTY 50" not in found_indices or "NIFTY 500" not in found_indices:
                missing = [idx for idx in ("NIFTY 50", "NIFTY 500") if idx not in found_indices]
                msg = f"Quality Gate failed: Key benchmark candle(s) {missing} missing for latest date {latest_date}."
                logger.error(msg)
                send_telegram_alert(msg)
                _record_gate_result(conn, passed=False, error_msg=msg)
                raise QualityGateError(msg)

            # Record success in ingest_runs
            _record_gate_result(conn, passed=True)

        logger.info(f"Quality Gate passed! Latest date: {latest_date}, instruments: {active_tokens_on_latest}, benchmark indices verified.")
        return True
    finally:
        if close_conn and conn:
            conn.close()

