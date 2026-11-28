from pipeline.liquidity import (
    LIQUID_MIN_SESSIONS,
    PRICE_MIN,
    TURNOVER_MEDIAN20_MIN,
    VOL_SMA50_MIN,
    compute_turnover_median20,
    is_liquid,
    is_liquid_from_series,
)


def test_liquidity_thresholds_and_50_session_rule():
    # Exact thresholds pass (is_liquid without turnover — backward-compatible)
    assert is_liquid(20.0, 25000.0) is True
    # Just under price threshold
    assert is_liquid(19.99, 25000.0) is False
    # Just under volume threshold
    assert is_liquid(20.0, 24999.9) is False
    # Missing inputs
    assert is_liquid(None, 30000.0) is False
    assert is_liquid(25.0, None) is False
    # With turnover — just under gate fails
    assert is_liquid(20.0, 25000.0, turnover_median_20=4_999_999.0) is False
    # With turnover — exactly at gate passes
    assert is_liquid(20.0, 25000.0, turnover_median_20=TURNOVER_MEDIAN20_MIN) is True

    # Fewer than 50 sessions -> not liquid
    assert is_liquid_from_series([25.0] * 49, [30000.0] * 49) is False
    # Fewer than 20 sessions -> not liquid (turnover needs >=20)
    assert is_liquid_from_series([20.0] * 19, [25000.0] * 19) is False

    # 50 sessions at minimum price+vol but turnover = 20*25000 = 500,000 < 5cr -> not liquid (plan_v3)
    assert is_liquid_from_series([20.0] * LIQUID_MIN_SESSIONS, [VOL_SMA50_MIN] * LIQUID_MIN_SESSIONS) is False

    # 50 sessions with turnover >= 5 crore: close=250, vol=25000 -> 250*25000=6,250,000 >= 5cr -> liquid
    assert is_liquid_from_series([250.0] * LIQUID_MIN_SESSIONS, [VOL_SMA50_MIN] * LIQUID_MIN_SESSIONS) is True

    # Just under price with sufficient turnover -> not liquid
    assert is_liquid_from_series([19.99] * LIQUID_MIN_SESSIONS, [300000.0] * LIQUID_MIN_SESSIONS) is False


def test_compute_turnover_median20():
    # Fewer than 20 sessions -> 0.0
    assert compute_turnover_median20([100.0] * 19, [50000.0] * 19) == 0.0
    # Exactly 20 sessions: close=200, vol=100000 -> turnover=20,000,000
    result = compute_turnover_median20([200.0] * 20, [100000.0] * 20)
    assert abs(result - 20_000_000.0) < 1.0
    # Uses last 20 of longer series
    closes = [1.0] * 30 + [300.0] * 20  # last 20 are 300
    vols = [1.0] * 30 + [30000.0] * 20  # last 20 are 30000
    result2 = compute_turnover_median20(closes, vols)
    assert abs(result2 - 9_000_000.0) < 1.0  # 300*30000=9,000,000


def test_live_and_backfill_share_liquidity_helper():
    with open("pipeline/industry_strength.py", encoding="utf-8") as f:
        live_src = f.read()
    with open("pipeline/plan.py", encoding="utf-8") as f:
        bf_src = f.read()
    assert "from pipeline.liquidity import" in live_src and "is_liquid_from_series" in live_src
    assert "from pipeline.liquidity import" in bf_src and "is_liquid_from_series" in bf_src
