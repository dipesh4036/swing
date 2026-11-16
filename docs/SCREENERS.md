# Swing Terminal — Momentum & Swing Screeners

> **Notice:** The screeners and technical pattern algorithms implemented here are our own mathematical definitions executed directly on historical OHLCV data from our Parquet datastore. They are not ScanTheCharts results.

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

## 2. Percentile Relative Strength (RS Rank 1–99)

RS Rank measures a stock's price performance relative to all eligible stocks over a 1-year window, weighted towards recent quarters per Mark Minervini's methodology:

$$\text{RS}_{\text{raw}} = 0.4 \times r_{63} + 0.2 \times r_{126} + 0.2 \times r_{189} + 0.2 \times r_{252}$$

Where:
- $r_k = \frac{\text{close}_t}{\text{close}_{t-k}} - 1.0$
- Stocks are ranked on `RS_raw` across all eligible stocks on that date and scaled to a percentile integer between **1 and 99**.

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
- Satisfies 8-rule Trend Template
- Confirmed Stan Weinstein Stage 2 (`stage_2 == 1`)
- Breakout of 20-session high (`breakout_20d == 1`, `close > high_20d_prior`)
- Not extended: `close <= 1.05 * high_20d_prior` (within 5% of pivot)
- Strong daily close: `(close - low) / (high - low) >= 0.60` (closing in upper 40% of session range)
- Volume surge: `volume >= 1.5 * vol_sma_50`
- **Sort:** `vol_ratio` descending.
- **Overlay:**
  - `pivot`: Solid line at `high_20d_prior` starting from the date of the pivot high.
  - `extension_limit`: Dashed line at `1.05 * pivot`.
  - `marker`: Breakout arrow below the bar on today's session.
  - `highlight_lines`: `sma_50`, `sma_150`, `sma_200`.

### 4.2 Volatility Contraction Pattern (`vcp`)
- Satisfies 8-rule Trend Template
- Within 15% of 52-week high (`close >= 0.85 * high_52w`)
- Above 50 SMA (`close >= sma_50`)
- 3 consecutive 15-session windows:
  - $w_1 = [t-44 \dots t-30]$
  - $w_2 = [t-29 \dots t-15]$
  - $w_3 = [t-14 \dots t]$
- Strictly contracting depths: $\text{range}(w_1) > \text{range}(w_2) > \text{range}(w_3)$, where $\text{range}(w) = \frac{\max(\text{high}) - \min(\text{low})}{\max(\text{high})}$
- Tightness in final contraction: $\text{range}(w_3) \le 10\%$
- Volume dry-up: `vol_avg_10 <= 0.85 * vol_sma_50`
- Within 5% below 20-session pivot: `0.0 <= (pivot_20 - close) / pivot_20 <= 0.05`
- **Sort:** $\text{range}(w_3)$ ascending.
- **Overlay:**
  - `pivot`: Solid line at `pivot_20` starting from the pivot date.
  - `segments`: 3 swing lines ($c_1, c_2, c_3$) connecting highest high to lowest low of each window with depth percentage labels.
  - `highlight_lines`: `sma_50`.

### 4.3 Near Pivot (`near_pivot`)
- Satisfies 8-rule Trend Template
- Consolidating tightly within 3% below the 20-session high: `0.0 <= (pivot_20 - close) / pivot_20 <= 0.03`
- **Sort:** Distance to pivot ascending.
- **Overlay:**
  - `pivot`: Solid line at `pivot_20` from the pivot high candle.
  - `highlight_lines`: `sma_20`, `sma_50`.

### 4.4 IPO Base (`ipo_base`)
- Skips Trend Template (accommodates young listings)
- Listed within the last 365 calendar days ($15 \le \text{sessions} \le 250$)
- Strictly after earliest data store date + 5 sessions (prevents historical backfill boundaries from appearing as IPOs)
- Volume average $\ge 25,000$
- Price above 20 EMA (`close > ema_20`)
- Base depth $\le 35\%$: $\frac{\text{listing\_high} - \min(\text{low})}{\text{listing\_high}} \le 0.35$
- Close within 10% of listing high: `close >= 0.90 * listing_high`
- 10-session range tightness: $\frac{\max(\text{high}_{10}) - \min(\text{low}_{10})}{\max(\text{high}_{10})} \le 12\%$
- **Sort:** Distance from listing high ascending.
- **Overlay:**
  - `listing_high`: Solid line at listing high from the high date.
  - `base_low`: Dashed line at base low from the high date.
  - `marker`: Circle marker on listing session labeled "Listing".
  - `highlight_lines`: `sma_20`.

### 4.5 50 EMA Pullback (`ema50_pullback`)
- Satisfies 8-rule Trend Template
- 50 EMA sloping upward over 10 sessions: `ema_50 > ema_50[t-10]`
- Touched 50 EMA support zone: `low <= 1.02 * ema_50`
- Closed above support: `close >= 0.99 * ema_50`
- Prior extension: $\max(\text{close}_{15}) \ge 1.08 \times \text{ema\_50}$ (extended by at least 8% before pullback)
- Quiet volume: `volume <= vol_sma_50`
- **Sort:** `rs_rank` descending.
- **Overlay:**
  - `swing_high`: Dashed line at highest close in prior 15 sessions.
  - `marker`: Circle marker at the touch session labeled "Touched 50 EMA".
  - `highlight_lines`: `ema_50` (drawn with thicker stroke).

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
    "overlay": { "levels": [ ... ], "segments": [ ... ], "markers": [ ... ], "highlight_lines": [ "sma_50" ], "stats": { ... } },
    "rs_rank": 88,
    "ret_1m_pct": 5.4,
    "ret_3m_pct": 14.2,
    "vol_ratio": 0.85,
    "avg_vol_20": 42000
  }
  ```
- **Cache-Control:** `public, s-maxage=900, stale-while-revalidate=3600`

