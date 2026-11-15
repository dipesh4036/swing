import os

# Rolling retention configuration (default 3 years)
RETENTION_YEARS = int(os.environ.get("RETENTION_YEARS", "3"))

# Safety floor: never trim if fewer than 504 trading sessions would remain
MIN_SESSIONS_FLOOR = 504

# Parquet storage path
EQUITY_PARQUET_PATH = os.environ.get("EQUITY_PARQUET_PATH", "data/equity_ohlcv.parquet")

