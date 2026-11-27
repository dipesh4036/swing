# 📊 Market Breadth Dashboard (Angel One SmartAPI Edition)

An institutional-grade Market Breadth and Market Internals analytics terminal for Indian Equities (NSE), designed to run **100% free forever** on standard developer tiers without degradation.

**Zero Mock Data Guarantee:** Zero mock data, zero synthetic fallback numbers, zero invented multipliers, and zero hardcoded dates. Every metric, chart series, and indicator traces directly to verified market data stored in Neon PostgreSQL and Parquet.

### Known advisories
- Next.js 16 major upgrade is deferred to maintain production stability on Next.js 15. All nested PostCSS vulnerabilities (`GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-fxqj-rqcc-2cmp`, `GHSA-r28c-9q8g-f849`) are patched via `overrides`: `postcss: >=8.5.23`, achieving 0 audit vulnerabilities on production dependencies (`npm audit --omit=dev`).

---

## 🏛️ System Architecture

The system operates across three coordinated free-tier cloud platforms:

```
[ GitHub Actions (Public Repo - Free) ]
   ├── Cron Schedules (UTC):
   │     ├── Daily:    11:30 UTC (17:00 IST)
   │     ├── Catch-up: 15:30 UTC (21:00 IST)
   │     └── Weekly:   02:00 UTC Sat (Full re-fetch)
   └── pipeline/
         1. Download equity_ohlcv.parquet from GitHub Release 'data-latest'
         2. Login via SmartAPI TOTP (read-only token session, max 2 re-auths)
         3. Sync instruments, point-in-time constituents, indices, macro, FII/DII
         4. Ingest daily equity candles (~2,300 active NSE equities)
         5. Adjust (Case A 10-day overlapping diffing for splits/bonuses)
         6. Quality Gate (>=1,500 candles, Nifty 50/500 present, <=5% fail rate)
         7. Compute vectorised breadth across 7 universes (Weinstein, A/D, MAs)
         8. Publish aggregates & macro to Neon PostgreSQL
         9. Trim parquet to rolling 3-year retention (504-session floor)
         10. Upload updated equity_ohlcv.parquet to GitHub Release asset
                │
                ▼ (Aggregates & Small Tables Only - Zero OHLCV)
[ Neon PostgreSQL (Free Tier - 1 GB Storage) ]
   ├── Tables: daily_market_breadth, daily_index_ohlcv, daily_macro_rates,
   │           daily_fii_dii_cash, index_constituents, instruments, ingest_runs
   ├── Storage Guard: 700 MB alert threshold + 90-day ingest_runs pruning
   └── Database Roles:
         ├── Admin/Owner: Read/Write used exclusively by GitHub Actions pipeline
         └── web_readonly: SELECT-only role used by Vercel App (Migration 004)
                │
                ▼ (Max 2 pooled connections, 1 retry on sleep wake)
[ Vercel Hobby (Free Tier) ]
   ├── Frontend: Next.js 15 (App Router, React 19, Tailwind CSS, Recharts)
   ├── Edge API Route: GET /api/terminal/data (public cache: s-maxage=900)
   └── Health Check Cron: GET /api/health (runs 04:00 UTC daily via Vercel Cron)
```

---

## 🛡️ Long-Term Operation on Free Plans

### 1. Zero Raw Price Storage in Database
- Neon PostgreSQL free tier provides **1 GB of storage**.
- Raw minute/daily OHLCV candles are **never stored in PostgreSQL**. All raw history is maintained in an optimized `equity_ohlcv.parquet` file stored as an asset in the GitHub Release `data-latest`.
- Neon stores only lightweight aggregates (`daily_market_breadth`), index closes, macro rates, institutional flows, and constituents (~50 MB per year).

### 2. Ephemeral Storage with Safe Parquet Swapping
Because GitHub Actions runners are ephemeral, `pipeline/store.py` manages safe remote state:
- Downloads `equity_ohlcv.parquet` at the start of every run.
- Uploads the new file under a temporary name (`equity_ohlcv.parquet.tmp`), verifies file size, and atomically swaps it with the production asset.
- Automatically preserves the previous file as `equity_ohlcv.parquet.backup`.
- If any step fails or the quality gate triggers, the upload is aborted to prevent store corruption.

### 3. Neon Sleep & Connection Throttling
- Neon free compute instances sleep after 5 minutes of inactivity.
- The web app pool is strictly capped at **2 concurrent connections** (`max: 2`) with an `idleTimeoutMillis` of 30,000 ms to prevent connection exhaustion.
- Queries use `queryWithRetry()`, which intercepts connection dropouts and automatically retries with a 1.5-second backoff while Neon wakes up.
- Successful API responses are cached via `Cache-Control: public, s-maxage=900, stale-while-revalidate=3600`, reducing database wakeups.

### 4. 60-Day GitHub Actions Inactivity Warning
GitHub automatically disables scheduled workflows on public repositories if no commit activity occurs within **60 days**:
- The `/api/health` check runs daily at 04:00 UTC via Vercel Cron.
- It inspects the latest commit date on `main`. If no commits have been pushed for **45 days**, it sends a Telegram alert:
  > *"⚠️ GitHub Actions will pause scheduled runs in X days. Push any commit to reset the timer."*
- **How to reset:** Simply make a minor commit or manually click "Run workflow" in GitHub Actions.

### 5. Neon 700 MB Storage Guard & Pruning
- At the start of every daily run, the pipeline inspects `SELECT pg_database_size(current_database());`.
- If storage exceeds **700 MB**, it issues a Telegram alert and prunes audit rows older than 90 days (`DELETE FROM ingest_runs WHERE started_at < NOW() - INTERVAL '90 days'`).
- Historical breadth aggregates (`daily_market_breadth`) and FII/DII cash flows are tiny and are **never pruned**.

### 6. Read-Only Database Role (`web_readonly`)
- Migration `004_readonly_role.sql` provisions a dedicated `web_readonly` role with `SELECT` privileges only.
- Even in the event of an API compromise, the production database cannot be dropped, modified, or written to from the web tier.

---

## 🔄 Disaster Recovery: Complete Database Reconstruction

If the Neon PostgreSQL database is ever wiped, corrupted, or deleted, **no market data is lost**:

1. Create a fresh Neon database and run the versioned schema migrations:
   ```bash
   psql $DATABASE_URL -f pipeline/migrations/001_initial_schema.sql
   psql $DATABASE_URL -f pipeline/migrations/002_add_spec_columns.sql
   psql $DATABASE_URL -f pipeline/migrations/003_constituents_versioning.sql
   psql $DATABASE_URL -f pipeline/migrations/004_readonly_role.sql
   ```
2. Reconstruct the entire database directly from the Parquet store without touching Angel One:
   ```bash
   python -m pipeline.cli recompute-all
   ```
   This command loads `equity_ohlcv.parquet` from the latest release, re-evaluates all Weinstein stages, moving averages, highs/lows, and regime rules for the past 3 years, and publishes complete breadth aggregates to Neon in minutes.

---

## 🔐 Authentication & Owner Account Setup

The entire application (pages and APIs) is private and accessible only to a single pre-created owner account. There is no signup route and no password-reset route.

### 1. Configure Secrets
1. Generate a secure random auth secret (at least 32 bytes):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Set `AUTH_SECRET` in your local `.env` and in your **Vercel Project Settings -> Environment Variables**.
3. In local `.env`, set `ADMIN_DATABASE_URL` pointing to your Neon database owner connection string (used only for local account creation and migrations; never deploy `ADMIN_DATABASE_URL` to Vercel).

### 2. Create the Owner Account
Run the one-time interactive script locally:
```bash
node scripts/create-user.mjs owner@example.com
```
- The password is read from a hidden interactive prompt (never from CLI args, env, or files).
- Pass `--replace` if you ever need to re-create or overwrite the existing owner account.
- **Never commit passwords, tokens, or credentials to Git.**

### Rate Limiting & Lockout
- Failed login attempts are recorded prior to password verification (`INSERT ... success=false RETURNING id`) to prevent parallel brute-force race conditions (maximum 5 attempts per 15 minutes per IP or email+IP).
- **Per-email lockout note**: An attacker attempting 20 failed logins for the owner's email from an unknown device/IP will trigger a 15-minute 429 lockout for that email on new/unknown IPs by design; previously authenticated IPs with known successful logins remain unaffected.

---

## 🧭 Tab 3: Industries Relative Strength (`RS_STS`)

The **Industries** dashboard tracks capital flow across NSE's 4-level industry classification hierarchy (**Macro → Sector → Industry → Basic Industry**) against the **NIFTY 500** benchmark.

### 1. 4-Level Classification & Incremental Sync
- **DB-Only Classification Truth**: Classifications live in Neon (`instruments`, `classification_overrides`, `symbol_changes`, `classification_audit`), seeded via `classification-import` from local files (`data/`), matched **ISIN-first** then uppercase symbol+exchange.
- **Incremental Daily Sync**: `classification-sync` checks `EQUITY_L.csv`, applies DB overrides/renames first, and queues up to 20 missing/incomplete symbols per run via rate-limited `GetQuoteApi` lookups (zero per-stock calls when all instruments are mapped; stops on HTTP 403/429).

### 2. Equal-Weight `RS_STS` Formula & Eligibility
- **Group Equal-Weight Index**: Full-window constituents (26 sessions, excluding new IPO listings inside the window and corporate-action jumps > 40%) are normalized to base 100 on session `d0` and averaged across constituents.
- **Relative Strength (`RS_STS%`)**: $\text{RS}_t = \frac{\text{Group EW Index}_t}{\text{NIFTY 500 Norm}_t}$, scored via `PERCENTRANK.INC(RS_series, RS_latest) × 100` (0–100%).
- **Trend & Breadth**: 21-day EMA on RS line, SMA-seeded EMA 20/50/200 participation (valid-observation denominators; zero denominator = `null` / `—`), `ADR%` (20 sessions excluding zero-range bars), and lazy paginated constituent drill-down.

### 3. Screener & CLI Commands
- Deep links from group details open `/screener?groupId=<id>` (with legacy `/screener?sector=<key>` compatibility adapter).
- CLI commands: `classification-import`, `classification-sync`, `industry-recompute`, `industry-backfill`, `backfill-top-groups`. See `docs/SECTOR_INDUSTRY.md` for operational details and [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for UI tokens and Tab 3 component patterns.

---

## ⚡ CLI Commands

The pipeline CLI (`pipeline/cli.py`) provides commands for maintenance and automated cron execution:

```bash
# Test Angel One SmartAPI login, TOTP generation, and candle fetch
python -m pipeline.cli test-connection

# Daily execution (sync -> ingest -> adjust -> quality gate -> compute -> publish -> trim)
python -m pipeline.cli daily

# Catch-up run (re-runs daily sequence for late exchange data or failed runs)
python -m pipeline.cli catch-up

# Weekly full re-fetch (requests full 3-year history, exports breadth backup, prunes dated assets)
python -m pipeline.cli weekly

# Full recompute from local or downloaded parquet without calling Angel One API
python -m pipeline.cli recompute-all

# Manual parquet trim (enforces 3-year rolling window with 504-session floor)
python -m pipeline.cli trim
```

---

## 🧪 Testing

The test suite validates trim floors, quality gates, Case A adjustments, 4% mover filters, Weinstein stages, and storage safeguards using synthetic fixtures:

```bash
# Activate virtual environment
source .venv/bin/activate

# Run full test suite
pytest tests/ -v
```

---

## 📄 License & Specification Reference

- Metrics specification: [docs/METRICS.md](docs/METRICS.md)
- Design tokens & palette: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md)
