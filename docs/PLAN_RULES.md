# Daily Plan Rules (`plan_v1`)

Single source of truth: [`pipeline/plan_rules.py`](../pipeline/plan_rules.py). Every threshold is deterministic; no AI is used in selection or ordering.

## Verified Source Tables & Latest Dates
| Block | Source Tables & Columns | Verified Latest `trade_date` | Missing / Stale Handling |
|---|---|---|---|
| 1. Market State | `daily_market_breadth` (`universe='nifty500'`, `pct_above_50sma`, `pct_above_200sma`, `net_highs_20d`) | `2026-11-26` | Shows `"not available"` with reason if missing/null |
| 2. Cap Leadership | `daily_index_ohlcv` (`NIFTY 50`, `NIFTY 500`, `NIFTY MIDCAP 150`, `NIFTY SMALLCAP 250`), `daily_market_breadth` (`nifty100`, `nifty_midcap150`, `nifty_smallcap250`, `nifty500`) | `2026-11-26` | Uses `NIFTY 50` price + `nifty100` breadth for Large Cap (no `NIFTY 100` index series) |
| 3. Breakouts & Stage 2 | `daily_screener_results` (`stage2_breakout`, `vcp`, `near_pivot`, `pivot`), `daily_market_breadth` (`weinstein_stage_2_pct`), `stock_candles` (`close`) | `2026-11-26` (candles: `2026-11-23`) | Shows `"too few to judge"` when `n < 10`; `"not available"` if candles stale |
| 4. Top 3 Industries | `industry_top_groups` (`level='industry'`, `universe='all'`) | `2026-11-23` | Shows `"not available"` if no row exists |
| 5. Final Candidates | `latest_industry_stock_metrics`, `stock_candles` (Stage 2), `daily_screener_results` (today's hits) | `2026-11-23` (screener: `2026-11-26`) | Filtered deterministically; capped at 20 rows |

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
   - `weinstein_stage_2_pct` for `nifty500` and `liquid`.
   - **Follow-through**: share of `stage2_breakout` stocks from 5 sessions ago whose close today is `>= pivot` (if sample `< 10`, `"too few to judge"`).
4. **Candidate Filter** (filter result, not advice):
   - Industry in today's `industry` Top 3 (`industry_top_groups`, `level='industry'`, `universe='all'`)
   - `rs_rating >= 70`
   - `stage == 2` (`close > sma150` and 20-session `sma150` slope `>= 1.0%`)
   - `is_liquid == true`
   - `pct_from_52w_high <= 25.0`
   - **Ordering**: screener hit priority (`stage2_breakout` > `vcp` > `near_pivot` > `ema50_pullback` > no hit), then `rs_rank` descending, then industry Top 3 position ascending, then symbol ascending.
   - **Cap**: 20 rows (stores `total_matching` for `"N more"` count).
