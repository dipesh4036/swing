# NSE 4-Level Industry Classification & Relative Strength (`RS_STS`)

## Architecture Overview
Tab 3 (`/sectors`) is powered by NSE's 4-level industry taxonomy (**Macro → Sector → Industry → Basic Industry**) and equal-weight relative strength (`RS_STS`) against **NIFTY 500**.

## Data Contract & Database Tables (`016_nse_classification.sql`)
- `instruments`: Stores `macro_sector`, `sector`, `industry`, `basic_industry`, `classification_source`, `classification_updated_at`, `classification_status`, `classification_retry_after`, `classification_attempts`, matched **ISIN-first** then symbol+exchange.
- `industry_groups`: Stable deterministic `group_id` (`mac_...`, `sec_...`, `ind_...`, `bas_...`), `level`, `label`, `parent_id`, and unique `full_path`.
- `industry_snapshots`: Snapshot metadata (`snapshot_id`, `trade_date`, `classification_date`, `methodology_version`, `status`). API readers query ONLY the latest `status = 'completed'` snapshot.
- `daily_industry_strength`: Historical group metrics (`n_stocks`, `n_eligible`, `adv`/`dec`/`unch`, `ret_1d`/`1w`/`1m`/`3m`/`6m`, `rs_sts`, `rs_sts_prev`, `rs_line`, `rs_above_ema21`, `pct_above_20ema`/`50dma`/`200dma`, `rank`) keyed by `(trade_date, group_id, universe)`.
- `latest_industry_stock_metrics`: Snapshot-keyed stock metrics (`close`, returns, `adr_pct`, `pct_from_52w_high`, EMA flags, `rs_sts`, `rs_rating`, `is_new_listing`, `avg_turnover_cr`, `mcap_cr`).

## Operational CLI Commands
```sh
# 1. One-time local import of 4-level classification CSVs into Neon DB (idempotent)
.venv/bin/python -m pipeline.cli classification-import --file data/nse_stock_master.csv --dry-run
.venv/bin/python -m pipeline.cli classification-import --file data/nse_stock_master.csv

# 2. Manual classification overrides, delisting, and local backup export
.venv/bin/python -m pipeline.cli classification-set SYMBOL --macro ... --sector ... --industry ... --basic ...
.venv/bin/python -m pipeline.cli classification-remove SYMBOL --reason "..."
.venv/bin/python -m pipeline.cli classification-export --out data/classification_backup.csv

# 3. Incremental daily sync (capped at 20 API calls/run, 2.5s pacing, halts on 403/429)
.venv/bin/python -m pipeline.cli classification-sync --dry-run
.venv/bin/python -m pipeline.cli classification-sync
.venv/bin/python -m pipeline.cli classification-sync --retry-missing
.venv/bin/python -m pipeline.cli classification-sync --refresh SYMBOL

# 4. Recompute latest RS_STS snapshot or backfill historical strength from Parquet
.venv/bin/python -m pipeline.cli industry-recompute
.venv/bin/python -m pipeline.cli industry-backfill --sessions 65
```

## API Endpoints (Authenticated via `requireAuth`)
- `GET /api/industry-strength?level=industry&period=1m&universe=all&parentId=...`
- `GET /api/industry-strength/[groupId]?page=1&limit=50&universe=all` (lazy paginated constituents)
- `GET /api/industry-strength/[groupId]/history?period=3m&universe=all` (bounded RS series)

## Legacy Cleanup (`020_drop_legacy_sector_tables.sql`)
- Legacy sector rotation components, routes, and pipeline modules have been removed.
- Migration `pipeline/migrations/020_drop_legacy_sector_tables.sql` is staged (unapplied) to drop `sector_stock_metrics`, `daily_sector_breadth`, `daily_industry_breadth`, `daily_industry_index`, `industry_stock_metrics`, and `stock_industry` after owner sign-off.

## RS-STS Quantisation Note (K3)
`rs_sts` in `daily_industry_strength` is **not** a cross-sectional percentile across groups — it is a time-series `percentrank_inc(rs_series, rs_series[-1]) * 100.0` of each group's own equal-weight RS series over a **26-session window** (`25` intervals). Because `100 / 25 = 4.0%`, every `rs_sts` value is an exact multiple of `4.0%` (`0.0, 4.0, 8.0, 12.0, ...`) by construction. Missing/insufficient RS history produces `NULL` (rendered as `"—"` in the UI, never a default).
