import os
import shutil
import pandas as pd
from typing import Dict, Any, Optional
from pipeline.config import RETENTION_YEARS, MIN_SESSIONS_FLOOR, EQUITY_PARQUET_PATH

def trim_equity_parquet(
    parquet_path: Optional[str] = None,
    retention_years: int = RETENTION_YEARS,
    min_sessions_floor: int = MIN_SESSIONS_FLOOR
) -> Dict[str, Any]:
    """
    Trims equity_ohlcv.parquet so that rows where trade_date < (latest trade_date - retention_years)
    are pruned.

    Safety rules:
    - Never trims if fewer than min_sessions_floor (default 504) trading sessions remain.
    - Writes the trimmed dataframe to a temporary file, checks row count and date range,
      creates a backup of the existing file, and atomically replaces the old file.
    - Trims only the local/parquet file; never alters any database tables.
    """
    path = parquet_path or EQUITY_PARQUET_PATH

    if not os.path.exists(path):
        raise FileNotFoundError(f"Parquet file not found at: {path}")

    # Load parquet dataset
    df = pd.read_parquet(path)
    original_row_count = len(df)

    if original_row_count == 0:
        raise ValueError("Cannot trim an empty parquet file.")

    # Ensure trade_date is in datetime/date format for comparison
    trade_dates = pd.to_datetime(df["trade_date"])
    latest_date = trade_dates.max()

    # Calculate cutoff date: latest trade_date minus retention_years
    cutoff_date = latest_date - pd.DateOffset(years=retention_years)

    # Determine candidate remaining sessions
    remaining_mask = trade_dates >= cutoff_date
    remaining_dates = trade_dates[remaining_mask].unique()
    remaining_sessions_count = len(remaining_dates)

    # Safety Rule 1: Floor check
    if remaining_sessions_count < min_sessions_floor:
        raise ValueError(
            f"Safety check failed: Trimming with RETENTION_YEARS={retention_years} would leave "
            f"{remaining_sessions_count} trading sessions, which is below the minimum required "
            f"floor of {min_sessions_floor} sessions. Trim operation aborted."
        )

    # Filter dataframe
    trimmed_df = df[remaining_mask].copy()
    trimmed_row_count = len(trimmed_df)

    # Validation checks on proposed trimmed data
    if trimmed_row_count == 0:
        raise ValueError("Safety check failed: Proposed trim resulted in zero rows.")

    trimmed_dates = pd.to_datetime(trimmed_df["trade_date"])
    trimmed_latest = trimmed_dates.max()
    trimmed_oldest = trimmed_dates.min()

    if trimmed_latest != latest_date:
        raise ValueError(
            f"Safety check failed: Newest date changed during trim. Expected {latest_date}, got {trimmed_latest}"
        )

    if trimmed_oldest < cutoff_date:
        raise ValueError(
            f"Safety check failed: Oldest date {trimmed_oldest} is older than cutoff {cutoff_date}"
        )

    # Safety Rule 2: Write to temporary file, verify, backup, and atomically replace
    temp_path = f"{path}.tmp"
    backup_path = f"{path}.backup"

    try:
        # Write to temp file
        trimmed_df.to_parquet(temp_path, index=False)

        # Verify temp file is readable and non-empty
        verify_df = pd.read_parquet(temp_path)
        if len(verify_df) != trimmed_row_count:
            raise IOError("Temporary parquet file row count mismatch upon verification.")

        # Create/update backup of the previous file before replacing
        shutil.copyfile(path, backup_path)

        # Atomically replace target file
        os.replace(temp_path, path)

    finally:
        # Clean up temp file if it still exists
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

    deleted_rows = original_row_count - trimmed_row_count
    return {
        "status": "success",
        "original_rows": original_row_count,
        "trimmed_rows": trimmed_row_count,
        "deleted_rows": deleted_rows,
        "sessions_remaining": remaining_sessions_count,
        "oldest_date": str(trimmed_oldest.date()),
        "newest_date": str(trimmed_latest.date()),
        "cutoff_date": str(cutoff_date.date()),
        "backup_path": backup_path,
    }

