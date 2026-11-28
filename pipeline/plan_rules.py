"""
Single-source rule thresholds and constants for Tab 4: Daily Plan.
Mirrored in docs/PLAN_RULES.md. Do not scatter thresholds elsewhere.
"""

PLAN_RULES_VERSION = "plan_v2"

# Retention window for stored daily_plan and daily_plan_candidates rows
PLAN_RETENTION_DAYS = 90  # Keep 90 calendar days for historical plan review

# 1. Market State (universe='nifty500' from daily_market_breadth)
MARKET_UNIVERSE = "nifty500"  # Broad 500-stock benchmark for market posture
MARKET_STRONG_MIN_50SMA_PCT = 60.0  # Strong requires >= 60% of Nifty 500 above 50 SMA
MARKET_STRONG_MIN_200SMA_PCT = 50.0  # Strong requires >= 50% of Nifty 500 above 200 SMA
MARKET_STRONG_MIN_NET_20D = 1  # Strong requires positive net 20-day highs (net_highs_20d > 0)
MARKET_WEAK_MAX_50SMA_PCT = 40.0  # Weak if < 40% of Nifty 500 above 50 SMA
MARKET_WEAK_MAX_200SMA_PCT = 35.0  # Weak if < 35% of Nifty 500 above 200 SMA
MARKET_DELTA_LOOKBACK_SESSIONS = 5  # Compare pct_above_50sma vs 5 sessions ago

# 2. Cap Leadership (daily_index_ohlcv + daily_market_breadth)
CAP_RETURN_SHORT_SESSIONS = 5  # 1-week (5-session) index return
CAP_RETURN_LONG_SESSIONS = 20  # 1-month (20-session) index return
CAP_LEADER_MIN_GAP_PP = 1.0  # Segment leads only if 20D return beats runner-up by >= 1.0 pp
# Index series & breadth universe mapping (NIFTY 100 has no index series in daily_index_ohlcv; uses NIFTY 50 price + nifty100 breadth)
CAP_SEGMENTS = (
    {"key": "large", "label": "Large Cap", "index_name": "NIFTY 50", "breadth_universe": "nifty100"},
    {"key": "mid", "label": "Mid Cap", "index_name": "NIFTY MIDCAP 150", "breadth_universe": "nifty_midcap150"},
    {"key": "small", "label": "Small Cap", "index_name": "NIFTY SMALLCAP 250", "breadth_universe": "nifty_smallcap250"},
)
CAP_BENCHMARK = {"key": "benchmark", "label": "NIFTY 500", "index_name": "NIFTY 500", "breadth_universe": "nifty500"}

# 3. Breakouts & Stage 2 (daily_screener_results + daily_market_breadth + stock_candles)
BREAKOUT_SCREENERS = ("stage2_breakout", "vcp", "near_pivot")  # Core breakout setup screeners
FOLLOW_THROUGH_LOOKBACK_SESSIONS = 5  # Check stage2_breakout picks from 5 sessions ago
FOLLOW_THROUGH_MIN_SAMPLE = 10  # Require >= 10 prior breakouts; else "too few to judge"
STAGE2_UNIVERSES = ("nifty500", "liquid")  # Track weinstein_stage_2_pct across benchmark and liquid stocks

# 4. Top 3 Industries (industry_top_groups from UX1, v2 cut-off)
CANDIDATE_TOP_INDUSTRY_LEVEL = "industry"  # Prefer 'industry' level Top 3 (deduplicated if multiple)
CANDIDATE_TOP_INDUSTRY_UNIVERSE = "all"  # Use 'all' universe Top 3 for candidate industry pool
TOP_GROUP_CUTOFF_MIN = 5  # Minimum cut-off rank (for small slices like macro/sector)
TOP_GROUP_CUTOFF_FRACTION = 0.20  # Top 20% across all four timeframes (cutoff = max(5, ceil(0.20 * N)))

# 5. Final Candidate Filter & Ordering
CANDIDATE_MIN_RS_RATING = 70.0  # Minimum RS rating >= 70 (leader tier)
CANDIDATE_REQUIRED_STAGE = 2  # Stage 2 (our definition: close > SMA150 and 20D SMA150 slope >= 1%)
CANDIDATE_MAX_OFF_52W_HIGH_PCT = 25.0  # Exclude stocks > 25% below 52-week high
CANDIDATE_MAX_PER_INDUSTRY = 5  # Cap candidates per Top-3 industry at 5 so one group cannot dominate
CANDIDATE_MAX_ROWS = 20  # Cap daily candidate list at 20 rows
LIQUID_PRICE_MIN = 20.0  # Minimum close price (Rs) for liquid universe (shared via pipeline/liquidity.py)
LIQUID_VOL_SMA50_MIN = 25000.0  # Minimum 50-session average volume for liquid universe
SCREENER_PRIORITY = {
    "stage2_breakout": 0,
    "vcp": 1,
    "near_pivot": 2,
    "ema50_pullback": 3,
}  # Priority order for stocks with a screener hit today (lower = higher priority)

# 6. Summary & UI Wording Guardrails
PLAN_SUMMARY_MAX_CHARS = 400  # Max 3 short sentences / 400 chars
BANNED_ADVICE_WORDS = (
    "buy", "sell", "target", "stop", "entry", "signal", "score",
    "probability", "guaranteed", "recommend", "should", "invest", "expect", "forecast",
)  # Never emit advisory, predictive, or scoring language

# 7. Track Record & Outcomes (Tab 5)
OUTCOME_HORIZONS = (1, 5, 10, 20)  # Trading sessions after plan_date
OUTCOME_RETENTION_DAYS = 400  # Keep outcomes 400 calendar days (longer than 90-day candidates)
OUTCOME_BENCHMARK_INDEX = "NIFTY 500"
OUTCOME_SPLIT_JUMP_PCT = 40.0  # Flag unadjusted 1-day jump > ±40% as missing (corporate action)
CONTROL_GROUP_NAME = "same_filter_any_industry"
CONTROL_MAX_ROWS = 20
CONTROL_MAX_PER_INDUSTRY = 5
DEDUPE_WINDOW_SESSIONS = 10  # First-appearance dedupe rolling window (trading sessions)
TELEGRAM_SUMMARY_MAX_CHARS = 900  # Plain-text daily Telegram summary cap
TRACK_RECORD_BANNED_WORDS = BANNED_ADVICE_WORDS + (
    "works", "wins", "win rate", "accuracy", "edge", "alpha", "profitable", "outperforms", "beats the market",
)
