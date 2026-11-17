# Swing Terminal — Momentum & Swing Screeners

> **Notice:** The screeners and technical pattern algorithms implemented here are our own mathematical definitions inspired by ScanTheCharts' descriptions, executed directly on historical OHLCV data from our Parquet datastore. They are not ScanTheCharts' proprietary results.

---

## 1. Tradability & Eligibility Floor

Before evaluating any pattern or trend criteria, a stock must satisfy the baseline tradability floor on the target trade date:

| Metric | Rule | Description |
| :--- | :--- | :--- |
| **Minimum Price** | `close >= 20.0` | Eliminates penny stocks and micro-caps |
| **Average Volume** | `vol_sma_50 >= 25,000` | 50-session simple moving average of volume |
| **Traded Value** | `close * vol_sma_50 >= 10,000,000` | ₹1 Crore minimum daily turnover |
| **History Floor** | `history >= 252 sessions` | Required for 52W high/low and RS percentile (except `ipo_base`) |

---

## 2. Percentile Relative Strength (RS Rank 1–99) & Volatility Unit (ATR)

### 2.1 Relative Strength Percentile
RS Rank measures a stock's price performance relative to all eligible stocks over a 1-year window, weighted towards recent quarters per Mark Minervini's methodology:

$$\text{RS}_{\text{raw}} = 0.4 \times r_{63} + 0.2 \times r_{126} + 0.2 \times r_{189} + 0.2 \times r_{252}$$

Where:
- $r_k = \frac{\text{close}_t}{\text{close}_{t-k}} - 1.0$
- Stocks are ranked on `RS_raw` across all eligible stocks on that date and scaled to a percentile integer between **1 and 99**.

### 2.2 Volatility Unit (`atr_pct`)
For volatility-adaptive thresholds (`near_pivot`, `ipo_base`), we calculate the 14-period True Range with Wilder smoothing:
$$\text{TR}_t = \max(H_t - L_t, |H_t - C_{t-1}|, |L_t - C_{t-1}|)$$
$$\text{ATR}_{14, t} = \frac{13 \times \text{ATR}_{14, t-1} + \text{TR}_t}{14}$$
$$\text{atr\_pct} = \frac{\text{ATR}_{14}}{\text{close}}$$

---

## 3. Mark Minervini 8-Rule Trend Template

The standard trend foundation required for `stage2_breakout`, `vcp`, `near_pivot`, and `ema50_pullback`. All 8 conditions must be satisfied:

1. **`close > sma_150` AND `close > sma_200`** — Price above long-term trend lines.
2. **`sma_150 > sma_200`** — Intermediate trend above long-term trend.
3. **`sma_200 > sma_200[t-21]`** — 200 SMA is in an uptrend (sloping upward over 1 month / 21 sessions).
4. **`sma_50 > sma_150` AND `sma_50 > sma_200`** — Short-term trend above intermediate and long-term trend.
5. **`close > sma_50`** — Price above short-term trend line.
6. **`close >= 1.30 * low_52w_incl`** — Price at least 30% above its 52-week low.
7. **`close >= 0.75 * high_52w_incl`** — Price within 25% of its 52-week high.
8. **`rs_rank >= 70`** — Top 30% momentum across all eligible stocks.

---

## 4. Screener Specifications

### 4.1 Stage 2 Breakout (`stage2_breakout`)
- Satisfies 8-rule Trend Template (`tt_pass == True`).
- Confirmed Stan Weinstein Stage 2 (`stage_2 == 1`).
- Breakout of 20-session high occurring on any of the last 3 sessions (`recency_sessions = 3`).
- Breakout day criteria:
  - `breakout_20d == 1` (`close > pivot` where `pivot = high_20d` prior to breakout candle).
  - Volume surge: `volume >= 1.5 * vol_sma_50`.
  - Strong daily close: `(close - low) / (high - low) >= 0.60`.
  - Not extended on breakout: `close <= 1.05 * pivot`.
- Holding criteria: today's close remains above pivot and not extended: `pivot <= close <= 1.05 * pivot`.
- **Sort:** `days_ago` ascending, then `vol_ratio` descending.
- **Overlay:**
  - `pivot`: Solid line at `pivot` from the pivot high candle.
  - `extension_limit`: Dashed line at `1.05 * pivot`.
  - `marker`: Breakout arrow on the breakout session candle.
  - `stats`: `days_ago`, `days_in_stage2`.

### 4.2 Volatility Contraction Pattern (`vcp`)
- Satisfies 8-rule Trend Template (`tt_pass == True`).
- Swing-based Zigzag over the last 120 sessions (`zigzag_min_pct = 4.0%`) to identify alternating peaks ($H$) and troughs ($L$).
- Evaluates candidate contractions formed by successive $(H_i \to L_i)$ pullbacks:
  - Contraction count between 2 and 5 ($k \in [2, 5]$).
  - Strictly decreasing pullback depths: $\text{depth}_j > \text{depth}_{j+1}$.
  - First contraction depth $\ge 8\%$, last contraction depth $\le 10\%$.
  - Base length between 15 and 120 sessions.
- Pivot is the swing high prior to the final contraction; current price must be within $-3\%$ to $+2\%$ of pivot.
- **Sort:** Last contraction depth ascending.
- **Overlay:**
  - `pivot`: Solid line at `pivot` from the pivot high date.
  - `segments`: 2 to 5 swing lines connecting swing high to swing low with percentage depth labels (e.g. `"-20.1%"`).
  - `stats`: `contractions_count`, `last_depth_pct`, `dist_to_pivot_pct`.

### 4.3 Near Pivot (`near_pivot`)
- Satisfies 8-rule Trend Template (`tt_pass == True`).
- Consolidating tightly near 20-session pivot, scaled by stock volatility:
  $$0 \le \frac{\text{pivot} - \text{close}}{\text{close}} \le 1.0 \times \text{atr\_pct}$$
- **Sort:** Distance to pivot ascending.
- **Overlay:**
  - `pivot`: Solid line at `pivot_20` from the pivot high candle.
  - `stats`: `dist_to_pivot_pct`.

### 4.4 IPO Base (`ipo_base`)
- Skips Trend Template (accommodates young listings).
- Listed within the last 365 calendar days ($15 \le \text{sessions} \le 250$).
- Strictly after earliest data store session cutoff (+5 sessions) to avoid backfill boundary artifacts.
- Common tradability:
  - `close >= 20.0`
  - $\text{avg\_vol} \times \text{close} \ge ₹10,000,000$ (over $\min(n, 50)$ sessions)
  - $\text{avg\_vol} \ge 25,000$
- `base_top` is the highest high from listing through previous session ($t-1$).
- Not yet broken out: `close <= base_top`.
- Proximity to base top scaled by volatility:
  $$\frac{\text{base\_top} - \text{close}}{\text{close}} \le 2.0 \times \text{atr\_pct}$$
- Base depth $\le 35\%$: $\frac{\text{base\_top} - \min(\text{low})}{\text{base\_top}} \le 0.35$.
- Base maturity: at least 5 sessions elapsed since the `base_top` date.
- **Sort:** Distance from base top ascending.
- **Overlay:**
  - `listing_high`: Solid line at `base_top` from the high date.
  - `base_low`: Dashed line at base low from the high date.
  - `marker`: Circle marker on listing session labeled "Listing".
  - `stats`: `base_top`, `base_depth_pct`, `sessions_since_top`.

### 4.5 50 EMA Pullback (`ema50_pullback`)
- Satisfies 8-rule Trend Template (`tt_pass == True`).
- 50 EMA sloping upward over 10 sessions: $\text{ema\_50} > \text{ema\_50}[t-10]$.
- Touched 50 EMA support zone: $\text{low} \le 1.02 \times \text{ema\_50}$.
- Closed above support zone: $\text{close} \ge 0.99 \times \text{ema\_50}$.
- Quiet consolidation month:
  - Volume: average volume over last 21 sessions $\le 1.0 \times \text{vol\_sma\_50}$.
  - Range: mean daily bar range over last 21 sessions $\le 1.0 \times$ mean daily bar range over last 63 sessions.
- Prior extension: $\max(\text{close}_{30}) \ge 1.05 \times \text{ema\_50}$.
- **Sort:** `rs_rank` descending.
- **Overlay:**
  - `swing_high`: Dashed line at prior 30-session highest close.
  - `marker`: Circle marker at the touch session labeled "Touched 50 EMA".
  - `stats`: `ema_50`, `prior_extension_pct`.

---

## 5. Database Retention & Storage Caps

To preserve the Neon 0.5 GB free storage tier:
- **`daily_screener_results`**: Retains candidates for the rolling **10 latest trade dates**. Older dates are purged automatically after each run.
- **`screener_candles`**: Stores the last **260 sessions** of daily OHLCV and moving averages for up to **300 passing tokens** per trade date (prioritized by RS Rank). Non-passing tokens are purged.

---

## 6. API Endpoints

### `GET /api/terminal/screener`
- **Query params:** `?screener=<id>&universe=all|nifty500`
- **Response:**
  ```json
  {
    "asOf": "2026-11-13",
    "regime": "CONFIRMED_UPTREND",
    "counts": {
      "stage2_breakout": 2,
      "vcp": 1,
      "near_pivot": 50,
      "ipo_base": 0,
      "ema50_pullback": 0
    },
    "rows": [ ... ]
  }
  ```
- **Cache-Control:** `public, s-maxage=900, stale-while-revalidate=3600`

### `GET /api/terminal/screener/chart`
- **Query params:** `?token=<int>&screener=<id>`
- **Response:**
  ```json
  {
    "symbol": "ANANDRATHI",
    "asOf": "2026-11-13",
    "candles": [ { "date": "YYYY-MM-DD", "open": 100, "high": 105, "low": 98, "close": 104, "volume": 50000, ... } ],
    "overlay": { "levels": [ ... ], "segments": [ ... ], "markers": [ ... ], "stats": { ... } },
    "rs_rank": 88,
    "ret_1m_pct": 5.4,
    "ret_3m_pct": 14.2,
    "vol_ratio": 0.85,
    "avg_vol_20": 42000
  }
  ```
- **Cache-Control:** `public, s-maxage=900, stale-while-revalidate=3600`

