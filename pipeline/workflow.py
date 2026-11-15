import logging
from typing import Dict, Any, Callable, Optional
from pipeline.config import RETENTION_YEARS, EQUITY_PARQUET_PATH
from pipeline.trim import trim_equity_parquet

logger = logging.getLogger("pipeline.workflow")

def run_weekly_refetch(
    fetch_fn: Optional[Callable[[int], bool]] = None,
    retention_years: int = RETENTION_YEARS
) -> bool:
    """
    Weekly full re-fetch must request RETENTION_YEARS of history, not more.
    """
    logger.info(f"Initiating weekly full re-fetch for {retention_years} years of history.")
    if fetch_fn:
        return fetch_fn(retention_years)
    return True

def run_daily_workflow(
    ingest_fn: Optional[Callable[[], bool]] = None,
    adjust_fn: Optional[Callable[[], bool]] = None,
    compute_fn: Optional[Callable[[], bool]] = None,
    publish_fn: Optional[Callable[[], bool]] = None,
    parquet_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Runs the daily pipeline sequence:
    1. ingest
    2. adjust
    3. compute
    4. publish
    5. trim (LAST step, ONLY if ingest, adjust, compute, and publish all succeeded)

    If any earlier step fails, trim is NOT executed.
    """
    logger.info("Starting daily pipeline execution...")

    # Step 1: Ingest
    if ingest_fn:
        logger.info("Executing Step 1: Ingest...")
        if not ingest_fn():
            logger.error("Ingest failed. Aborting daily workflow before trim.")
            return {"status": "failed", "step": "ingest", "trimmed": False}

    # Step 2: Adjust
    if adjust_fn:
        logger.info("Executing Step 2: Adjust...")
        if not adjust_fn():
            logger.error("Adjust failed. Aborting daily workflow before trim.")
            return {"status": "failed", "step": "adjust", "trimmed": False}

    # Step 3: Compute
    if compute_fn:
        logger.info("Executing Step 3: Compute...")
        if not compute_fn():
            logger.error("Compute failed. Aborting daily workflow before trim.")
            return {"status": "failed", "step": "compute", "trimmed": False}

    # Step 4: Publish
    if publish_fn:
        logger.info("Executing Step 4: Publish...")
        if not publish_fn():
            logger.error("Publish failed. Aborting daily workflow before trim.")
            return {"status": "failed", "step": "publish", "trimmed": False}

    # Step 5: Trim (LAST step, executed only after all prior steps succeed)
    logger.info(f"All prior steps succeeded. Executing Step 5: Trim (retention={RETENTION_YEARS}y)...")
    trim_result = trim_equity_parquet(parquet_path=parquet_path or EQUITY_PARQUET_PATH)
    logger.info(f"Trim completed successfully: {trim_result}")

    return {
        "status": "success",
        "trimmed": True,
        "trim_result": trim_result
    }

