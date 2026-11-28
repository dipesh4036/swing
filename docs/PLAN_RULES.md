# Daily Plan Rules (`plan_v3`)

Single source of truth: [`pipeline/plan_rules.py`](../pipeline/plan_rules.py). Every threshold is deterministic; no AI is used in selection or ordering.

> **v3 Change (`plan_v3`):** Added rupee-turnover liquidity gate in `pipeline/liquidity.py` (`TURNOVER_MEDIAN20_MIN = 5_000_000.0`, i.e., 20-session median of `close × volume >= ₹5 crore`), in addition to `close >= ₹20` and `50-session average volume >= 25,000`. Existing `plan_v1` and `plan_v2` rows remain untouched and grouped by `rules_version`.

> **v2 Change (`plan_v2`):** Added Top-3 cut-off `cutoff = max(5, ceil(0.20 * N))` (`TOP_GROUP_CUTOFF_MIN = 5`, `TOP_GROUP_CUTOFF_FRACTION = 0.20`, where `N` = eligible groups with `>= 5` stocks and non-null 1D/1W/1M/3M medians). In `plan_v1`, pure minimax could pick groups ranked `#25`/`#26` on a timeframe. Groups qualify only if `worst_rank <= cutoff`; non-qualifying groups are never used for Daily Plan candidates. Existing `plan_v1` rows and Track Record outcomes remain untouched and grouped by `rules_version`.

## Verified Source Tables & Latest Dates
| Block | Source Tables & Columns | Verified Latest `trade_date` | Missing / Stale Handling |
|---|---|---|---|
| 1. Market State | `daily_market_breadth` (`universe='nifty500'`, `pct_above_50sma`, `pct_above_200sma`, `net_highs_20d`) | `2026-11-26` | Shows `"not available"` with reason if missing/null |
| 2. Cap Leadership | `daily_index_ohlcv` (`NIFTY 50`, `NIFTY 500`, `NIFTY MIDCAP 150`, `NIFTY SMALLCAP 250`), `daily_market_breadth` (`nifty100`, `nifty_midcap150`, `nifty_smallcap250`, `nifty500`) | `2026-11-26` | Uses `NIFTY 50` price + `nifty100` breadth for Large Cap (no `NIFTY 100` index series) |
| 3. Breakouts & Stage 2 | `daily_screener_results` (`stage2_breakout`, `vcp`, `near_pivot`, `pivot`), `daily_market_breadth` (`weinstein_stage_2_pct`), `stock_candles` (`close`) | `2026-11-26` (candles: `2026-11-23`) | Shows `"too few to judge"` when `n < 10`; `"not available"` if candles stale |
| 4. Top 3 Industries | `industry_top_groups` (`level='industry'`, `universe='all'`) | `2026-11-27` (falls back to latest `<= plan_date` if missing) | Shows `"Industries as of <date>"` when source date differs from `plan_date` |
| 5. Final Candidates | `latest_industry_stock_metrics`, `stock_candles` (Stage 2), `daily_screener_results` (today's hits) | `2026-11-27` (matches Top-3 industry source date) | Max `5` per industry (`CANDIDATE_MAX_PER_INDUSTRY`), max `20` total; shows `+N more in <industry> (not shown)` |

## Thresholds
1. **Market State** (`nifty500`):
   - **Strong**: `pct_above_50sma >= 60.0` AND `pct_above_200sma >= 50.0` AND `net_highs_20d > 0`
   - **Weak**: `pct_above_50sma < 40.0` OR `pct_above_200sma < 35.0`
   - **Mixed**: all other combinations
   - Also reports the 5-session change in `pct_above_50sma`.
2. **Cap Leadership**:
   - 5-session and 20-session returns from `daily_index_ohlcv` + `pct_above_50sma` from `daily_market_breadth`.
   - Leader = segment with highest 20-session return only if `best - runner_up >= 1.0` percentage point; otherwise `"no clear leader"`.
3. **Breakouts & Stage 2**:
   - Counts today, 1 session ago, and 5 sessions ago for `stage2_breakout`, `vcp`, `near_pivot`.
   - `Stage 2 (our definition: close > SMA150 and 20-day SMA150 slope >= 1%)` share (`weinstein_stage_2_pct` column) for `nifty500` and `liquid`. Note: this is a simplified daily rule vs. Stan Weinstein's full weekly 30-week MA + base-breakout + volume stage analysis.
   - **Follow-through**: share of `stage2_breakout` stocks from 5 sessions ago whose close today is `>= pivot` (if sample `< 10`, `"too few to judge"`).
4. **Candidate Filter** (filter result, not advice):
   - Industry in today's `industry` Top 3 (`industry_top_groups`, `level='industry'`, `universe='all'`, using latest `snapshot_date <= plan_date`)
   - `rs_rating >= 70`
   - `stage == 2` (`Stage 2 (our definition: close > SMA150 and 20-session SMA150 slope >= 1.0%)`)
   - `is_liquid == true`
   - `pct_from_52w_high <= 25.0`
   - **Ordering**: screener hit priority (`stage2_breakout` > `vcp` > `near_pivot` > `ema50_pullback` > no hit), then `rs_rank` descending, then industry Top 3 position ascending, then symbol ascending.
   - **Caps**: max `5` per industry (`CANDIDATE_MAX_PER_INDUSTRY = 5`) and `20` rows total (`CANDIDATE_MAX_ROWS = 20`); stores per-industry `hiddenCandidates` count so the UI shows `+N more in <industry> (not shown)`.

## Track record
1. **Horizons**: `1`, `5`, `10`, and `20` trading sessions counted using `trading_days` (not calendar days). Horizon `h` for plan date `D` is the `h`-th trading session after `D`. If `D + h` does not exist yet in `trading_days`, the outcome is not yet matured (row absent). If `D + h` exists in `trading_days` but a token lacks a candle on `D`, `D + 1`, or `D + h`, the row is stored with `status='missing'` (`missing_reason='missing_candle'`) and never forward-filled or dropped.
2. **Two reference prices**:
   - **From plan-date close (`base_close`)**: token's close on `D` (when the plan is known).
   - **From next open (`base_open_next`)**: token's open on `D + 1` (first actionable open after reading the plan).
   - Return `% = (fwd_close / base - 1) * 100`.
3. **Benchmark & Excess**: `NIFTY 500` (`daily_index_ohlcv`) over the same dates and same two bases (`open` on `D + 1` for `base_open_next`, falling back to `close` on `D + 1` only if `open` is null). `excess = stock_ret - bench_ret`.
4. **Corporate actions / splits**: `stock_candles` is unadjusted; any single-day close-to-close move exceeding `±40%` (`OUTCOME_SPLIT_JUMP_PCT = 40.0`) inside `(D, D + h]` is flagged `status='missing'` (`missing_reason='split_or_corporate_action'`).
5. **Controls & Baselines**:
   - `same_filter_any_industry` (`plan_control` / `plan_outcomes_control`): up to 20 stocks passing the exact same candidate filter (`Stage 2`, `RS >= 70`, liquid, `<= 25%` off 52W high) outside the Top-3 industries, sampled reproducibly with seed `sha256(plan_date)`, max 5 per industry (computed for both live and `backfill_v1` dates).
   - `top_industries_any_stock` (`plan_control` / `plan_outcomes_control`): up to 20 liquid stocks from the Top-3 industries regardless of Stage 2 / RS / 52W-high filters, sampled reproducibly with seed `sha256(plan_date || ':top_any')`, max 5 per industry (computed for both live and `backfill_v1` dates).
   - `all_liquid`: median 1D/5D/10D/20D return of all liquid NSE EQ stocks from `stock_candles` over the same windows.
6. **Candidate Sets & Backfill Fidelity (`backfill_v1`)**:
   - `candidate_set`: `filter_only` (default on Track Record; RS descending then symbol, max 5/industry, max 20) vs `displayed` (exact live `/plan` list including screener tie-breaks).
   - `backfill_v1` shares `pipeline/liquidity.py` (`PRICE_MIN = 20.0`, `VOL_SMA50_MIN = 25000.0`, `>= 50` sessions), `compute_ibd_rs_score`, and `compute_weinstein_stages` with the live pipeline. Pre-fix `backfill_v0` rows are marked `method = 'backfill_v0'` and hidden unless `include_superseded=1`.
   - Verified `2026-11-27` backfill vs live fidelity gates (`n = 1599` common): `RS_spearman = 0.9998` (`>= 0.98`), `Stage2_agree = 100.00%` (`>= 99%`), `Jaccard = 0.7647` (`15` vs `15`).
7. **First-appearance dedupe**: `dedupe=first` counts a token only at its first appearance within any rolling window of `10` trading sessions (`DEDUPE_WINDOW_SESSIONS = 10`).
8. **Retention & Versioning**: `daily_plan` / `daily_plan_candidates` retain `90` calendar days; `plan_outcomes` / `plan_control` / `plan_outcomes_control` retain `400` calendar days (`OUTCOME_RETENTION_DAYS`). Thresholds are fixed before measuring and grouped by `PLAN_RULES_VERSION`.
