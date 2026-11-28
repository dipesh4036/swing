"""
Single shared liquidity definition used by both live industry strength
and historical Daily Plan backfill (B1).

plan_v3: added rupee-turnover condition — 20-session median of (close × volume)
must be >= TURNOVER_MEDIAN20_MIN (₹5 crore = 5,000,000) in addition to
the existing price and share-volume thresholds.
"""

from typing import Optional, Sequence

import numpy as np

PRICE_MIN = 20.0
VOL_SMA50_MIN = 25000.0
LIQUID_MIN_SESSIONS = 50
TURNOVER_MEDIAN20_MIN = 5_000_000.0  # plan_v3: ₹5 crore 20-session median daily turnover


def compute_vol_sma_50(vols: Sequence[float]) -> float:
    """Compute 50-session simple moving average of volume; 0.0 if < 50 sessions."""
    if len(vols) < LIQUID_MIN_SESSIONS:
        return 0.0
    return float(np.mean(np.asarray(vols[-LIQUID_MIN_SESSIONS:], dtype=float)))


def compute_turnover_median20(closes: Sequence[float], vols: Sequence[float]) -> float:
    """Compute 20-session median of daily rupee turnover (close × volume).
    Returns 0.0 if fewer than 20 sessions of data."""
    n = min(len(closes), len(vols))
    if n < 20:
        return 0.0
    turnovers = np.asarray(closes[-20:], dtype=float) * np.asarray(vols[-20:], dtype=float)
    return float(np.median(turnovers))


def is_liquid(
    close: Optional[float],
    vol_sma_50: Optional[float],
    turnover_median_20: Optional[float] = None,
) -> bool:
    """Return True iff close >= 20.0, vol_sma_50 >= 25000.0, and (if provided)
    turnover_median_20 >= 5,000,000 (plan_v3 rupee-turnover gate)."""
    if close is None or vol_sma_50 is None:
        return False
    price_ok = float(close) >= PRICE_MIN
    vol_ok = float(vol_sma_50) >= VOL_SMA50_MIN
    if turnover_median_20 is None:
        return bool(price_ok and vol_ok)
    return bool(price_ok and vol_ok and float(turnover_median_20) >= TURNOVER_MEDIAN20_MIN)


def is_liquid_from_series(closes: Sequence[float], vols: Sequence[float]) -> bool:
    """Evaluate liquidity from OHLCV series (requires >= 50 sessions).
    plan_v3: also checks 20-session median rupee turnover >= ₹5 crore."""
    if len(closes) < LIQUID_MIN_SESSIONS or len(vols) < LIQUID_MIN_SESSIONS:
        return False
    turnover_med20 = compute_turnover_median20(closes, vols)
    return is_liquid(float(closes[-1]), compute_vol_sma_50(vols), turnover_median_20=turnover_med20)
