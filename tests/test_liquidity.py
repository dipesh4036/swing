from pipeline.liquidity import (
    LIQUID_MIN_SESSIONS,
    PRICE_MIN,
    VOL_SMA50_MIN,
    is_liquid,
    is_liquid_from_series,
)


def test_liquidity_thresholds_and_50_session_rule():
    # Exact thresholds pass
    assert is_liquid(20.0, 25000.0) is True
    # Just under price threshold
    assert is_liquid(19.99, 25000.0) is False
    # Just under volume threshold
    assert is_liquid(20.0, 24999.9) is False
    # Missing inputs
    assert is_liquid(None, 30000.0) is False
    assert is_liquid(25.0, None) is False

    # Fewer than 50 sessions -> not liquid
    assert is_liquid_from_series([25.0] * 49, [30000.0] * 49) is False
    # Exactly 50 sessions at threshold -> liquid
    assert is_liquid_from_series([20.0] * LIQUID_MIN_SESSIONS, [VOL_SMA50_MIN] * LIQUID_MIN_SESSIONS) is True
    # 50 sessions just below threshold -> not liquid
    assert is_liquid_from_series([PRICE_MIN] * 50, [24999.0] * 50) is False


def test_live_and_backfill_share_liquidity_helper():
    with open("pipeline/industry_strength.py", encoding="utf-8") as f:
        live_src = f.read()
    with open("pipeline/plan.py", encoding="utf-8") as f:
        bf_src = f.read()
    assert "from pipeline.liquidity import" in live_src and "is_liquid_from_series" in live_src
    assert "from pipeline.liquidity import" in bf_src and "is_liquid_from_series" in bf_src
