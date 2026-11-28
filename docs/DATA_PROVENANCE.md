# Data Provenance

Every table read by the web UI, its upstream source system, fetch method, split/bonus adjustment status, date coverage, row count, and pipeline update step.

> **Initial History & Source Independence**
> - **3-year equity history (`stock_candles`)**: Initially loaded from Angel One SmartAPI (`pipeline/ingest.py` via `backfill` / `weekly`). Daily post-market updates default to NSE CM Bhavcopy (`DAILY_SOURCE=bhavcopy` in `pipeline/bhavcopy.py`), with Angel SmartAPI (`DAILY_SOURCE=angel`) available as an independent source.
> - **Independent pairs for auditing**:
>   - **Prices**: NSE CM Bhavcopy + NSE Index Closing Files (`nsearchives.nseindia.com`) vs Angel One SmartAPI (`apiconnect.angelone.in`). Note: comparing `stock_candles` against NSE Bhavcopy only checks ingest transformation (not independent for bhavcopy-ingested dates), whereas comparing against Angel SmartAPI is an independent check.
>   - **Industry classification**: NSE Quote API (`www.nseindia.com/api/NextApi/apiClient/GetQuoteApi`) vs initial seed classification (`classification_source='seed'`).
>   - **Derived analytics**: `daily_market_breadth`, `daily_industry_strength`, `latest_industry_stock_metrics`, `industry_top_groups`, `daily_screener_results`, `daily_plan*`, and `plan_outcomes*` are computed in-house from `stock_candles`, `daily_index_ohlcv`, and `instruments` (verified by independent recomputation in `scripts/trust_recompute.py`, not by an external analytics vendor).

## Table Inventory

| Table | Source System | Fetch / Build Method | Adjusted / Raw | First Date | Last Date | Row Count | Workflow Update Step |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| `stock_candles` | NSE CM Bhavcopy (daily) / Angel SmartAPI (3Y backfill) | `pipeline/bhavcopy.py` (`nsearchives.nseindia.com`) & `pipeline/ingest.py` | **Raw / unadjusted** (split jumps >40% flagged at outcome/RS layer) | 2023-11-28 | 2026-11-27 | 414,582 | `run_daily_workflow` step 6 (`ingest_bhavcopy`) |
| `daily_index_ohlcv` | NSE Index Closing Files / Angel SmartAPI | `pipeline/indices_macro.py` (`nsearchives.nseindia.com` `ind_close_all_*.csv`) | **Raw** (price index closes) | 2023-10-17 | 2026-11-27 | 19,861 | `run_daily_workflow` step 2 (`ingest_indices`) |
| `daily_market_breadth` | Derived (`stock_candles` + `index_constituents`) | Computed in `pipeline/compute.py` | Derived from raw closes (uses split-aware indicators) | 2024-10-21 | 2026-11-27 | 3,654 | `run_daily_workflow` step 7 (`compute_and_publish`) |
| `instruments` (classification columns) | Seed CSV + NSE Quote API + manual overrides | `classification_import` (`seed`: 2,427), `pipeline/classification_fetch.py` (`nse_quote`: 150), `override`: 4, `NULL`: 60 | N/A (categorical 4-level hierarchy) | — | — | 2,641 | `run_daily_workflow` incremental `classification-sync` (20/day) & manual D3 sync |
| `stock_mcap` | NSE PR Bhavcopy Zip (`mcap` / issue size) | `pipeline/cli.py sync-mcap` (`pipeline/bhavcopy.py` PR zip) | Raw market cap (₹) | 2026-11-23 | 2026-11-23 | 2,602 | `run_daily_workflow` step 6b (`sync_mcap`) |
| `daily_industry_strength` | Derived (`stock_candles` + `instruments`) | Computed in `pipeline/industry_strength.py` (`rs_sts_v1`) | Derived (RS break-adjusted at >40% 1D jumps) | 2025-11-20 | 2026-11-27 | 137,611 | `run_daily_workflow` step 8 (`compute_industry_strength`) |
| `latest_industry_stock_metrics` | Derived (`stock_candles` + `instruments` + `stock_mcap`) | Computed in `pipeline/industry_strength.py` | Derived (latest completed snapshot) | — | 2026-11-27 | 7,780 | `run_daily_workflow` step 8 (`compute_industry_strength`) |
| `industry_top_groups` | Derived (`daily_industry_strength`) | Minimax worst-rank across 1D/1W/1M/3M (`pipeline/industry_top_groups.py`) | Derived | 2026-10-28 | 2026-11-27 | 480 | `run_daily_workflow` step 8b (`compute_industry_top_groups`) |
| `daily_screener_results` | Derived (`stock_candles`) | Computed in `pipeline/screeners.py` | Derived | 2026-11-13 | 2026-11-27 | 1,086 | `run_daily_workflow` step 7b (`run_screeners`) |
| `daily_plan` | Derived (`daily_market_breadth`, `daily_index_ohlcv`, `industry_top_groups`, `daily_screener_results`) | Computed in `pipeline/plan.py` (`plan_v2` historical, `plan_v3` forward) | Derived | 2026-10-28 | 2026-11-27 | 22 | `run_daily_workflow` step 9 (`build_daily_plan`) |
| `daily_plan_candidates` | Derived (`latest_industry_stock_metrics`, `industry_top_groups`, `daily_screener_results`) | Filtered & ranked in `pipeline/plan.py` | Derived | 2026-10-30 | 2026-11-26 | 74 | `run_daily_workflow` step 9 (`build_daily_plan`) |
| `plan_control` | Derived (`latest_industry_stock_metrics` / historical `stock_candles`) | `select_control_candidates` & `select_top_industries_any_stock` (`pipeline/plan_outcomes.py`) | Derived | 2026-10-30 | 2026-11-26 | 158+ | `run_daily_workflow` step 9 (`build_daily_plan(store_control=True)`) |
| `plan_outcomes` | Derived (`daily_plan_candidates` / filter_only + `stock_candles` + `daily_index_ohlcv`) | Forward 1/5/10/20-session returns (`pipeline/plan_outcomes.py`) | Derived (1D jumps >40% marked `missing`) | 2026-10-28 | 2026-11-26 | 684 | `run_daily_workflow` step 9b (`compute_plan_outcomes`) |
| `plan_outcomes_control` | Derived (`plan_control` + `stock_candles` + `daily_index_ohlcv`) | Forward 1/5/10/20-session returns (`pipeline/plan_outcomes.py`) | Derived (1D jumps >40% marked `missing`) | 2026-10-30 | 2026-11-26 | 234+ | `run_daily_workflow` step 9b (`compute_plan_outcomes`) |
