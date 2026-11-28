# Daily Plan Rules (`plan_v1`)

Single source of truth: [`pipeline/plan_rules.py`](../pipeline/plan_rules.py). Every threshold is deterministic; no AI is used in selection or ordering.

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
   - `same_filter_any_industry` (`plan_control` / `plan_outcomes_control`, forward-only from live runs): up to 20 stocks passing the exact same candidate filter (`Stage 2`, `RS >= 70`, liquid, `<= 25%` off 52W high) outside the Top-3 industries, sampled reproducibly with seed `sha256(plan_date)`, max 5 per industry.
   - `all_liquid`: median 1D/5D/10D/20D return of all liquid NSE EQ stocks from `stock_candles` over the same windows.
6. **First-appearance dedupe**: `dedupe=first` counts a token only at its first appearance within any rolling window of `10` trading sessions (`DEDUPE_WINDOW_SESSIONS = 10`).
7. **Retention & Versioning**: `daily_plan` / `daily_plan_candidates` retain `90` calendar days; `plan_outcomes` / `plan_control` / `plan_outcomes_control` retain `400` calendar days (`OUTCOME_RETENTION_DAYS`). Thresholds are fixed before measuring and grouped by `PLAN_RULES_VERSION`.
