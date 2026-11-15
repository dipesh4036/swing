# 📊 Market Breadth Dashboard (Angel One SmartAPI Edition)

An institutional-grade Market Breadth and Internals analytics terminal for Indian Equities (NSE). Built with Next.js 15 (App Router, React 19, Tailwind CSS, Recharts) and backed by a Python pipeline connecting Angel One SmartAPI, local Parquet storage, and Neon PostgreSQL.

**100% Real Data Guarantee:** Zero mock data, zero synthetic fallback numbers, zero invented multipliers, and zero hardcoded dates. Every number traces directly to real market data in PostgreSQL.

---

## ✨ Features

- **Market Read:** Real-time health metrics including Advances vs Declines, % of stocks above 20 EMA / 50 SMA / 200 SMA, and composite market regime status.
- **Stan Weinstein Stage Distribution:** Real Stage 1 (Basing), Stage 2 (Advancing), Stage 3 (Topping), Stage 4 (Declining) distributions derived from price vs 150-day SMA and 20-session slope.
- **Market Participation & Stage Curves:** Interactive multi-timeframe curves (1M / 3M / 6M / 1Y / YTD / ALL) with dynamic universe filtering (Nifty 500, Nifty 200, Nifty 100, Midcap 150, Smallcap 250, All Equities).
- **Institutional Flows:** Daily and monthly net FII/DII cash flows fetched directly from official NSE feeds.
- **Market Internals (6 Granular Analytics Cards):**
  1. *New Highs − Lows* (20D / 52W dynamic toggle with real rolling price extremes)
  2. *Advance / Decline* (20D / 40D rolling ratios / Cumulative A-D Line)
  3. *4% Movers* (Daily net / 5D ratio / 10D ratio momentum expansion)
  4. *Large vs Mid vs Small* (1M / 3M / YTD comparative returns from index closes)
  5. *Breakouts − Breakdowns* (20D channel breakout/breakdown pace on volume $\ge 1.5\times$ 50-day average)
  6. *Participation History* (20 EMA / 50 SMA / 200 SMA historical curves)
- **Benchmark Indices & Macro:** Sparklines and returns for Nifty 50, Nifty 500, Midcap 150, Smallcap 250, India VIX, Brent Crude, and USD/INR.

---

## 🛠️ Architecture

```
GitHub Actions cron (Daily after NSE close ~18:30 IST)
   └─ pipeline/ (Python 3.11+, pandas, pyarrow, psycopg2)
        1. login   -> SmartAPI session (API_KEY + CLIENT_ID + PIN + TOTP)
        2. ingest  -> daily candles per instrument -> equity_ohlcv.parquet (raw store)
        3. adjust  -> Case A corporate-action handling (10-session overlapping diffing)
        4. compute -> vectorised technical indicators -> per-universe aggregates
        5. publish -> upsert aggregates + index/macro/flow data into Neon Postgres
        6. trim    -> rolling 3-year retention (floor 504 sessions) on parquet
Neon Postgres  <-  Next.js API route (/api/terminal/data)  <-  React Dashboard
```

- **Parquet Raw Store (`data/equity_ohlcv.parquet`):** Holds 3 years of daily OHLCV across all active NSE equities.
- **Neon PostgreSQL:** Stores aggregated daily breadth records across all 6 universes, index OHLCV, macro rates, institutional flows, constituents, and run audit logs.
- **Rolling Retention (`RETENTION_YEARS = 3`):** Daily raw OHLCV stored in `equity_ohlcv.parquet` is trimmed to a rolling window of 3 years (with an enforced floor of at least 504 trading sessions). Older Neon results remain permanently in the database.

---

## 🚀 Getting Started

### 1. Configure Environment
Copy `.env.example` to `.env` and fill in credentials:
```bash
cp .env.example .env
```
Required credentials:
- `DATABASE_URL`: Neon PostgreSQL connection string.
- `API_KEY`, `CLIENT_ID`, `PIN`, `TOTP_SECRET`: Angel One SmartAPI credentials (read-only market data access).

### 2. Install Dependencies
```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements.txt # or pip install pandas pyarrow psycopg2-binary pyotp smartapi-python requests yfinance python-dotenv pytest
```

### 3. Run Pipeline Ingestion & Compute
```bash
# Sync active instruments and official index constituents
PYTHONPATH=. python3 pipeline/instruments.py

# Sync index OHLCV (Nifty 50/500/Mid/Small/VIX), macro rates, and FII/DII cash
PYTHONPATH=. python3 pipeline/indices_macro.py

# Ingest daily equity candles into parquet
PYTHONPATH=. python3 pipeline/ingest.py

# Compute all vectorised breadth indicators and publish to Neon DB
PYTHONPATH=. python3 pipeline/compute.py
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the terminal.

---

## 🧪 Testing & Verification

```bash
# Run Next.js lint and typecheck
npm run lint
npx tsc --noEmit
npm run build

# Run pipeline pytest test suite
PYTHONPATH=. pytest pipeline/tests -v
```
