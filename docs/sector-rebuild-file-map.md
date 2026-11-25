# Sector Rebuild File Map

Checkpoint patch saved before rebuild: `probe_output/pre_rebuild_checkpoint.patch`
Reference upstream: `dopawire/nse-relative-strength` @ `a8983c533c59446feb553b760fe82cc719253cee` (MIT).

## Reference Upstream Modules Inspected
- `refresh_classification.py`: `load_master_rows`, `fetch_equity_list`, `parse_equity_text`, `load_overrides`, `is_classified`, `normalise`, `reconcile`, `FETCH_JS`
- `rs_engine/config.py`: `WINDOW` (26), `EMA_PERIODS`, `ADR_PERIOD` (20), `CORP_ACTION_JUMP` (0.40), `ILLIQUID_TURNOVER_CR` (1.0), `CURRENT_MACROS`, `standard_name`, `standard_company`
- `rs_engine/maths.py`: `percentrank_inc`, `ema_flags`, `rs_ema_flag`, `last_break_date`, `pct_off_high`, `adr_pct`, `equal_weight_rs`, `period_return`, `avg_turnover_cr`, `rs_ratings`, `is_illiquid`
- `rs_engine/rotation.py`: `compute_rotation`
- `build_rs.py`: `read_universe`, `stock_metrics`, `compute`

## Workspace File Map

| Path | Existing Symbols / Functions | Action | Reason | Replacement / Notes | Callers |
|---|---|---|---|---|---|
| `pipeline/data/nse_stock_master.csv` | — | CREATE | Pinned 2,646-stock MIT seed from upstream | `pipeline/classification.py` | `classification-bootstrap`, `classification-sync` |
| `pipeline/data/nse_classification_overrides.csv` | — | CREATE | 4 retired-scheme overrides from upstream | `pipeline/classification.py` | `classification.py` |
| `pipeline/data/nse_symbol_changes.csv` | — | CREATE | Symbol rename mapping (ISIN-backed) | `pipeline/classification.py` | `classification.py` |
| `pipeline/data/nse_delisted.csv` | — | CREATE | Archived delisted symbols | `pipeline/classification.py` | `classification.py` |
| `pipeline/data/CLASSIFICATION_SOURCE.md` | — | CREATE | Commit, license, checksums, refresh procedure | — | Docs |
| `pipeline/migrations/001..015` | Historical tables + `stock_sector`, `stock_industry` | KEEP | Immutable historical migrations | — | `pipeline/db.py` |
| `pipeline/migrations/016_nse_classification.sql` | — | CREATE | Additive classification cols on `instruments`, `industry_groups`, `daily_industry_strength`, `latest_industry_stock_metrics`, `industry_snapshots`, `web_readonly` grants | — | `init_db` |
| `pipeline/classification.py` | — | CREATE | Normalization, CSV validation, ISIN/symbol matching, overrides, bootstrap, delta orchestration | Replaces ad-hoc `scripts/fetch_industry_map.py` loading | `cli.py`, `workflow.py` |
| `pipeline/classification_fetch.py` | — | CREATE | Rate-limited NSE `EQUITY_L.csv` + `GetQuoteApi` adapter with bounded retry | Replaces `scripts/fetch_industry_map.py` network calls | `classification.py` |
| `pipeline/industry_strength.py` | — | CREATE | Vectorized returns, EMA 20/50/200, RS_STS (26-session EW vs NIFTY 500 + PERCENTRANK.INC), ADR%, 52W off-high, RS EMA21, 4-level aggregation, IPO window | Replaces `pipeline/sectors.py` & `pipeline/industries.py` metrics | `cli.py`, `workflow.py` |
| `pipeline/industry_publish.py` | — | CREATE | Atomic snapshot publication (`industry_snapshots` + `industry_groups` + `daily_industry_strength` + `latest_industry_stock_metrics`), storage guard | Replaces `pipeline/industries.py` DB writes | `cli.py`, `workflow.py` |
| `pipeline/cli.py` | `main`, `daily`, `catch-up`, `weekly`, `recompute-all`, `load-industry-map`, `backfill-industry` | EDIT | Wire `classification-bootstrap`, `classification-sync`, `industry-recompute`, `industry-backfill` | — | `.github/workflows/pipeline.yml` |
| `pipeline/workflow.py` | `run_daily_workflow`, `run_weekly_refetch`, `run_recompute_all` | EDIT | Run incremental classification sync + `industry_strength` + `industry_publish` alongside breadth & screeners | — | `cli.py` |
| `pipeline/instruments.py` | `INDEX_CONSTITUENT_URLS`, `sync_instruments` | KEEP | Shared NIFTY 500/200/100/Midcap/Smallcap constituent sync | — | `workflow.py` |
| `pipeline/sectors.py` | `SECTORS`, `MIN_SECTOR_STOCKS`, `compute_sector_metrics` | KEEP (legacy compat) | Keep `daily_sector_breadth` untouched if needed for non-Tab3 DB checks; decouple from active Tab 3 | Replaced for Tab 3 by `industry_strength.py` | `tests/test_sectors.py` (until retired) |
| `.github/workflows/pipeline.yml` | `run-pipeline` | EDIT | Ensure classification + industry strength run in daily/catch-up/weekly/recompute-all | — | GitHub Actions |
| `src/lib/industry-types.ts` | — | CREATE | Shared TS types & enums for 4-level hierarchy | — | `industry-strength.ts`, UI |
| `src/lib/industry-strength.ts` | — | CREATE | Parameterized SQL reads (`getRankings`, `getGroupConstituents`, `getGroupHistory`, `getCoverage`) from latest completed snapshot | Replaces `industries-data.js` & `sectors` route queries | `/api/industry-strength/*` |
| `src/app/api/industry-strength/route.ts` | — | CREATE | Authenticated GET rankings & hierarchy | Replaces `/api/terminal/sectors` & `/api/terminal/industries` | `SectorDashboard` |
| `src/app/api/industry-strength/[groupId]/route.ts` | — | CREATE | Authenticated GET lazy paginated constituents | — | `GroupDetails` |
| `src/app/api/industry-strength/[groupId]/history/route.ts` | — | CREATE | Authenticated GET bounded historical RS series | — | `RotationChart` |
| `src/app/api/terminal/screener/route.js` | `GET` (`SECTOR_KEYS`, `stock_sector`) | EDIT | Support both new 4-level classification (`sector`, `industry`, `groupId`) and legacy `SECTOR_KEYS` compatibility adapter | — | `src/app/(terminal)/screener/page.jsx` |
| `src/app/(terminal)/screener/page.jsx` | `sectorFilter` | EDIT | Use industry/sector classification filter & handle legacy `?sector=` deep links cleanly | — | `Sidebar.jsx`, `GroupDetails` |
| `src/app/(terminal)/sectors/page.jsx` | `IndustryRotationContent` | EDIT | Replace Tab 3 page with `SectorDashboard` powered by `/api/industry-strength` | — | `Sidebar.jsx` |
| `src/components/industry-strength/*` | — | CREATE | `SectorDashboard`, `ClassificationTabs`, `SummaryCards`, `RankingTable`, `GroupDetails`, `RotationChart` | Replaces `src/components/sectors/Sector*.jsx` & `Industry*.jsx` | `src/app/(terminal)/sectors/page.jsx` |
| `src/components/sectors/Sector*.jsx`, `StockExplorerView.jsx`, `SectorRSChart.jsx` | Obsolete 12-sector components | DELETE (after migration) | No remaining callers after Tab 3 replacement | `src/components/industry-strength/*` | None |
| `src/app/api/terminal/sectors/route.js` | Obsolete 12-sector API | DELETE (after migration) | No remaining callers after Tab 3 replacement | `src/app/api/industry-strength/route.ts` | None |
| `tests/test_classification.py`, `tests/test_industry_strength.py`, `tests/test_industry_publish.py` | — | CREATE | Unit & integration tests for classification, RS_STS, IPOs, atomic publish | — | `pytest` |
| `docs/SECTOR_INDUSTRY.md`, `docs/METRICS.md`, `README.md` | Docs | CREATE / EDIT | Document 4-level taxonomy, RS_STS formula, commands, rollback | — | Users / Ops |
