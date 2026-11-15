# Market Breadth Dashboard — Implementation Plan (Angel One SmartAPI Edition)

Based on **Build Specification v2**, this plan details the phases, architecture, verification tests, data models, and safety rules to transition the dashboard from placeholder data to 100% real NSE data backed by Angel One SmartAPI, Parquet, and Neon PostgreSQL.

---

## 0. Hard Rules & Constraints

1. **No static, mock, or fabricated data**: Delete `src/data/mock*.js` and every import of it.
2. **No numeric fallbacks**: No `?? 1233` or `|| 50`. Missing data renders as `—` or an explicit empty/error state.
3. **No invented formulas**: No multipliers, synthetic ratios, or universe offsets.
4. **No hardcoded dates**: Dates ("Fri, 13 Nov 2026") are dynamically populated from `asOfDate`.
5. **Secrets safety**:
   - Credentials come strictly from environment variables: `API_KEY`, `CLIENT_ID`, `PIN`, `TOTP_SECRET`.
   - Never print, log, commit, or persist session JWTs, tokens, or credentials anywhere.
   - Read-only market data calls only. Zero order or trade endpoints.
6. **Work in phases and stop after each phase for user review.**

---

## 1. System Architecture

```
GitHub Actions cron (or self-hosted runner)
   └─ pipeline/ (Python 3.11+, pandas, pyarrow)
        1. login   -> SmartAPI session (API_KEY + CLIENT_ID + PIN + TOTP)
        2. ingest  -> daily candles per instrument -> equity_ohlcv.parquet (raw store)
        3. adjust  -> Case A overlapping 10-day diffing (corporate-action handling)
        4. compute -> per-stock indicators (vectorised) -> per-universe aggregates
        5. publish -> upsert aggregates + index/macro/flow data into Neon Postgres
        6. trim    -> rolling 3-year retention (floor 504 sessions) on parquet
Neon Postgres  <-  Next.js API route (read only, cached)  <-  React Dashboard
```

- **Raw Store (`equity_ohlcv.parquet`)**: Stored locally and backed up as a GitHub Release asset. Contains raw OHLCV for ~2,300 active NSE equities.
- **Neon PostgreSQL**: Stores only aggregated breadth, index closes, macro rates, institutional cash flows, constituents, instruments, and run logs.
- **Client App**: Next.js 15 (App Router, React 19, Tailwind CSS, Recharts) reads exclusively from `GET /api/terminal/data`.

---

## 2. Phase-by-Phase Roadmap

### Phase 1: Plan & Verification (No Application Code)
- Record real test results in `docs/METRICS.md`:
  - [x] SmartAPI Login: verified locally via TOTP session generation.
  - [x] Rate limit & candle semantics: confirmed ~2.5 to 3.0 req/s rate limit; max days $\ge$ 755 days (3 years returned in 1 call); timestamp format `YYYY-MM-DDTHH:MM:SS+05:30`.
  - [x] Corporate action adjustments: **Case A confirmed** (candles are pre-adjusted across Reliance 1:1 bonus, Tata Steel 10:1 split, and Nestle India 10:1 split).
  - [x] Index tokens confirmed:
    - Nifty 50: `99926000`
    - Nifty 500: `99926004`
    - Nifty Midcap 150: `99926060`
    - Nifty Smallcap 250: `99926062`
    - India VIX: `99926017`
  - [x] Join Angel Master to NSE `EQUITY_L.csv`: 2,599 of 2,600 INE EQ/BE stocks matched (99.96%).
  - [ ] Closes comparison for 20 sample stocks on a single trading date against official NSE Bhavcopy.
  - [ ] Document token stability across renames and confirm FII/DII forward collection policy.
- *Stop for user review.*

### Phase 2: Pipeline Core & Data Storage
- Database schema migration for Neon PostgreSQL:
  - `instruments`, `trading_days`, `daily_index_ohlcv`, `daily_macro_rates`, `daily_fii_dii_cash`, `index_constituents`, `price_adjustments`, `ingest_runs`, `daily_market_breadth`.
- Ingestion engine (`pipeline/`):
  - Token-bucket rate limiter (2.5 req/s) with exponential backoff on rate-limit warnings.
  - 3-year initial backfill script.
  - Case A diffing: re-fetches overlapping 10 sessions, triggers token full re-fetch if $>1\%$ divergence detected.
  - Rolling 3-year retention `trim` command with 504-session floor.
  - Quality gates and post-compute assertions.
- Verify with sample database queries proving real data.
- *Stop for user review.*

### Phase 3: Metrics Computation & API Layer
- Implement vectorised metric calculators in pandas:
  - Advances / Declines, 20D / 40D rolling ratios, cumulative A-D line.
  - 20 EMA, 50 SMA, 200 SMA participation percentages.
  - 20-day and 52-week highs, lows, and net.
  - 4% movers with liquidity filter, 5D and 10D ratios.
  - 20-day breakouts and breakdowns (close > prior 20D high on $\ge 1.5\times$ 50D volume).
  - Weinstein Stages 1 through 4 (150 SMA + 20-day slope with historical memory).
  - Market Regime and 6 Market Read indicators.
  - Large / Mid / Small performance for 1M (21 sessions), 3M (63 sessions), YTD.
- Next.js API Route `GET /api/terminal/data?universe=&period=`:
  - Parameterized PostgreSQL queries.
  - Edge caching (`revalidate = 900`).
  - Empty database returns `asOfDate: null` and empty structures (no 0/fallback inflation).
- *Stop for user review.*

### Phase 4: Frontend Rewiring & Mock Deletion
- Delete all `src/data/mock*.js` files and eliminate all imports.
- Extract data fetching and derivation from `src/app/(terminal)/page.jsx` into custom React hook `useMarketBreadth()`.
- Implement clean loading skeletons, error banners, and empty states.
- Clean all numeric fallbacks (`??`, `||`) across all components.
- Ensure unique SVG gradient IDs across all charts (`useId`).
- *Stop for user review.*

### Phase 5: Cleanup & Definition of Done
- Delete unused UI components (`MetricValue.jsx`, `TrendIndicator.jsx`, `button.jsx`, `loader.tsx`, `select.jsx`, `format.ts`).
- Remove redundant route `src/app/market-breadth/page.jsx` (replace with redirect to `/`).
- Unify color palette to design tokens (resolving `#3478F6` vs `#2563EB`).
- Replace Google Fonts link with `next/font`.
- Fix `tsconfig.json` and configure ESLint.
- Update `README.md` and `.env.example`.
- Run golden-date check and verify definition of done.
- *Final delivery.*

