# 📐 Market Breadth Metrics & Specification Reference

This document provides mathematical definitions, filtering logic, Weinstein Stage classification rules, Market Read indicators, and data sources implemented across the Market Breadth Terminal per `MARKET_BREADTH_SPEC_ANGELONE.md`.

---

## 1. Universes & Constituents

The terminal computes breadth across seven distinct universes:

| Universe Key | Name | Source / Constituent Filter |
| :--- | :--- | :--- |
| `nifty500` | Nifty 500 | Official NSE Nifty 500 constituents |
| `nifty200` | Nifty 200 | Official NSE Nifty 200 constituents |
| `nifty100` | Nifty 100 | Official NSE Nifty 100 constituents |
| `midcap150` | Nifty Midcap 150 | Official NSE Nifty Midcap 150 constituents |
| `smallcap250` | Nifty Smallcap 250 | Official NSE Nifty Smallcap 250 constituents |
| `liquid` | Liquid Equities | Prior 50-day average volume $\ge 25,000$ shares and close price $\ge ₹20$ (strictly excludes stocks with $< 50$ sessions or missing 50-day SMA; single-day volume spikes do not enter) |
| `all` | All Equities | All active, traded NSE equities with valid history |

### Point-in-Time Constituent Versioning
- `index_constituents` tracks additions and removals using `effective_from` and `effective_to` with an `is_active` boolean flag.
- Compute filters constituents on each trade date: `effective_from <= trade_date AND (effective_to IS NULL OR effective_to > trade_date)`.
- If an index constituent file is unavailable, compute skips that universe with a warning rather than falling back to all stocks (`symbols=None`).

---

## 2. Participation & Moving Average Breadth

### Strict `min_periods` Rule
Relaxed moving average windows are strictly prohibited. Stocks without sufficient session history are excluded (`NaN` in moving averages) and do not pollute percentage calculations:

- **20 EMA:** Requires 20 sessions (`min_periods=20`). Seeded with the simple moving average of the first 20 sessions, then recursively smoothed using multiplier $\alpha = \frac{2}{20 + 1} = \frac{2}{21}$.
- **50 SMA:** Requires 50 sessions (`min_periods=50`).
- **150 SMA:** Requires 150 sessions (`min_periods=150`).
- **200 SMA:** Requires 200 sessions (`min_periods=200`).
- **52-Week Highs / Lows:** Requires 252 sessions (`min_periods=252`).

### Participation Percentages
For a given universe on trade date $t$:
$$\% \text{ Above MA} = \frac{\sum [ \text{Close}_i > \text{MA}_i ]}{\text{Total Active Stocks with Valid MA}} \times 100$$

---

## 3. Advance / Decline Dynamics

### Advance / Decline Ratios
- **Daily Advances:** Stocks where $\text{Close}_t > \text{Close}_{t-1}$.
- **Daily Decline:** Stocks where $\text{Close}_t < \text{Close}_{t-1}$.
- **Unchanged:** Stocks where $\text{Close}_t = \text{Close}_{t-1}$ or initial session without previous close.
- **20-Day Rolling A/D Ratio:**
  $$\text{Ratio}_{20D} = \frac{\sum_{k=0}^{19} \text{Advances}_{t-k}}{\max\left(1, \sum_{k=0}^{19} \text{Declines}_{t-k}\right)}$$
  The denominator is clamped to at least 1 via `np.maximum(1, declines)` to prevent division by zero.
- **40-Day Rolling A/D Ratio:**
  $$\text{Ratio}_{40D} = \frac{\sum_{k=0}^{39} \text{Advances}_{t-k}}{\max\left(1, \sum_{k=0}^{39} \text{Declines}_{t-k}\right)}$$

### Dynamic Cumulative A-D Line
- Per spec 4.2, raw cumulative A-D line numbers are not permanently stored in the database. Instead, the API dynamically cumulates net advances $(\text{Advances} - \text{Declines})$ starting from $0$ at the first session of the requested view window (1M, 3M, or 1Y).

### Zweig Breadth Thrust
- **Mathematical Definition:** The 10-day exponential moving average (EMA) of advancing stocks divided by the sum of advancing and declining stocks:
  $$\text{AdvRatio}_t = \frac{\text{Advances}_t}{\text{Advances}_t + \text{Declines}_t}$$
  $$\text{ThrustEMA10}_t = \text{EMA}_{10}(\text{AdvRatio}_t)$$
- **Trigger Condition:** A Zweig Breadth Thrust is triggered when the 10-day EMA rises above $0.615$ after having been below $0.40$ at any point within the preceding 10-session rolling window (including the current session):
  $$\text{ThrustEMA10}_t > 0.615 \quad \text{AND} \quad \min_{k=0 \dots 9}(\text{ThrustEMA10}_{t-k}) < 0.40$$

---

## 4. 4% Movers & High-Volume Breakouts

### Liquidity & Penny Stock Filter
To eliminate microcap noise and illiquid spikes, movers and breakouts enforce strict liquidity filters:
- **Price Filter:** $\text{Close}_t \ge ₹20$
- **Volume Filter:** Prior 50-day average volume $\ge 25,000$ shares

### 4% Movers
- **Movers Up 4%:** $\text{PctChange}_t \ge +4.0\%$ on qualifying liquid stocks.
- **Movers Down 4%:** $\text{PctChange}_t \le -4.0\%$ on qualifying liquid stocks.
- **5-Day Movers Ratio:**
  $$\text{MoversRatio}_{5D} = \frac{\sum_{k=0}^{4} \text{MoversUp}_{t-k}}{\max\left(1, \sum_{k=0}^{4} \text{MoversDown}_{t-k}\right)}$$
- **10-Day Movers Ratio:**
  $$\text{MoversRatio}_{10D} = \frac{\sum_{k=0}^{9} \text{MoversUp}_{t-k}}{\max\left(1, \sum_{k=0}^{9} \text{MoversDown}_{t-k}\right)}$$

### 20-Day Breakouts & Breakdowns
- **Breakout 20D:** $\text{Close}_t > \max(\text{High}_{t-20 \dots t-1})$ AND $\text{Volume}_t \ge 1.5 \times \text{VolSMA50}_{t-1}$.
- **Breakdown 20D:** $\text{Close}_t < \min(\text{Low}_{t-20 \dots t-1})$ AND $\text{Volume}_t \ge 1.5 \times \text{VolSMA50}_{t-1}$.

---

## 5. Stan Weinstein Stage Analysis (Spec 4.6)

Weinstein stages classify stocks into four exhaustive and mutually exclusive lifecycle phases using the 150-day SMA, 20-session slope, and historical stage memory:

### Minimum History Requirement
- Stocks require $\ge 170$ sessions of continuous history (150 sessions for 150 SMA + 20 sessions for slope).
- Stocks with $< 170$ sessions are classified as `stage_unclassified`.

### Slope Calculation & Threshold
The 20-session slope of the 150-day SMA is calculated as:
$$\text{Slope}_{20D} = \frac{\text{SMA150}_t - \text{SMA150}_{t-20}}{\text{SMA150}_{t-20}}$$
- **Rising:** $\text{Slope}_{20D} > +0.01$ (+1%)
- **Declining:** $\text{Slope}_{20D} < -0.01$ (-1%)
- **Flat:** $-0.01 \le \text{Slope}_{20D} \le +0.01$

### Stage Transition Rules (120-Session Memory)
Stage memory looks back up to 120 sessions for the most recent unambiguous Stage 2 or Stage 4:
1. **Stage 2 (Advancing):** $\text{Close}_t > \text{SMA150}_t$ AND $\text{Slope}_{20D} > +0.01$.
2. **Stage 4 (Declining):** $\text{Close}_t < \text{SMA150}_t$ AND $\text{Slope}_{20D} < -0.01$.
3. **Stage 1 (Basing):** $\text{Slope}_{20D}$ is flat (between $-1\%$ and $+1\%$) AND the stock was most recently in **Stage 4** within the past 120 sessions (or price is below SMA150).
4. **Stage 3 (Topping):** $\text{Slope}_{20D}$ is flat (between $-1\%$ and $+1\%$) AND the stock was most recently in **Stage 2** within the past 120 sessions (or price is above SMA150).

Percentages for Stages 1, 2, 3, 4, and unclassified are published so their sum equals 100% of the active universe.

---

## 6. Deterministic Market Regime & Read Indicators (Spec 4.8)

Invented numerical "regime scores" are deprecated. The terminal implements deterministic rules based on the Nifty 500 benchmark and universe breadth:

### Market Read Six Indicators
1. **Long-Term Trend:** Nifty 500 close vs 200 SMA. (Positive if above, Negative if below).
2. **Medium-Term Trend:** Nifty 500 close vs 50 SMA. (Positive if above, Negative if below).
3. **Short-Term Momentum:** Nifty 500 close vs 20 EMA. (Positive if above, Negative if below).
4. **A/D Momentum:** 20-day rolling A/D ratio. (Positive if $\ge 1.05$, Negative if $\le 0.95$, Neutral otherwise).
5. **52-Week Highs / Lows:** Net 52-week highs minus lows. (Positive if $> 0$, Negative if $< 0$, Neutral if $= 0$).
6. **Participation:** % of universe stocks above 50 SMA. (Broad if $\ge 70\%$, Moderate if $\ge 50\%$, Narrow if $< 50\%$).

### Deterministic Regime Classifications
- **Confirmed Uptrend:** Nifty 500 above 50 SMA and 200 SMA, % above 50 SMA $> 50\%$, and distribution days $\le 4$.
- **Uptrend Under Pressure:** Nifty 500 above 200 SMA but below 50 SMA OR distribution days $\ge 5$.
- **Downtrend / Defensive:** Nifty 500 below 200 SMA and % above 50 SMA $< 40\%$.
- **Rally Attempt:** Benchmark attempting recovery after a downtrend with consecutive positive sessions.

### Breadth-Based Distribution Sessions
A distribution session is logged when:
$$\text{Nifty 500 Change} \le -0.5\% \quad \text{AND} \quad \text{Declines} \ge 1.5 \times \text{Advances}$$
Distribution sessions expire from the count after 25 trading sessions or when the index rallies $> 5\%$ above the distribution session high.

---

## 7. Data Pipeline & Corporate Action Handling (Case A)

- **Source API:** Angel One SmartAPI Historical Candle API (read-only token session).
- **Case A Adjustment:** Candles returned by SmartAPI are pre-adjusted for splits, bonuses, and capital restructurings.
- **Overlap Verification:** Daily ingest re-fetches an overlapping 10-session window. If any close differs by $> 1\%$ from stored values, a corporate action is detected; the pipeline re-fetches the full 3-year history for that token, replaces stored rows in `equity_ohlcv.parquet`, and logs the action to `price_adjustments`.
- **Large Move Logging:** Any single-day move $\ge 20\%$ is logged to `price_adjustments` as `LARGE_MOVE_20PCT` for auditability.



---

## NSE 4-Level Industry Classification & `RS_STS` (`rs_sts_v1`)

Adapted from `dopawire/nse-relative-strength` (MIT License):
- **Hierarchy**: `Macro` (12 official NSE groups) → `Sector` → `Industry` → `Basic Industry`, deterministically keyed by `(level, full_path)`.
- **RS_STS%**: Over the trailing `WINDOW = 26` market sessions aligned to `NIFTY 500`, full-window non-break constituents are normalized to base 100 on session `d0` and averaged equally to form `ewi[t]`. `RS[t] = ewi[t] / bench_norm[t]`, and `RS_STS% = PERCENTRANK.INC(RS, RS[-1]) × 100`.
- **Corporate Action Guard**: Any single-session return jump `|ret| > 40%` (`CORP_ACTION_JUMP = 0.40`) marks a discontinuity; period returns across that boundary return `NULL`, and the stock is excluded from the group equal-weight index for that window.
- **New Listings / IPOs**: Stocks listed inside the 26-session window are displayed immediately in group constituent tables with an `IPO` badge and listing-close relative RS, while excluded from full-window group equal-weight averages until they have 26 sessions.
- **Null & Bias Policy**: Missing indicators, insufficient history (`< 20/50/200` bars), or zero valid denominators return `NULL` (rendered as `—`). Historical `daily_industry_strength` backfills use current instrument classification (current-membership survivorship bias documented).
