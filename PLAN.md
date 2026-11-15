# Market Breadth Dashboard — Master Implementation Plan & Architecture

Based on **Build Specification v2** and **MARKET_BREADTH_SPEC_ANGELONE.md**, this document tracks the completed phases, architectural foundations, data models, and verification tests powering the 100% real-data Market Breadth Terminal.

---

## 🏛️ Operating Environment & Hosting Architecture (Free Tiers)

1. **Frontend & Edge API:** Vercel Hobby tier (Next.js 15 App Router, React 19, Tailwind CSS, Recharts).
2. **Database:** Neon PostgreSQL free tier (1 GB storage limit, 100 compute hours/month, sleep after 5 minutes idle).
3. **Pipeline Runner:** GitHub Actions on public repository (Free compute, concurrency-locked).
4. **Raw Price Store:** `equity_ohlcv.parquet` (~2,300 active NSE equities across 3 years) hosted as GitHub Release asset `data-latest` with atomic swapping and `.backup` retention.
5. **Zero Mock Guarantee:** Zero synthetic multipliers, zero placeholder fallback numbers (`??` / `||`), and zero hardcoded dates.

---

## 📋 Phase Roadmap & Execution Status

### Phase 1: Make Pipeline Run on GitHub Actions (COMPLETED)
- [x] Fixed `pipeline/compute.py` import crash (added missing `Set` from `typing`).
- [x] Wired full daily execution sequence in `pipeline/workflow.py`: `sync_instruments -> sync_constituents -> sync_indices -> sync_macro -> sync_fii_dii -> ingest_equities -> adjust -> quality_gate -> compute_and_publish_all -> trim`.
- [x] Enforced hard rule: trim runs **only** as the final step if all prior steps succeed; any failure halts the pipeline before trimming.
- [x] Added CLI subcommands in `pipeline/cli.py`: `daily`, `catch-up`, `weekly`, `backfill`, `recompute-all`, `test-connection`, `trim`.
- [x] Created `.github/workflows/pipeline.yml` with scheduled UTC crons:
  - Daily: `30 11 * * 1-5` (17:00 IST)
  - Catch-up: `30 15 * * 1-5` (21:00 IST)
  - Weekly: `0 2 * * 6` (07:30 IST Saturday)
- [x] Implemented `pipeline/store.py` with GitHub Release asset download, temporary upload, size verification, and atomic swap.
- [x] Measured full 3-year peak RAM during compute: **107.10 MB** (and **101.63 MB** with `float32`), safely operating within free runner memory bounds.
- [x] Created `tests/test_phase1.py` with synthetic fixtures.

### Phase 2: Data Correctness & Quality Gates (COMPLETED)
- [x] Case A corporate action handling in `pipeline/adjust.py`: compares 10-session overlapping close prices against stored rows. If any close diverges by $>1\%$, triggers full token history re-fetch, replaces stored rows, and logs to `price_adjustments`.
- [x] Vectorised large-move detector: logs single-day price moves $\ge 20\%$ to `price_adjustments` as `LARGE_MOVE_20PCT`.
- [x] Implemented `pipeline/quality_gate.py`: blocks publish and trim if $<1,500$ instruments have a candle on the latest date, Nifty 50 or Nifty 500 candles are missing, or $>5\%$ of fetches failed. Records outcome in `ingest_runs`.
- [x] Telegram alerting via `pipeline/alerts.py` on pipeline or FII/DII fetch failures.
- [x] Universe constituent bug fix: missing constituent files skip that universe with a warning instead of defaulting to all stocks. Added `liquid` universe.
- [x] Point-in-time constituent versioning in `pipeline/instruments.py`: tracks `effective_from` and `effective_to` with `is_active` flags. Vectorised filtering ensures removed stocks leave the universe on their removal date.
- [x] `SmartAPIClient` resilience: authenticates once per run, re-auths only on genuine expiry error codes (`AG8001`, `AG8002`, `AG8003`) capped at 2 per run; terminates sessions on `logout()`.
- [x] Versioned SQL migrations in `pipeline/migrations/` (`001_initial_schema.sql`, `002_add_spec_columns.sql`, `003_constituents_versioning.sql`, `004_readonly_role.sql`).
- [x] Created `tests/test_phase2.py` with synthetic fixtures.

### Phase 3: Metrics Computation per Specification (COMPLETED)
- [x] Weinstein Stages per spec 4.6 in `pipeline/compute.py`:
  - 1% slope threshold on 150-day SMA ($> +1\%$ rising, $< -1\%$ declining, $[-1\%, +1\%]$ flat).
  - 120-session stage memory for Basing (Stage 1) and Topping (Stage 3) transitions.
  - Strict minimum history requirement: $\ge 170$ sessions required, otherwise classified as `stage_unclassified`.
  - Mutually exclusive and exhaustive stages (Stages 1 through 4 + unclassified sum to 100%).
- [x] Strict `min_periods` enforced: removed all relaxed moving average windows.
- [x] Liquidity filter on 4% movers and breakouts: requires close $\ge ₹20$ and prior 50-day average volume $\ge 25,000$ shares.
- [x] Advance/Decline ratio uses `np.maximum(1, declines)` to protect against division by zero.
- [x] 20 EMA seeded with the first 20-session SMA, followed by recursive smoothing ($\alpha = 2/21$).
- [x] Deterministic Market Regime and 6 Market Read indicators (spec 4.8) stored as JSONB in `read_indicators`.
- [x] Breadth-based distribution days: Nifty 500 change $\le -0.5\%$ and declines $\ge 1.5 \times$ advances.
- [x] 252-session publish floor: rows prior to the 252nd trading session are not published.
- [x] Cumulative A-D line storage removed (computed dynamically by API per spec 4.2).
- [x] Created `tests/test_phase3.py` with synthetic fixtures.

### Phase 4: Vercel Hobby + Neon Free API & Frontend (COMPLETED)
- [x] Database pooling in `src/lib/db.js`: capped at `max: 2` connections with `connectionTimeoutMillis: 10000`, `idleTimeoutMillis: 30000`, and `queryWithRetry()` for Neon sleep wakeups.
- [x] Read-only security role `web_readonly` configured via `pipeline/migrations/004_readonly_role.sql`.
- [x] HTTP caching headers in `src/app/api/terminal/data/route.js`: `Cache-Control: public, s-maxage=900, stale-while-revalidate=3600` on success; `no-store` on error.
- [x] Strict session slicing for requested periods: `1M` (21 sessions), `3M` (63 sessions), `1Y` (252 sessions).
- [x] True YTD computation: returns price change relative to the final close of the previous calendar year.
- [x] Real 22-session FII/DII cash flows returned without padding, along with `fiiDiiSessionsAvailable`.
- [x] Rebased series (Large, Mid, Small, and Benchmark rebased to 100 at window start).
- [x] Completely purged all synthetic numbers, mock files, and `?? <number>` fallbacks.
- [x] Unified palette to `#2563EB` across Tailwind configuration, design tokens, and SVG chart gradients.

### Phase 5: Long-Term Operation on Free Plans (COMPLETED)
- [x] Health check route `/api/health` protected by optional `CRON_SECRET` Bearer token.
- [x] Vercel Cron configured in `vercel.json` (`0 4 * * *`) for daily 04:00 UTC execution.
- [x] Alert triggered if breadth data is $>4$ calendar days old (handles weekends and holidays), capped at 1 alert per calendar day via `health_alerts` table.
- [x] GitHub 60-day inactivity alert: checks latest commit on `main`. If $\ge 45$ days old, warns that GitHub Actions will pause scheduled runs.
- [x] Weekly backups: exports `daily_market_breadth` to CSV and uploads dated parquet snapshot `equity_ohlcv_<YYYYMMDD>.parquet` to release `data-latest`.
- [x] Backup retention: `prune_dated_backups()` retains the last 4 dated backups and cleans up older snapshots.
- [x] Neon 700 MB storage guard: daily check on `pg_database_size()`; sends alert and prunes `ingest_runs` older than 90 days if storage exceeds 700 MB.
- [x] UI footer data freshness line: displays `Data as of <asOfDate> · Updated N hours ago` based on `ingest_runs.completed_at`.
- [x] Created `tests/test_phase5.py` with synthetic fixtures.

### Phase 6: Honest Documentation & Specification Reference (COMPLETED)
- [x] Updated `README.md` documenting architecture, free tier constraints, disaster recovery, and CLI commands.
- [x] Updated `PLAN.md` with complete implementation logs and specifications.
- [x] Created `docs/METRICS.md` with exhaustive mathematical formulas, stage transition logic, regime definitions, and data sources.

---

## 🔒 Security & Safe Operation Commitments
- **Zero Secrets in Code or Repositories:** All credentials remain strictly in environment variables (`API_KEY`, `CLIENT_ID`, `PIN`, `TOTP_SECRET`, `DATABASE_URL`, `CRON_SECRET`).
- **Read-Only API Calls:** Only historical candle and market quote APIs are used. Zero trading, placement, or profile endpoints.
- **Explicit Confirmation for Git Push:** Commits and remote pushes are executed only upon explicit user confirmation.
