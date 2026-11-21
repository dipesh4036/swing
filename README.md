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

## 🧭 Tab 3: Sector Rotation

The **Sector Rotation** dashboard answers the institutional question: *"Where is money moving?"* by tracking the flow of capital across 12 canonical NSE sectors against the NIFTY 500 benchmark.

### 1. Canonical Taxonomy & Assignment
- Stocks are mapped to sectors using official NSE index constituent lists fetched directly from `niftyindices.com`.
- **Assignment Priority:** Specific sectors precede broad ones (e.g., Bank takes priority over Financial Services).
- **Matching:** ISIN-first matching prevents missing symbols across symbol rename events.
- **Minimum Stock Threshold (`MIN_SECTOR_STOCKS = 8`):** If a sector has fewer than 8 liquid constituents with valid indicators (e.g. Healthcare), breadth percentages (>50 DMA, >200 DMA, >20 EMA) and equal-weight returns are kept as `NULL` (rendered as `—`) to prevent statistical distortion from tiny sample sizes. Counts (advances, declines) remain recorded.

### 2. Relative Strength & RS Trend Quadrants
- **Relative Strength (RS):** Aligned on common trading dates:
  $$\text{RS}_t = \frac{\text{Sector Close}_t}{\text{NIFTY 500 Close}_t}$$
- **RS Trend Quadrants (Simplified RRG):**
  - **x-axis (RS vs 50 DMA %):** $\left(\frac{\text{RS}_t}{\text{SMA}_{50}(\text{RS})} - 1\right) \times 100$
  - **y-axis (10-Session RS Momentum %):** $\left(\frac{\text{RS}_t}{\text{RS}_{t-10}} - 1\right) \times 100$
  - **Leading:** $x > 0, y > 0$ (strong trend, strong momentum)
  - **Weakening:** $x > 0, y \le 0$ (above 50-day RS mean, but losing short-term momentum)
  - **Lagging:** $x \le 0, y \le 0$ (underperforming benchmark and decelerating)
  - **Improving:** $x \le 0, y > 0$ (below 50-day RS mean, but gaining short-term momentum)
  - Minimum 60 common sessions required to compute quadrant; sectors with insufficient history are listed in the footer and omitted from the scatter plot.

### 3. Official Indices vs. Equal-Weight Fallback
- For sectors with official spot index tokens on Angel One (`NIFTY BANK`, `NIFTY IT`, `NIFTY PHARMA`, `NIFTY AUTO`, `NIFTY FMCG`, `NIFTY METAL`, `NIFTY REALTY`, `NIFTY MEDIA`, `NIFTY FINANCIAL SERVICES`), official 3-year daily candles are synchronized into `daily_index_ohlcv`.
- For sectors without official spot index tokens on Angel One (`NIFTY HEALTHCARE`, `NIFTY CONSUMER DURABLES`, `NIFTY OIL & GAS`), an equal-weight index series is synthesized from constituent daily returns compounded from base 100.
- In the UI, equal-weight sectors display an amber **EW** badge with the tooltip: *"Equal-weight of constituents, not the official NSE index"*. Official index sectors show no badge.

### 4. Screener Integration
- Every sector in the ranking table and detail panel provides a 1-click **"View in Screener"** action (`/screener?sector=<key>`).
- The Screener page reads the query parameter, displays a removable active filter chip (`Sector: <Label> [x]`), and displays the sector tag alongside RS rank in candidate cards.

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
