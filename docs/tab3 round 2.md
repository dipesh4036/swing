# PROMPT — TAB 3 SECTOR ROTATION, ROUND 2 (branch v1): fixes T1–T7 + UI redesign and sector stock map T8–T11 + real-data corrections T12–T14

Review of 564696a / f16ba8b: pytest 111 passed + 1 skipped, tsc/eslint clean, all node tests pass, regression test OK. The code below still has real bugs. Fix only these (T1–T7), then do the UI/data work in T8–T11. Same rules as the original prompt (real data only, no secrets, non-fatal sector steps, do not change Breadth/Screener numbers). After fixing: pytest, `npx tsc --noEmit`, `npx eslint .`, `npm run test:js`, CI green. Commit and report hashes.

## T1 — `indices_macro.py`: sector tokens are hardcoded from memory, dynamic resolution is never used
Real data check (from the master dump you supplied): all 9 hardcoded tokens are currently correct (Bank 99926009, FinService 99926037, IT 99926008, Pharma 99926023, Auto 99926029, FMCG 99926021, Metal 99926030, Realty 99926018, Media 99926031), and Angel has NO spot index for Healthcare, Consumer Durables or Oil & Gas. So this is a robustness fix, not a data fix: the point is that a token can never silently drift. Keep the name-verification rule below.
- `workflow.py` calls `sync_sector_indices` with no `scrip_master`, so `resolve_sector_angel_tokens` always falls to `SECTOR_INDEX_FALLBACK_TOKENS` (hardcoded numbers). The original prompt said: never hardcode tokens, resolve by name from `OpenAPIScripMaster.json`.
- Fix: download the scrip master inside `sync_sector_indices` (reuse the fetch in `instruments.py`, `ANGEL_SCRIP_MASTER_URL`; cache once per run) and resolve every sector from it. If the master cannot be fetched, do NOT use hardcoded tokens: skip the Angel fetch for that run, keep the stored index series, mark the step degraded.
- Delete `SECTOR_INDEX_FALLBACK_TOKENS`. A token may be used only if the master entry's name matches the expected sector index name (exact upper-case match after trimming); log `sector -> name -> token` for each. A sector with no match → `equal_weight` (see T5), never a guessed token.
- Sanity-check the fetched candles: reject a response whose last close is zero/None or whose date range is shorter than 100 sessions; log and keep stored data.

## T2 — `sectors.py::sync_stock_sectors`: a partial download corrupts the mapping, stale rows never leave
- If a higher-priority CSV fails (e.g. Bank) but a later one downloads (Financial Services), bank stocks get assigned to `financial_services` and the upsert overwrites their stored sector. A failed download must never reassign stocks.
- Fix: if ANY sector CSV fails, do not upsert reassignments for stocks whose stored sector's CSV failed. Simplest correct rule: when any CSV fails, only add stocks that have no stored mapping; never change an existing row; mark degraded. When ALL CSVs succeed, replace the table inside one transaction (upsert new assignments, then delete rows whose symbol is not in the new assignment) so stocks that left their sector index do not stay forever.
- Validate each CSV: ≥ 5 rows and a `Symbol` column; a tiny/odd file counts as failed.
- Test: Bank CSV fails, FinServ succeeds → HDFCBANK stays in `bank`. All succeed and a symbol disappears → it is removed.

## T3 — `compute_sector_metrics`: `% above 200 DMA` uses the wrong denominator
`pct_above_200dma` divides by `n_valid` (computed from `has_valid_50sma`). Stocks with 50–199 sessions of history are counted as "not above 200 DMA". Use separate denominators: `has_valid_50sma` for 50DMA, `has_valid_200sma` for 200DMA, `has_valid_20ema` for 20EMA (these columns exist in `compute_stock_indicators`). Keep `n_valid` as the 50DMA-valid count, and add `n_valid_200` to `daily_sector_breadth` (new migration `011`, nullable) so the UI can show a warning when it is below `MIN_SECTOR_STOCKS`. If a denominator is below `MIN_SECTOR_STOCKS`, that percentage is NULL. Test with a hand-computed fixture where half the stocks have <200 sessions.

## T4 — `compute_sector_metrics`: stock returns are computed after the liquidity filter
`df_sec` is filtered to liquid rows first, then `shift(5/22/64)` runs per symbol. A stock that was illiquid on some days has a gapped series, so "22 rows back" is not 22 sessions back. Compute `ret_5d/22d/64d` on the full per-token frame BEFORE filtering (group by `token`, use the full session sequence), then filter to liquid and mapped rows. Add a test: a stock with a gap in the liquid mask must get the same 22-session return as without the gap.

## T5 — Equal-weight handling is hardcoded and can clobber an official index
- `EQUAL_WEIGHT_SECTOR_KEYS = {healthcare, consumer_durables, oil_gas}` is a hardcoded set. It must come from the T1 resolution result (sector without a matched official token). Persist the decision (e.g. `price_source` per sector in a small table or the `daily_sector_breadth` row) so P2 and P3 agree.
- The EW series is written into `daily_index_ohlcv` under the same `index_name` as an official index would use. If a sector later resolves to an official token, the EW rows and official rows would overwrite each other. Use a distinct `index_name` for EW series (e.g. `<NAME> (EW)`, ≤30 chars) and have the API read the EW name only when `price_source = 'equal_weight'`. Delete the old EW rows stored under the official name in the same migration/cleanup step.
- "Healthcare" is Pharma-first priority, so it is really "Healthcare (other than Pharma)". Rename the label in Python and JS, and show it as insufficient data if below `MIN_SECTOR_STOCKS` (it already will be).

## T6 — API: silent stale data and a single-index dependency (`sectors/route.js`)
- `asOf` is derived from `index_name = 'NIFTY BANK'`. If Bank fails, the whole tab is empty. Derive `asOf` from `daily_sector_breadth` max date only.
- Returns, quadrant and RS use each series' own last candle, even if that is older than `asOf`, and NIFTY 500 can end on a different date. Windows then compare different periods. Fix: for each sector, require its last candle date == `asOf` and NIFTY 500's last date == `asOf`; otherwise set returns/RS/quadrant to `null` and return `index_asOf` plus `stale: true` for that sector. Compute RS and the returns used for `rs_1m/rs_3m` on the common-date alignment only. The UI shows "stale since <date>" for such a sector instead of numbers.
- `n_stocks` is the count of mapped stocks, not the count in the liquid universe on that date. Rename the field to `n_mapped` and add `n_in_universe` (rows in `df_sec` for that date). The UI must label them honestly ("mapped" vs "tradable today").
- Test the stale path in `tests/test_sectors.mjs` (sector last candle 3 sessions behind → nulls + stale flag).

## T7 — Coverage must be reported, and the sector list is shorter than specified
The original list had 16 sectors; only 12 are implemented, with no report of which were dropped. Capital Goods, Chemicals, Power and Telecom are missing, and they are leading groups in this market. Do the following and report it:
1. Real data: `ind_niftycapitalgoodslist.csv`, `ind_niftychemicalslist.csv`, `ind_niftypowerlist.csv`, `ind_niftytelecomlist.csv` return an HTML 404 page with HTTP 200 (your validator correctly rejects them), so those sectors cannot come from a sector-index CSV. Do NOT retry them or guess alternates. They are covered by T12 (Industry-based groups) instead. Keep the HTML/`Symbol` validation.
2. Report the coverage: mapped stocks / liquid universe size on the latest date, per-sector `n_mapped` and `n_in_universe`, and how many mapped stocks are NOT in the liquid universe.
3. Add a visible "Coverage" line on the Sector page: "Sectors cover N of M tradable stocks (Nifty sector-index constituents only)". Do not imply the page covers the whole market.
4. Add a parity test: the Python `SECTORS` keys/labels/index names equal the JS list (`src/lib/sector-math.js`). The two lists must not drift (generate the JS list from the Python one, or fail CI on mismatch).

## T8 — Data: per-stock sector table (so every sector shows ALL its stocks)
The page must list every mapped stock of every sector with real metrics, so the user can find the best stocks inside the best sectors without leaving the tab. Today only index-level and aggregate numbers exist; the web app cannot read the Parquet store, so the pipeline must publish them.
1. Migration `011_sector_stocks.sql` (merge with the T3 `n_valid_200` column migration): table `sector_stock_metrics`, one row per mapped stock for the **latest published trade date only** (replace-on-run: upsert today's rows, delete rows of older dates in the same transaction). Columns: `trade_date`, `token`, `symbol`, `name`, `sector`, `in_universe` (BOOLEAN, passes the strict liquid rule on that date), `close`, `ret_1d`, `ret_1w`, `ret_1m`, `ret_3m`, `ret_6m` (percent, session-count based, computed on the FULL per-token frame, see T4), `pct_from_52w_high` (<=0, NULL when no valid 52w), `above_20ema`, `above_50dma`, `above_200dma` (BOOLEAN, NULL when the MA is not valid), `stage` (1–4, NULL if unclassified, reuse `compute_weinstein_stages` output), `vol_ratio` (volume / vol_sma_50, NULL if invalid), `avg_traded_value` (close x vol_sma_50, used for map sizing), `rs_rank` (reuse the exact `calculate_rs_rank` of the screeners over the same eligible universe; NULL if not eligible), `screeners` (TEXT[] of screener keys the stock passes on the latest screener date; empty array if none). PK `(token)`. `GRANT SELECT` to `web_readonly`.
2. Write it from `compute_sector_metrics` (non-fatal, same try/except). Include non-liquid mapped stocks with `in_universe = false` so "all stocks" is true; the UI must show them dimmed and allow hiding them.
3. Never invent: any metric that cannot be computed is NULL. No default 0.
4. `Leaders` definition lives in ONE constants place (`SECTOR_LEADER_RULES` in `pipeline/sectors.py`, mirrored through the API response, not retyped in JS): above 50 DMA AND above 200 DMA AND `pct_from_52w_high >= -15` AND `rs_rank >= 70` (same `min_rs_rank` as `SCREENER_PARAMS`). The UI shows the rule text in a tooltip.

## T9 — API for the stock map and explorer
1. Extend `GET /api/terminal/sectors` (or add `GET /api/terminal/sectors/stocks`, your choice, one request for the page): return every row of `sector_stock_metrics` plus `leader` (boolean computed from the rules constant), and per-stock `sector_rank_1m` / `sector_rank_3m` (rank by return within its sector among `in_universe` stocks only). No composite "score" and no invented grade anywhere. Payload is ~160+ rows, keep fields compact.
2. If `sector_stock_metrics.trade_date` != `asOf` of the sector table, return `stocks_as_of` and the UI shows a warning.
3. Chart for a sector stock: extend the existing chart route with `source=sector` (token must exist in `sector_stock_metrics`, else 404). It uses the same live-Angel-then-fallback logic; stocks not in any screener have no stored candles, so when Angel is unavailable return a clear 404 "Chart unavailable" (the UI shows that text, never an empty fake chart). Stocks that are in a screener keep the "Open in Screener" link.
4. Whitelist all params (sector key, sort, metric, view), parameterized SQL, `requireAuth`.

## T10 — UI redesign (the current page is poor; rebuild `src/app/(terminal)/sectors/page.jsx` and its components)
Goal: a dense, calm trading-terminal page. Same design tokens as the other tabs (no new colours, no hex outside tokens/`chart-theme`), light and dark, readable on a phone. **No animations**: no transitions longer than 100 ms, no fades, slides, pulses or hover transforms (a static skeleton is fine; `animate-pulse` is not). Numbers use `font-mono tabular-nums`, right-aligned. No emoji, no gradients, no shadows beyond the existing `shadow-sm`.
Structure (state in URL query: `?view=map|sectors|stocks&sector=<key>&metric=1d|1w|1m|3m&leaders=1`, invalid values ignored):
1. **Header strip:** title, "as of <date>", coverage line from T7, freshness/degraded/stale banners (reuse existing banner style), an EW legend only when an EW sector exists.
2. **View switch** (`segmented-control`): Map | Sectors | Stocks.
3. **Map view (default): sector map with all stocks inside.**
   - A treemap. Each sector is a bordered group with its label (sector name + its 1M RS vs NIFTY 500 + count) in a header row; inside, every mapped stock is a cell. Cell area = `avg_traded_value` (real data). Stocks without a size are excluded from the map and counted under the group ("N without size data"), they stay in the table view.
   - Cell colour = chosen metric (`1D / 1W / 1M / 3M` toggle, default 1M). Use 5 discrete steps per side from the bullish/bearish tokens (clamp at ±3% for 1D, ±6% 1W, ±15% 1M, ±30% 3M), neutral grey for null. Colour is never the only signal: the cell shows the symbol and the value when it fits; cells too small for text show a tooltip (symbol, close, the four returns, RS rank, % from 52w high, stage). Leaders get a solid border; non-`in_universe` stocks are dimmed.
   - Implement a pure squarified treemap in `src/lib/treemap.js` (no library). Layout runs on container size via ResizeObserver; no animation on resize.
   - Click a cell: opens the stock detail panel (below). Click a sector header: sets `sector=` and switches to the Stocks view filtered to it.
   - Phone width: the treemap is replaced by a sector accordion list (one row per sector, expandable to its stocks with symbol, value, colour chip); do not render a tiny unreadable treemap.
   - Beside/below the map: the **rotation scatter** (kept, but compact) with sector labels, colour-independent quadrant text, and click-to-filter.
4. **Sectors view:** sortable table, sticky header, 12–16 dense rows: rank, sector, quadrant text badge, 1W/1M/3M return, RS 1M/3M, % > 50 DMA, % > 200 DMA, 52w highs/lows, leaders count, screener hits, a static inline-SVG RS sparkline (120 sessions, no animation), EW badge or stale marker. Insufficient/stale sectors show `—` with the reason and sort last. Row click selects the sector and opens the Stocks view for it.
5. **Stocks view (the "find the best stock in the best sector" screen):** one table of ALL mapped stocks (default sorted by RS rank desc), sticky header, columns: Symbol, Sector, Close, 1D, 1W, 1M, 3M, % from 52w high, vs 50 DMA, vs 200 DMA (up/down text chips), Stage, RS rank, Vol ratio, sector-rank 1M, Screeners (small tags), Leader marker. Controls: sector dropdown + sector chips (sorted by 1M RS, shows counts), "Leaders only" toggle, "Screener hits only" toggle, "Hide illiquid" (default on), text search, any column sortable, and an explicit empty state. A row count line ("37 of 157 stocks"). Rows are 36 px, keyboard focusable, Enter opens the detail panel.
6. **Stock detail panel** (right side panel on desktop, bottom sheet on phone, opens instantly, no animation): symbol/name/sector, the metric grid above, screener tags, chart (T9.3) or the honest "Chart unavailable" text, buttons: "Open in Screener" (only if it has a screener tag) and "Show sector". Close with Esc / button. A sector summary block sits above the stock rows when a sector is selected (its quadrant, RS, breadth numbers).
7. Quality gates: loading skeleton (static), empty state naming the missing pipeline step, error box with Retry, 401 -> `/login`, no layout shift when data arrives, and no horizontal page scroll at 360 px width (tables scroll inside their own container with a sticky first column).

## T11 — Tests for T8–T10
- Python: `sector_stock_metrics` fixture test with hand-computed expected values (returns, `pct_from_52w_high`, flags NULL when MA invalid, `in_universe` false for an illiquid stock, only latest date kept, `screeners` array), and a test that `Leaders` rules match the constants and `SCREENER_PARAMS["min_rs_rank"]`.
- Node: `treemap.js` (area proportional to weight within 1%, no overlap, all cells inside the bounds, zero/NaN weights excluded, single-item and empty inputs), colour-step function (boundaries, null), sorting/filter helpers for the explorer (leaders, hide illiquid, search, sort with nulls last), URL-state parsing (invalid values ignored), route whitelist for `metric/view/sector/sort`.
- Render smoke tests (`test_render.mjs`): Map, Sectors and Stocks views with empty, partial (nulls, stale sector) and full data; phone-width path renders the accordion; detail panel renders with and without a chart.
- All existing suites stay green; Breadth/Screener regression test still byte-identical.

## T12 — Coverage: 157 stocks is too few. Extend the map with the Nifty 500 `Industry` column
Real data: 12 sector CSVs map only 157 stocks (healthcare 4, media 10, realty 10, IT 10…), `unmatched_rows` = 0 so matching is fine; the limit is that sector-index files only list ~10–20 stocks each, and Capital Goods / Chemicals / Power / Telecom / Construction etc. have no file at all. The user wants ALL stocks of every sector on the map, so use a second source that already exists in the repo: `ind_nifty500list.csv` (downloaded by `instruments.py`, columns include `Industry`, `Symbol`, `ISIN Code`).
1. Store `industry` (nullable TEXT) in `stock_sector` (migration `011`), filled from the Nifty 500 CSV during `sync_stock_sectors` (same fetch helper, same HTML/`Symbol` validation, same "stored fallback on failure" rule as T2). Add `mapped_via` (`'index'` | `'industry'`) per stock.
2. Assignment order stays: (a) sector-index CSV membership first (current rule, priority order), (b) then every remaining Nifty 500 stock goes to the sector its `Industry` maps to via ONE table `INDUSTRY_TO_SECTOR` in `pipeline/sectors.py`. **Build that table from the real distinct `Industry` values in the downloaded CSV** (print them with counts in your report); do not type Industry names from memory. An Industry that maps to an existing sector (IT, Auto, FMCG, Metals, Realty, Media, Consumer Durables, Oil & Gas, Financial Services, Healthcare) extends that sector; every other Industry becomes its own sector group (`group_type = 'industry'`, e.g. Capital Goods, Chemicals, Power, Telecommunication, Construction, Construction Materials, Services, Textiles…). An Industry you cannot map is kept as its own group, never dropped and never lumped into "Other".
3. Merge Pharma into Healthcare: Pharma and Healthcare indices overlap, which left Healthcare with 4 stocks (guarded to nulls). Replace the two with ONE sector `healthcare`, label "Healthcare (Pharma + Hospitals)", members = Pharma index ∪ Healthcare index ∪ Industry `Healthcare`. Price source = equal-weight (see T5). Remove the `pharma` key everywhere (Python, JS, tests); the migration/cleanup must delete old `pharma` rows from `stock_sector`, `daily_sector_breadth`, and the old `NIFTY PHARMA` index rows only if unused (keep the stored index candles; just stop publishing it as a sector).
4. Bank: the Industry `Financial Services` mixes banks, NBFCs and insurers. To keep Bank clean, also try the Nifty Private Bank and PSU Bank constituents CSVs (Angel has both indices, so they are real; test slugs `ind_niftyprivatebanklist.csv` and `ind_niftypsubanklist.csv` at runtime, drop on failure, no alternates). Bank = Nifty Bank ∪ Private Bank ∪ PSU Bank members; remaining Financial Services stocks go to `financial_services`.
5. Sector price/series rule: a sector with an official Angel index (Bank, Financial Services, IT, Auto, FMCG, Metal, Realty, Media) uses the official index for index-level returns and RS, but breadth and the stock map cover ALL its mapped stocks (index + industry). Show this in the sector tooltip ("index: official; breadth/stocks: all Nifty 500 members"). Groups without an index use the equal-weight series (`<NAME> (EW)`, T5). Industry-only groups and every EW sector carry the EW badge.
6. Universe note for the UI and README: the map now covers Nifty 500 stocks only. Stocks outside the Nifty 500 are not shown. Report: mapped stocks per sector (index vs industry), total mapped, total in the liquid universe, how many Nifty 500 stocks are unmapped (must be 0 after step 2).
7. Tests: an Industry value not in the table becomes its own group; index membership wins over Industry; a Nifty 500 stock appears exactly once; the merge of Pharma+Healthcare; stored fallback when the Nifty 500 download fails (mapped_via='industry' rows kept, nothing reassigned).

## T13 — Sector data is stale and the failure is invisible
The live page says "as of 2026-11-16 · Sector As-Of Lag" on Saturday 2026-11-21, so the latest session is Friday 2026-11-20: the sector tables are 4 sessions behind while Breadth is current.
1. Diagnose: run `recompute-all` after the fixes and confirm `MAX(trade_date)` in `daily_sector_breadth` and `sector_stock_metrics` equals `MAX(trade_date)` in `daily_market_breadth`. Report what caused the lag (the sector step only runs in `compute_and_publish_all` inside a try/except that only calls `logger.error`; the daily runs may have failed it silently, or only `backfill_sector_breadth` was run once).
2. Make failure visible: if `compute_sector_metrics` raises or publishes 0 rows, `compute_and_publish_all` must record it (return a flag) and the workflow must add `compute_sector_metrics` to `degraded_steps` and mark the run `partial` (same mechanism as macro/FII-DII). Health route: add `sectorStaleDays` using `daily_sector_breadth` (degraded if > 1 session behind breadth, not > 3 weekdays: the sector data is derived from breadth, so any lag is a bug).
3. Log one line per run: sector rows published, stocks mapped, stocks in universe, latest date.
4. UI: when `asOf` is behind `breadthAsOf` show the existing as-of-lag banner with both dates and the number of sessions behind (it already exists; keep it and make it name the sessions).

## T14 — UI defects visible in the current page (fix as part of T10)
Screenshot findings, desktop 1710 px wide:
1. A 4-stock "Healthcare" EW sector ranks #2 and sits in the scatter as "Improving" although its breadth is `—`. A sector below `MIN_SECTOR_STOCKS` must not appear in the scatter or in the ranking order; it is listed last, greyed, with "insufficient constituents". After T12 this should not occur, keep the rule as a guard.
2. The rotation scatter occupies about 530 px of a 1,600 px wide card; the rest is empty. Make it fill the card width, with a height that keeps a sensible aspect ratio. Auto-range both axes from the data (symmetric around 0, with padding) instead of a fixed ±6/±9 that clips or wastes space.
3. Labels collide ("Healthcare"/"Auto", "Oil & Gas"/"Consumer Durables" cut to "l & Gas", "Financial Services"/"Bank"). Use short labels (a `short` field per sector, e.g. FinSvc, ConsDur, Oil&Gas) and a deterministic label-offset pass (try 8 positions around the dot, pick the first without overlap, draw a thin leader line if moved). Never clip a label at the plot edge.
4. Quadrant watermark text ("LEADING", "IMPROVING"…) is drawn over the dots. Move it to the plot corners, small and muted.
5. The sector table leaves a large empty block under 12 rows and the right panel is a tall column with large empty space: apply the T10 layout (Map / Sectors / Stocks) so the page uses its width for the map and the stock list.
6. The Healthcare panel text "Universe: 4 mapped stocks (insufficient history for breadth percentages)" is wrong: it is insufficient constituents, not history. Use accurate reason strings: `insufficient constituents (<8)` vs `insufficient history (<200 sessions)`.
7. The RS chart shows the lightweight-charts logo; keep the required attribution but make it small and consistent with the other charts (the grid charts use `attributionLogo: false`; use the same setting everywhere and put the attribution text once in the page footer).

## Report back
Hashes, test counts, the distinct `Industry` values with counts and your `INDUSTRY_TO_SECTOR` table (T12), the Private/PSU Bank slug results, mapped-stock counts per sector (index vs industry) and total mapped vs liquid universe, the sector-lag diagnosis (T13), `sector -> master name -> token` table, the coverage numbers from T7.2, and one before/after of `pct_above_200dma` for one sector on the latest date. For T8–T10 also report: row count in `sector_stock_metrics`, how many are `in_universe`, how many are Leaders, how many mapped stocks have no `avg_traded_value`, and a hand check of one stock's 1M return and `pct_from_52w_high` against stored closes. Attach desktop and 360 px screenshots of the Map, Sectors and Stocks views in light and dark.

---

# PROMPT — TAB 3: SECTOR ROTATION (branch v1)

Build a third tab, **Sector Rotation**, next to Market Breadth and Screener. Read this whole file first. Do the phases in order. Commit after each phase (message `feat(sectors): P<n> ...`), push to `v1` at the end, then report commit hashes.

## 0. Non-negotiable rules
- **Real data only.** No mock, default, placeholder or invented numbers anywhere (code, tests against live data, UI). Missing value → `null` in DB/API and `—` in UI. A sector with too little data is shown as "insufficient data", never filled.
- **Free tier only:** Vercel Hobby, Neon free, GitHub Actions. No new paid service, no new API key. No new heavy dependency (reuse `lightweight-charts`, Tailwind tokens, lucide).
- **Security (unchanged):** credentials only from env vars (API_KEY, CLIENT_ID, PIN, TOTP_SECRET); never print, log, commit or paste them; Angel calls are read-only market-data only; never persist Angel session tokens; do NOT add Angel secrets to Vercel; the web app uses the read-only DB role only; every new API route calls `requireAuth`; every query param is whitelisted; SQL is parameterized.
- **Do not change existing numbers.** Market Breadth and Screener outputs must be identical before/after (add a regression test, see P6). Do not touch the Tapetide/Fundamentals code.
- **Never guess an external URL or token.** Verify each one at implementation time (HTTP 200 + expected columns / present in the instrument master). Anything that fails is dropped and listed in the report. Do not invent a substitute.
- New non-core pipeline steps are **non-fatal**: failure marks the run `partial` with `degraded_steps` (same pattern as macro/FII-DII), never blocks breadth publishing.
- Lint/CI lessons: import everything you use (CI has `no-undef`), no hardcoded tokens/URLs scattered in code (one constants module), tests must pass without secrets, `next build` must pass.

## 1. What the tab answers
"Where is money moving?" — which sectors are leading/improving/weakening/lagging vs the broad market, how broad the participation is inside each sector, and how many screener setups each sector has today. It must let the user go from sector → Screener filtered to that sector.

## P1 — Sector definitions and stock→sector mapping (data layer)
1. Create `pipeline/sectors.py` with ONE ordered list `SECTORS` (single source of truth, imported by pipeline and mirrored to the web via the API response, not duplicated by hand). Each entry: `key`, `label`, `index_name` (the `daily_index_ohlcv.index_name`, ≤30 chars, upper-case), `constituents_slug` (niftyindices CSV file stem), `angel_name` (name to look up in the Angel instrument master).
2. Starting list (order = assignment priority, most specific first):
   Bank, Financial Services (ex-Bank), IT, Pharma, Healthcare (other than Pharma), Auto, Capital Goods, Chemicals, Consumer Durables, FMCG, Metal, Oil & Gas, Power, Realty, Media, Telecom.
   Optionally split Bank into Private Bank / PSU Bank only if both constituents files verify.
   Excluded on purpose: Hospitals, Insurance, REITs, Housing Finance, Retail, all MidSmall/Nifty500-Healthcare/FinServ-25-50 variants (too few stocks or duplicates), Sensex/BSE indices (data is NSE bhavcopy), India VIX (belongs to Breadth).
3. Download each sector's constituents CSV from niftyindices.com using the **same fetch helper and headers** `instruments.py` already uses for `ind_nifty500list.csv` (URL pattern `https://niftyindices.com/IndexConstituent/<slug>.csv`). Verify each one: HTTP 200, has `Symbol` (and `Industry`, `ISIN Code` if present). Slugs that fail are dropped from the run and logged; do not guess alternates.
4. New table `stock_sector` (migration `010_sectors.sql`, follow the existing migration mechanism): `symbol`, `isin`, `sector` (key), `source_index`, `updated_at`; PK `(symbol)`. **One primary sector per stock**: a stock found in several sector CSVs gets the FIRST sector in `SECTORS` order. Store the full multi-membership nowhere; document the rule in a docstring.
5. Match by **ISIN first, symbol second** (symbols change; the repo already uses ISIN identity). Constituents with no match in `instruments` are logged and counted, not invented.
6. Sync job `sync_stock_sectors()` refreshes weekly (add to the existing weekly cron path, not daily) and on `backfill`. If the download fails, keep the stored mapping and mark degraded (same stored-fallback logic as `check_stored_constituents_exist`).
7. Migration also `GRANT SELECT` on new tables to `web_readonly` explicitly (do not rely on default privileges alone).
8. Coverage honesty: sectors come from Nifty-index constituents, so stocks outside every sector index have no sector. Report the covered/uncovered counts. Uncovered stocks are simply excluded from sector breadth.

## P2 — Sector index prices (`daily_index_ohlcv`)
1. Resolve each sector's Angel index token **from `OpenAPIScripMaster.json` by name** (NSE segment, index instrument type) — do not hardcode token numbers from memory. Log which sectors resolved and which did not.
2. Extend `indices_macro.py`: a separate `sync_sector_indices()` (not mixed into the 5 existing `INDEX_TOKENS`) fetching 3 years of daily candles via the existing `SmartAPIClient` (keep its login backoff and rate limiting; sequential calls with the existing delay; ~16 extra calls is fine). Upsert into `daily_index_ohlcv` with `index_name` = the sector's `index_name`. Non-fatal in the daily workflow.
3. **Fallback for a sector with no resolvable Angel token:** do NOT silently substitute. Mark `price_source = 'equal_weight'` for that sector and compute an equal-weight index from its constituents' stored closes (rebased to 100) in P3; the UI shows an "EW" badge with tooltip "equal-weight of constituents, not the official NSE index". Official-index sectors show no badge.
4. Handle partial history (new index with <3 years): store what exists; never pad.

## P3 — Sector breadth and strength (pipeline compute)
Add `compute_sector_metrics()` in `pipeline/sectors.py`, called from `compute_and_publish_all` **after** the existing breadth publish, using the same per-stock indicator frame (`df_ind`) and the **same strict-liquid universe and publish floor** so numbers reconcile with the Breadth tab. Wrap it so an exception here logs, marks degraded, and does NOT fail breadth.
New table `daily_sector_breadth` (same migration): `trade_date`, `sector`, `n_stocks` (in sector, in universe), `n_valid` (with a defined indicator), `pct_above_50dma`, `pct_above_200dma`, `pct_above_20ema`, `advances`, `declines`, `new_52w_highs`, `new_52w_lows`, `ret_1w_ew`, `ret_1m_ew`, `ret_3m_ew` (equal-weight mean of constituents' returns), `price_source`; PK `(trade_date, sector)`. Percentages use `n_valid` as denominator; if `n_valid < MIN_SECTOR_STOCKS` (constant, default 8) store the counts but `NULL` the percentages and flag `insufficient`.
- Reuse the exact definitions of "above 50 DMA", "new 52w high", advance/decline already in `compute.py` (import, do not reimplement). Use the market-calendar adjacent prev_close helper for returns.
- Computed for the same date range `recompute-all` publishes (so history backfills with **no Angel calls**).
- For `equal_weight` sectors also write the rebased index series into a table or into `daily_index_ohlcv` under the sector `index_name` with a flag so the API can mark it.

## P4 — API (`src/app/api/terminal/sectors/route.js`)
`GET /api/terminal/sectors` (auth required, read-only role, `Cache-Control: private, max-age=300`, `maxDuration` set like the other routes):
- `asOf` = latest date present in BOTH `daily_sector_breadth` and `daily_index_ohlcv` for sectors; also return the breadth tab's latest date so the UI can show a staleness warning if they differ.
- Per sector: label, `price_source`, `n_stocks`, `n_valid`, returns 1W/1M/3M/6M (computed from `daily_index_ohlcv` closes by **session counts** 5/22/64/126, not calendar days), the same returns for NIFTY 500, `rs_1m`/`rs_3m` = sector return minus NIFTY 500 return (percentage points), breadth fields from `daily_sector_breadth`, `screener_hits` (count per screener from `daily_screener_results` joined to `stock_sector` on the latest screener date, only whitelisted screener names), and `quadrant`.
- **Quadrant (simplified RRG — label it "RS trend", do NOT call it JdK RRG):** `RS = sector_close / NIFTY500_close` (aligned on common trade dates only). `x` = (RS / SMA(RS, 50) − 1) × 100. `y` = (RS / RS[10 sessions ago] − 1) × 100. Leading x>0,y>0; Weakening x>0,y≤0; Lagging x≤0,y≤0; Improving x≤0,y>0. Needs ≥ 60 aligned sessions, else `quadrant = null`.
- Also return a short `rs_series` (last 120 sessions of RS, rebased to 100) per sector for the chart; no other bulk history.
- Rank fields are computed server-side from the returned numbers only. All nulls stay null. Put the pure math (returns, RS, quadrant) in `src/lib/sector-math.js` (exported, unit-testable, no DB).
- Add optional `sector` filter to the **existing** `/api/terminal/screener` route (whitelist = `SECTORS` keys + `all`); join `stock_sector`; unknown value → 400. Add `sector` to each returned row so the list can show it. Do not change any existing field.

## P5 — UI (`src/app/(terminal)/sectors/page.jsx`)
- Add "Sector Rotation" to `Sidebar.jsx` NAV_ITEMS (pick a lucide icon that exists in the installed version; verify the import), same active/inactive styling as the others. Mobile menu too.
- Layout (use existing design tokens, light + dark, phone-first):
  1. Header: "as of <date>", freshness/degraded banner if sector data is older than breadth, EW legend.
  2. **Rotation scatter** (inline SVG, no new library): x = RS vs 50-day, y = 10-day RS momentum, quadrant shading with bullish/bearish tokens (never colour alone: also quadrant text), point labels, tooltip, hit-target ≥ 32 px on mobile.
  3. **Sector table** (sortable, default sort 1M RS desc): Sector, quadrant badge, 1W/1M/3M return, RS 1M/3M vs N500, % > 50DMA, % > 200DMA, 52w highs/lows, Screener hits, EW badge when relevant. On narrow screens collapse to cards. Insufficient-data sectors show `—` and an "insufficient data" label, sorted last.
  4. Row click → detail panel: RS line chart (`lightweight-charts`, rebased 100, theme-aware like `ScreenerGrid`, with cleanup/`.remove()` and ResizeObserver) + the sector's breadth numbers + button **"Open in Screener"** → `/screener?sector=<key>`.
- Screener page: read `sector` from the URL query, show a removable chip, pass it to the API, handle invalid value by ignoring it. Keep the abort-controller/race fixes already in place.
- States: loading skeleton, empty (no data yet → say which pipeline step is missing, no fake rows), error with Retry (and 401 → `/login`, same as the screener grid).
- No emoji, no decorative gradients; follow the existing component style.

## P6 — Tests (must run in CI without secrets)
- `tests/test_sectors.py`: priority assignment (stock in Bank + FinServ → Bank); ISIN-first matching; missing-CSV fallback keeps stored mapping; breadth math on a small hand-computed fixture (exact expected values written out); `n_valid < MIN_SECTOR_STOCKS` → NULL percentages; equal-weight rebasing; no row is ever created for a sector with zero stocks.
- **Regression test:** run `compute_breadth_for_universe` on an existing fixture before/after enabling the sector step and assert identical output.
- `tests/test_sectors.mjs` (add to `npm run test:js`): `sector-math.js` returns/RS/quadrant with hand-computed cases incl. misaligned dates, <60 sessions → null, zero/negative close guards; route whitelist rejects bad `sector`; render smoke test for the sectors page and the scatter with empty, partial and full data (add to `test_render.mjs`).
- `pytest`, `npx tsc --noEmit`, `npx eslint .`, `npm run test:js` all green. CI (`ci.yml`) green including `next build`.

## P7 — Wiring and ops
- Add `sync_stock_sectors` to `backfill` and the weekly path, `sync_sector_indices` to the daily workflow as a **non-fatal** step (renumber log lines consistently, keep step ordering before compute).
- Health route: add `sectorStaleDays` (weekday difference, degraded if > 3, same as FII/DII/macro).
- Update README (tab description, data sources, the sector coverage caveat, how to run the new commands). No secrets in docs.

## Verification gates (report before finishing)
1. List of sectors that verified a constituents CSV, and those dropped (with reason).
2. List of sectors on an official Angel index token vs `equal_weight` fallback.
3. Counts: stocks mapped to a sector / liquid universe size, per-sector `n_stocks`, uncovered count.
4. For the latest date: print the sector table (label, n_valid, %>50DMA, %>200DMA, 1M return) and check that the sum of per-sector `advances + declines` ≤ the all-stocks advances + declines from Breadth for the same date (must hold; if it does not, there is a bug).
5. Two spot checks done by hand against real stored closes (one official-index sector, one equal-weight sector) showing the computed 1M return matches a manual calculation.
6. Test counts (pytest, node), and the `npm audit --omit=dev` summary line.

## Do NOT
- Do not hardcode Angel index tokens from memory. Do not reuse the generic `Industry` column as the sector (it is a different taxonomy than the sector indices; at most store it as an extra column, unused in v1).
- Do not call the quadrant "RRG" or "JdK". Do not present equal-weight series as official index data.
- Do not add any stock-level fundamentals, news or LLM scoring to this tab.
- Do not begin another tab or refactor unrelated files.
