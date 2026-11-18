# PIPELINE SPEED + RELIABILITY FIX (for Antigravity)

Repo: dipesh4036/swing, branch v1. Work in 3 separate commits (A, B, C). Run `pytest -q`, `npx tsc --noEmit`, `npx eslint src` after each and report pass/fail.
Do NOT change breadth or screener logic. Real data only. No mock numbers. No new paid services.

## Security (unchanged, strict)
- Angel credentials only from env (API_KEY, CLIENT_ID, PIN, TOTP_SECRET). Never print, log, commit.
- Read-only Angel market-data calls only. Never persist session tokens.
- The NSE bhavcopy is public: no credentials, a normal User-Agent, polite polling (see B).

## What is wrong now (evidence from real runs, do not re-investigate)
1. A daily run makes TWO full Angel passes: step 6 `ingest_equities` (1 call per stock, last 20 days) and step 7 `adjust` (`pipeline/adjust.py`,
   the same ~2,600 calls again, same 20 days). Run #3: ingest 37 min + adjust ~30 min + rest ~5 min = 72 min.
2. GitHub runs #4 and #5 were CANCELLED at `timeout-minutes: 90` while inside step 7 (log: "Rate limit exception for token 8797", ascending tokens).
   cli.py uploads the Parquet only after the whole workflow, so the Nov 17 data was lost. Store and breadth still end at 2026-11-16.
3. Angel throttles even at 1.8 req/s (`SmartAPIClient.requests_per_sec`). Retries (1s, 2s, 4s) then return an empty list, so a throttled stock
   is counted the same as a stock with no data. ingest_runs shows 212 and 216 failed of 2,608.
4. `ingest_equities` counts a stock as "success" if ANY candle came back (the 20-day window returns old days), not if the target date is present.
5. BUG (split/bonus check is defeated): ingest overwrites the stored last 20 days (`drop_duplicates(keep="last")`) BEFORE `adjust` compares stored vs
   re-fetched closes, so they always match and a corporate action is never detected.
6. BUG: `adjust.py` reads `tok_df["isin"]` and `tok_df["series"]`, but the real Parquet has only 9 columns:
   token(int64), symbol(str), trade_date(str YYYY-MM-DD), open, high, low, close (float64), volume(int64), traded_val(float64 = close*volume).
   It would crash with KeyError on the first real corporate action. Use only the 9 real columns everywhere.
7. GitHub cron is best-effort and has fired 8+ hours late (cron 15:30 UTC started 23:47 UTC). Time-of-day cannot be relied on.

## COMMIT A — stopgap that stops the bleeding (Angel path only, no bhavcopy yet)
A1. Remove the second Angel pass. Delete the per-token Angel loop from workflow step 7 (daily, catch-up, weekly, backfill all use run_daily_workflow).
    Move the corporate-action check INTO `ingest_equities`, BEFORE merging: for each token fetched incrementally, compare the fetched closes with the
    stored closes for the same dates (existing_df, taken before any overwrite). If any |new - stored| / stored > 1%, re-fetch that token's FULL window,
    replace only that token's rows, and write the existing `price_adjustments` row (reuse the table/columns adjust.py writes today). Cap at 200 such
    tokens per run, alert if the cap is hit.
    Keep the "adjusted 1-day move >= 20%" scan, but make it Parquet-only (zero Angel calls). Step 7 stays in the log as "Step 7/9: adjust (no Angel calls)".
A2. Failure accounting. `get_candle_data` must raise or return a distinct result for "throttled after retries" vs "no data for this stock".
    `ingest_equities` counts: success = target trade date present for that token; no_data; throttled. Retry throttled tokens ONCE at the end of the
    run at half speed (max 5 min). Report the three counts in ingest_runs.error_message and the return dict. Status rules: "failed" if the newest
    target date is missing for more than 2% of expected tokens, "partial" if 0.5-2%, else "success". Telegram alert on partial/failed.
    The quality gate keeps working but use the same 2% rule (replace the old 5%).
A3. Adaptive rate: env ANGEL_REQ_PER_SEC (default 1.0). On a throttle exception reduce the rate by 25% for the rest of the run (floor 0.4),
    recover +5% after 50 clean calls (cap = the env value). Log the rate changes. No extra threads: Angel's limit is account-wide, parallel calls do not help.
A4. Save work early. After step 6 succeeds and the latest date has >= 1,500 tokens, call `upload_parquet_store` immediately (keep the dated backup
    behaviour that exists in store.py), and again at the end. A timeout in compute must never lose a fetched day again. Do not upload if step 6 failed.
A5. Timing. Log `Step N/9 done in X.Xs` for every step, plus a final summary: total time, Angel call count, throttle count, rate at end.
A6. Workflow: `timeout-minutes: 120`. Keep the existing 3 crons for now.
A7. Tests (no network, Angel mocked): corporate action is detected in the ingest path (stored old close 100, fetched adjusted close 50 -> token fully re-fetched
    and rows replaced with the 9-column schema); throttled != no_data; status rules at 0.4% / 1% / 3%; ingest result "success" requires the target date;
    upload happens after step 6; adjust step makes zero Angel calls.

## COMMIT B — NSE bhavcopy as the daily source (+ verification command)
New file `pipeline/bhavcopy.py`. Controlled by env `DAILY_SOURCE` = `angel` (default) or `bhavcopy`. The user flips it only after verification passes.
B1. URL for trade date D: `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip`.
    NOT VERIFIED from our side: try this host first, then `https://archives.nseindia.com/content/cm/...` with the same file name. Send a browser-like
    User-Agent and Referer (same style as pipeline/instruments.py for EQUITY_L.csv). One request per date, timeout 30s, no parallel NSE requests.
    Log HTTP status, bytes, and the Last-Modified header if present.
B2. Parse (zip holds one CSV; 34 columns: TradDt, BizDt, Sgmt, Src, FinInstrmTp, FinInstrmId, ISIN, TckrSymb, SctySrs, XpryDt, FininstrmActlXpryDt, StrkPric,
    OptnTp, FinInstrmNm, OpnPric, HghPric, LwPric, ClsPric, LastPric, PrvsClsgPric, UndrlygPric, SttlmPric, OpnIntrst, ChngInOpnIntrst, TtlTradgVol, TtlTrfVal,
    TtlNbOfTxsExctd, SsnId, NewBrdLotQty, Rmks, Rsvd1-4).
    Keep rows with Sgmt == "CM", SctySrs in ("EQ","BE"), ISIN starting "INE". Map: FinInstrmId -> token (this equals the Angel token; verified for
    RELIANCE 2885, SBIN 3045, TCS 11536, HDFCBANK 1333, INFY 1594), TckrSymb -> symbol, TradDt -> trade_date, OpnPric/HghPric/LwPric/ClsPric -> open/high/low/close,
    TtlTradgVol -> volume, traded_val = close * volume (same formula as the Angel path). Keep PrvsClsgPric in memory only (not stored).
    Validate or reject the whole file: TradDt == requested date, >= 1,500 kept rows (config), no NaN/<=0 in OHLC, high >= low, close within [low, high].
    A reference file for 2026-11-17 had 3,756 rows, 2,591 after the filter.
B3. Daily bhavcopy ingest (replaces step 6 when DAILY_SOURCE=bhavcopy):
    - Find missing dates: every weekday after the latest stored trade_date up to today (IST). Process oldest first. This also recovers any gap (Nov 17 today).
    - Past date -> HTTP 404 = market holiday, skip and log. Today's date -> file not published yet: poll every 5 min up to 40 min total, then FAIL with a
      Telegram alert (do not silently fall back for today's date; the fallback rule is below).
    - More than 10 missing dates: use the (fixed) Angel path for the repair, log why.
    - BEFORE appending a date: corporate-action check. For each token present in both the file and the Parquet, compare PrvsClsgPric with the stored close of the
      previous stored session. If |diff| / stored > 0.5%, add to `refetch_tokens`. After the date is merged, fully re-fetch each refetch token from Angel (same
      code as A1, 9-column schema, price_adjustments row). Cap 200 per run; above the cap: alert and refetch only the 200 largest |diff|.
    - New tokens (in the file, active in `instruments`, not in the Parquet): fetch the full window from Angel once (cap 100 per run, alert above). New tokens
      are exempt from the previous-close check. Tokens in the file but not in `instruments`: log only.
    - Tokens in the Parquet but absent from the file: log count and symbols (first 20). Do not delete, do not change is_active (sync_instruments owns that).
    - Merge with the same dedupe/sort/atomic-write logic as ingest_equities. Zero Angel calls in the normal case.
    - ingest_runs row: run_type "equities", plus the counts (dates ingested, rows, refetched, new tokens, absent).
B4. Fallback: if DAILY_SOURCE=bhavcopy and the file is unreachable for an OLD missing date (not 404), or the file fails validation, log it and use the Angel path
    for that date only; send a Telegram alert. Never mix a partial bhavcopy date.
B5. New CLI command `verify-bhavcopy` (+ add to workflow_dispatch choices). Needs Angel login (secrets exist in Actions). It writes nothing to Parquet or Neon.
    - Download the latest available bhavcopy (try today, then back up to 5 days). Print the NSE host used, HTTP status, bytes, Last-Modified.
    - Take 30 tokens: 25 with the highest traded value in the file and 5 random. Fetch the Angel ONE_DAY candle for that date (1 call each, 1 req/s).
    - Compare open/high/low/close (pass if |diff| <= 0.05% of price or <= 0.05 absolute) and volume (pass if relative diff <= 1%). Print a table of mismatches and
      a JSON summary: sample size, ohlc_ok, volume_ok, worst volume diff %, per-field mismatch counts. Exit code 1 if volume or OHLC fails for > 10% of the sample.
    - Also compare the file's PrvsClsgPric with the stored Parquet close for the previous session over ALL common tokens and print: matched count, mismatches > 0.5%,
      list of mismatching symbols (first 30). (On a quiet day this is ~100% match; on a split day it lists the stock.)
B6. Tests (no network; build a small synthetic zip with the 34 column names): series/ISIN filter excludes SM, GB, SG, ST and non-INE; rejects wrong TradDt, <1,500
    rows, NaN OHLC, high<low; mismatch at 0.4% not flagged, at 0.6% flagged; new token not flagged; multi-date catch-up processes oldest first and uses the prior
    date's close; past-date 404 skipped as holiday; today 404 -> poll then fail (mock sleep); gap > 10 dates routes to Angel; refetch replaces only that token's rows;
    idempotent re-run adds no rows; fallback triggers on validation failure.

## COMMIT C — schedule, no-op, freshness
C1. Cron (UTC) in .github/workflows/pipeline.yml: `0 14 * * 1-5` (19:30 IST, main), `30 16 * * 1-5` (22:00 IST, retry), `30 0 * * 2-6` (06:00 IST next day, safety net),
    keep the weekly `0 2 * * 6`. Update the "Determine Pipeline Command" script to match the new strings (all three daily crons -> `daily`).
    Pass `DAILY_SOURCE: ${{ vars.DAILY_SOURCE || 'angel' }}` as env. Keep `timeout-minutes: 120`. Keep the concurrency group (no cancel).
C2. Idempotent no-op: at the start of `daily`, if the Parquet's newest date equals `max(trade_date)` in daily_market_breadth AND no weekday gap exists up to the
    latest published trading day, exit success in under 1 minute without writing to Neon or uploading. If the Parquet is newer than breadth (publish failed
    last time), skip ingest and only run compute. Log which branch ran.
C3. Stale-data banner (UI): in Market Breadth and Screener pages, if `asOf` is more than 1 business day behind today (IST) show a visible banner
    "Data is stale: last update <date>". Use the API's asOf only. No fabricated values. Dark and light tokens as existing.
C4. docs/PIPELINE.md: short section: data flow, DAILY_SOURCE switch, fallback rules, verify-bhavcopy, what each cron does, how to recover a missed day.

## Final report (required)
1. pytest -q / tsc / eslint results per commit.
2. Angel calls per daily run, before vs after (expected after A: ~2,600 once; after B with bhavcopy: ~0 plus refetches/new tokens).
3. Grep gate clean (no `?? 0`, no Math.random, no hardcoded prices). Confirm no secret is logged.
4. List anything in this prompt you could not implement or had to change, and why.
Do not flip DAILY_SOURCE yourself. The user runs `verify-bhavcopy` first, checks the output, then sets the repo variable.
