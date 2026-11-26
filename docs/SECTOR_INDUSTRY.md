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
# 1. Bootstrap 4-level classification from pinned MIT seed + overrides (idempotent)
.venv/bin/python -m pipeline.cli classification-bootstrap --dry-run
.venv/bin/python -m pipeline.cli classification-bootstrap

# 2. Incremental daily sync (queues only missing/incomplete/due symbols; 0 calls when up-to-date)
.venv/bin/python -m pipeline.cli classification-sync --dry-run
.venv/bin/python -m pipeline.cli classification-sync
.venv/bin/python -m pipeline.cli classification-sync --retry-missing
.venv/bin/python -m pipeline.cli classification-sync --refresh SYMBOL

# 3. Recompute latest RS_STS snapshot or backfill historical strength from Parquet
.venv/bin/python -m pipeline.cli industry-recompute
.venv/bin/python -m pipeline.cli industry-backfill --sessions 65
```

## API Endpoints (Authenticated via `requireAuth`)
- `GET /api/industry-strength?level=industry&period=1m&universe=all&parentId=...`
- `GET /api/industry-strength/[groupId]?page=1&limit=50&universe=all` (lazy paginated constituents)
- `GET /api/industry-strength/[groupId]/history?period=3m&universe=all` (bounded RS series)

## Rollback Instructions
1. Old production tables (`stock_sector`, `daily_sector_breadth`, `sector_stock_metrics`, `stock_industry`) are preserved intact by migration `016`.
2. To roll back without data loss, revert the frontend/API commits (`src/app/(terminal)/sectors/page.jsx`, `src/components/industry-strength/`, `src/app/api/industry-strength/`) and restore `probe_output/pre_rebuild_checkpoint.patch`.
