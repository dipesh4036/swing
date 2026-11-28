"""
Single shared liquidity definition used by both live industry strength
and historical Daily Plan backfill (B1).
"""

from typing import Optional, Sequence

import numpy as np

PRICE_MIN = 20.0
VOL_SMA50_MIN = 25000.0
LIQUID_MIN_SESSIONS = 50


def compute_vol_sma_50(vols: Sequence[float]) -> float:
    """Compute 50-session simple moving average of volume; 0.0 if < 50 sessions."""
    if len(vols) < LIQUID_MIN_SESSIONS:
        return 0.0
    return float(np.mean(np.asarray(vols[-LIQUID_MIN_SESSIONS:], dtype=float)))


def is_liquid(close: Optional[float], vol_sma_50: Optional[float]) -> bool:
    """Return True iff close >= 20.0 and vol_sma_50 >= 25000.0."""
    if close is None or vol_sma_50 is None:
        return False
    return bool(float(close) >= PRICE_MIN and float(vol_sma_50) >= VOL_SMA50_MIN)


def is_liquid_from_series(closes: Sequence[float], vols: Sequence[float]) -> bool:
    """Evaluate liquidity from OHLCV series (requires >= 50 sessions)."""
    if len(closes) < LIQUID_MIN_SESSIONS or len(vols) < LIQUID_MIN_SESSIONS:
        return False
    return is_liquid(float(closes[-1]), compute_vol_sma_50(vols))
