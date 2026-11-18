# Market Breadth Pipeline Reference

This document outlines the architecture, execution schedule, data sources, and operational runbooks for the automated Market Breadth Pipeline.

---

## 1. Data Flow

```
Daily Trigger (Cron / Workflow Dispatch)
       │
       ▼
Storage Guard & Idempotency Check (C2)
  ├── If Parquet newest == Breadth newest & no gap: IDEMPOTENT NO-OP (< 1m)
  └── If Parquet newer than Breadth: COMPUTE-ONLY (re-run indicators & publish)
       │
       ▼ (if new trading session needed)
Sync Steps (1-5): Instruments, Constituents, Indices, Macro, FII/DII
       │
       ▼
Step 6: Equities Ingest (DAILY_SOURCE switch)
  ├── DAILY_SOURCE=bhavcopy: Single HTTP download of official NSE Bhavcopy zip
  │     └── Corporate action check (diff > 0.5%) -> Angel full re-fetch (cap 200)
  │     └── Fallback to Angel if file corrupt or unreachable for past dates
  └── DAILY_SOURCE=angel: Adaptive rate-limited SmartAPI candle fetches (~2,600 calls)
       │
       ▼
Early Save (A4): If latest date has >= 1,500 tokens, upload Parquet immediately to GitHub Releases
       │
       ▼
Step 7: Adjustments Scan (Parquet-only 20% move scan, zero Angel calls)
       │
       ▼
Quality Gate Check: Schema, OHLC validity, benchmark presence, failure rate <= 2%
       │
       ▼
Step 8: Compute & Publish: Breadth, Participation, Regime, Screener tables -> Neon DB
       │
       ▼
Step 9: Trim: Prunes Parquet store to rolling 3-year retention floor
       │
       ▼
Final Release Upload: Uploads trimmed equity_ohlcv.parquet to GitHub Releases
```

---

## 2. DAILY_SOURCE Switch

The daily equities ingest source is controlled via the repository variable / environment variable `DAILY_SOURCE`:

- `angel` (default): Fetches incremental daily candles from Angel One SmartAPI using adaptive rate-limiting (1.0 req/s initial, 0.4 floor on throttle, automatic recovery).
- `bhavcopy`: Downloads the public NSE Capital Market Bhavcopy zip file (`BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip`) directly from NSE archives.
  - One HTTP request per trading date.
  - Zero Angel calls in the typical case.
  - Replaces ~2,600 API calls and cuts ingest duration from ~35 minutes down to < 2 minutes.

> **Note**: Do not flip `DAILY_SOURCE` in GitHub Actions repository variables until `verify-bhavcopy` has been run and confirmed green.

---

## 3. Fallback Rules

When `DAILY_SOURCE=bhavcopy`:
1. **Past Date 404**: Treated as a market holiday and skipped with an informational log.
2. **Past Date Unreachable / Corrupt**: If the Bhavcopy is unreachable (non-404 error) or fails data validation (e.g., missing columns, invalid OHLC, < 1,500 rows), the pipeline immediately falls back to the Angel path for that specific date only and sends an alert to Telegram.
3. **Today's Date Polling**: If today's Bhavcopy is not yet published at run time, the pipeline polls every 5 minutes for up to 40 minutes. If still unpublished after 40 minutes, it fails with a high-priority Telegram alert rather than silently falling back.
4. **Gaps > 10 Days**: If more than 10 trading dates are missing, the pipeline automatically routes to the Angel path for multi-date reconstruction.

---

## 4. Verification Command (`verify-bhavcopy`)

To verify that NSE Bhavcopy values match Angel One prices within tight tolerances:

```bash
# In local terminal:
python -m pipeline.cli verify-bhavcopy

# In GitHub Actions:
# Run "Market Breadth Pipeline" workflow via Actions tab with command: verify-bhavcopy
```

**Verification checks performed**:
- Downloads the latest available Bhavcopy from NSE archives.
- Selects 30 sample stocks: 25 highest traded-value stocks + 5 random stocks.
- Fetches official Angel One daily candles for the same date.
- Compares OHLC (tolerance <= 0.05% or <= 0.05 absolute) and Volume (tolerance <= 1%).
- Compares Bhavcopy previous close (`PrvsClsgPric`) against stored Parquet close for all common tokens.
- Fails with exit code 1 if mismatch rate exceeds 10%.

---

## 5. Cron Schedules (UTC & IST)

| Cron (UTC) | Time (IST) | Trigger Days | Pipeline Command | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `0 14 * * 1-5` | 19:30 IST | Mon – Fri | `daily` | **Main Run**: Primary post-market run after Bhavcopy and settlement are finalized. |
| `30 16 * * 1-5` | 22:00 IST | Mon – Fri | `daily` | **Retry Run**: Automatically catches runs if GitHub cron was delayed or Bhavcopy published late. |
| `30 0 * * 2-6` | 06:00 IST | Tue – Sat | `daily` | **Safety Net Run**: Pre-market catch-up before Indian market opens. |
| `0 2 * * 6` | 07:30 IST | Saturday | `weekly` | **Weekly Re-fetch**: Full 3-year historical re-sync ensuring rolling retention window. |

All three daily weekday crons trigger the `daily` command, which executes the idempotent no-op check (C2) to complete in under 1 minute if data is already up to date.

---

## 6. How to Recover a Missed Day

If GitHub Actions was down or runs were skipped:

1. **Automatic Catch-up**:
   - Simply trigger the `daily` workflow from GitHub Actions or let the next scheduled cron run.
   - The pipeline inspects `equity_ohlcv.parquet` against today's date and chronologically ingests all missing weekday sessions oldest-first.
2. **Manual CLI Catch-up**:
   ```bash
   python -m pipeline.cli daily
   ```
3. **If Database Breadth Failed to Publish**:
   - If Parquet already has the data but Neon DB compute failed, the pipeline detects `parquet_max > breadth_max` and runs `compute-only`, skipping ingest and immediately republishing indicators.
   - You can also manually trigger:
   ```bash
   python -m pipeline.cli recompute-all
   ```

