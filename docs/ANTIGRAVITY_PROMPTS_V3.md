# ANTIGRAVITY PROMPTS — 3 PARTS (do them in order, one at a time)

Global rules for all parts:
- Do only what the part says. Do not change unrelated code.
- Never print, log, commit or ask for credentials, passwords, tokens or secrets. Use placeholders in docs.
- Commit each part separately with a clear message.
- At the end of each part run: `pytest -q`, `npx tsc --noEmit`, `npx eslint src`. Report pass or fail for each. Then STOP and wait for my review before the next part.

======================================================================
PART 1 — LOGIN (single owner account, no signup)
======================================================================
Goal: the whole app (pages and APIs) is private. Only one pre-created account can log in.

1. Migration 007_auth.sql:
   - app_users(id SERIAL PK, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()).
   - login_attempts(id SERIAL PK, email TEXT NOT NULL, ip_hash TEXT NOT NULL, attempted_at TIMESTAMPTZ DEFAULT now(), success BOOLEAN NOT NULL).
   - Grant the existing web_readonly role: SELECT on app_users, and SELECT + INSERT + DELETE on login_attempts ONLY. No other write grants. Add a test or a verification query that web_readonly still cannot write to any other table.
2. Password hashing: use bcryptjs (pinned exact version), cost 12. Minimum password length 12.
3. Account creation: a one-time local script scripts/create-user.mjs.
   - Email is a CLI argument. The password is read from a hidden interactive prompt (never from argv, env or a file, and never logged).
   - Uses an owner-role connection string from env ADMIN_DATABASE_URL (local machine only).
   - Refuses to run if a user already exists, unless --replace is passed.
   - There is NO signup route and no password-reset route.
4. Sessions: signed JWT (use `jose`, pinned) in an httpOnly, Secure, SameSite=Lax cookie. Expiry 7 days. Secret from env AUTH_SECRET (at least 32 random bytes). No server-side session storage.
5. Routes:
   - POST /api/auth/login: validate input, look up the user, compare with bcrypt. If the user is missing, still compare against a dummy hash (constant-time behaviour). Always return the same generic error "Invalid email or password". Record each attempt in login_attempts.
   - Lockout: more than 5 failed attempts for the same email OR the same ip_hash in 15 minutes returns 429. Delete login_attempts rows older than 7 days on each login call. Hash the IP with AUTH_SECRET before storing.
   - POST /api/auth/logout clears the cookie.
6. Enforcement (defence in depth):
   - middleware.js protects every page and API except: /login, /api/auth/login, /api/health (it has its own CRON_SECRET bearer check), and static assets/favicon. Pages redirect to /login. /api/* return 401 JSON.
   - ALSO add a requireAuth() helper and call it at the top of every API route handler (/api/terminal/data, /api/terminal/screener, /api/terminal/screener/chart). Middleware alone is not enough.
   - Verify the installed Next.js version is patched against the 2025 middleware authorization-bypass issue (>= 15.2.3 or the latest 15.x). Upgrade within 15.x if not.
7. UI: a minimal /login page using the existing theme tokens, and a Logout button in the sidebar. No signup link.
8. Docs: .env.example gets AUTH_SECRET (placeholder) and ADMIN_DATABASE_URL (local only). README explains: create the user once, set AUTH_SECRET on Vercel, never commit secrets.
9. Tests: hash/verify, token sign/verify/expiry, lockout logic, every API route returns 401 without a cookie, /api/health still works with its CRON_SECRET, login page is reachable when logged out.

======================================================================
PART 2 — LIVE CHART FROM ANGEL (secured) + EMA ONLY + CLEANUP
======================================================================
Decision: the chart loads full history live from Angel One through the Next.js server, only for the logged-in owner. The database is the fallback. Do NOT delete src/lib/smartapi.js. Secure and fix it.

1. Access: the chart route calls requireAuth() (Part 1). Serve only tokens that exist in the latest daily_screener_results (404 otherwise, as now).
2. Harden src/lib/smartapi.js:
   - Remove the hardcoded X-ClientPublicIP and X-MACAddress values. Use neutral placeholders (127.0.0.1 and 00:00:00:00:00:00) with optional env overrides ANGEL_CLIENT_PUBLIC_IP and ANGEL_MAC.
   - Single-flight login: concurrent requests share one login promise. Cache the JWT in memory. On an auth error, re-login at most once per request.
   - Global limits per instance: max 2 concurrent Angel calls, request rate <= 2.5/s, timeout 8 s (AbortController), exponential backoff on rate-limit errors.
   - History: fetch ONE_DAY candles for the last CHART_HISTORY_YEARS = 5 (config constant). Request in chunks that respect SmartAPI's per-request day limit for ONE_DAY. Check the official SmartAPI docs for the limit and put it in a constant MAX_DAYS_PER_REQUEST_ONE_DAY. If the docs are unclear, use 400-day chunks. Merge, de-duplicate and sort.
   - Never log credentials, tokens or TOTP values. Sanitise error messages returned to the client.
   - Credentials are read only here, only from process.env (API_KEY, CLIENT_ID, PIN, TOTP_SECRET). Never NEXT_PUBLIC_.
3. Caching: in-memory per-token cache (3 hours) plus response header Cache-Control: private, max-age=3600. NOT public, NOT no-store.
4. Fallback: if Angel fails or the env vars are missing, use screener_candles from Neon. The response includes source: "angel" | "db". The UI shows a small note "Showing stored data (260 sessions)" when source is "db".
5. EMA only:
   - Create src/lib/indicators.js with ONE EMA function (SMA-seeded) and a weekly-aggregation helper.
   - The chart route computes ema_10, ema_20, ema_50, ema_200 with it. Delete attachEMAs from the route and computeEMAs from ScreenerChart.jsx, and use the shared helper for the Weekly toggle.
   - The chart shows only EMA 10, 20, 50 and 200, labelled "EMA 10" etc. No SMA lines or toggle.
   - Remove the highlight_lines mapping hack (sma_50 -> ema_50) from the UI. Remove the highlight_lines key from the pipeline overlays and update the tests and docs/SCREENERS.md.
6. Pipeline cleanup:
   - Delete pipeline/sync_angel_screener_candles.py (it wrote EMA values into sma_* columns).
   - Set candle_window_sessions back to 260 so the fallback table stays small.
7. Remove playwright from package.json (and the lockfile). Keep any screenshot script outside the app dependencies.
8. Tests: the chart route returns 401 without a cookie, 404 for a token not in today's results, uses the DB fallback when Angel is mocked as failing. A grep test fails if API_KEY, CLIENT_ID, PIN or TOTP_SECRET appear anywhere under src/ except src/lib/smartapi.js.
9. Print a MANUAL CHECKLIST for me (do not run it with real credentials):
   a. Put the Angel variables in a local .env.local only. Log in to the app, open a chart, confirm source: "angel" and a long history.
   b. After a web chart load, run the pipeline `test-connection` and confirm the pipeline login still works (tests whether two sessions interfere).
   c. Only after a and b pass: add the four Angel variables to Vercel (never before Part 1 is deployed and login works).

======================================================================
PART 3 — SCREENER RULES (from ScanTheCharts descriptions) + CALIBRATION
======================================================================
ScanTheCharts (i) descriptions (ground truth for intent):
- Stage 2 Breakout: breaking above its 50-day high on twice its usual volume, closing near the day's high, just as it enters Stage 2 out of a base.
- VCP: each pullback smaller than the last, tightening under a high. Only stocks already in a strong uptrend qualify.
- Near Pivot: just under a key resistance level. How close counts as close depends on how much the stock usually moves in a day.
- 50-EMA Pullback: strong uptrending stocks resting on their 50-day average after a quiet month. A deeper pullback than the 20-SMA scan.
- IPO Base: recent IPOs still inside their first base and sitting just under its top. The breakout has not happened yet.

Keep every threshold in SCREENER_PARAMS. Keep the pure eval_* functions. Add volatility unit: atr_pct = ATR(14) / close (Wilder), computed per token.

A. near_pivot
- Keep pivot = highest high of the last 20 sessions (excluding nothing), tt_pass required (make it a param require_tt).
- Closeness: 0 <= (pivot - close) / close <= near_pivot.k_atr * atr_pct, default k_atr = 1.0 (replace the flat 3%).

B. stage2_breakout
- Keep the current rules (tt_pass, stage_2 == 1, breakout_20d, volume >= 1.5x vol_sma_50, close position in the day's range >= 0.6, not extended > 5% above the pivot).
- NEW: accept a breakout that happened on any of the last 3 sessions (param recency_sessions = 3). For breakout day d use that day's own breakout flag, volume ratio, range position and high_20d. Also require today's close >= that pivot and <= 1.05 x pivot (still holding above it).
- Add stats: days_ago (0, 1 or 2) and days_in_stage2 (length of the current consecutive stage_2 == 1 run). Add a marker at the breakout date. Show days_ago in the table. Sort: days_ago asc, then vol_ratio desc.
- Do NOT change RS >= 70, the 20-day high or the 1.5x volume yet (calibration decides).

C. vcp (swing-based)
- Find swings with a zigzag over the last 120 sessions (param zigzag_min_pct = 4%, using highs for tops and lows for bottoms).
- Contractions = successive (swing high -> next swing low) pullbacks. depth_i = (high_i - low_i) / high_i.
- Require: at least 2 and at most 5 contractions, depths strictly decreasing, the last depth <= 10% (param), first depth >= 8% (param), base length 15 to 120 sessions.
- Pivot = the swing high before the final contraction. Price may be up to 3% below to 2% above that pivot (params).
- Uptrend: require_tt = True (param). Volume dry-up is optional (param require_volume_dryup = False).
- Overlay segments: one per contraction (high -> low) labelled with its depth, e.g. "-20.1%".

D. ema50_pullback
- Uptrend (tt_pass). ema_50 rising over 10 sessions.
- Resting on the 50 EMA: low <= 1.02 x ema_50 and close >= 0.99 x ema_50.
- Quiet month: average volume of the last 21 sessions <= 1.0 x vol_sma_50, AND the mean (high-low)/close over the last 21 sessions <= 1.0 x its mean over the last 63 sessions (params).
- Prior extension: keep as a weaker rule, max close of the last 30 sessions >= 1.05 x ema_50 (param, replacing 8% over 15).

E. ipo_base
- Eligible: first_candle_date within 365 days (a real listing, as now), sessions since listing >= 15 (param min_listing_sessions), tradability: close >= 20 and avg_volume(last min(n, 50) sessions) x close >= 1 crore.
- Remove the ema_20 requirement and the 10-day range rule.
- base_top = max high from listing to the previous session. Not broken out: close <= base_top. Just under: (base_top - close) / close <= ipo_base.k_atr * atr_pct (default k_atr = 2.0). Base depth (base_top - lowest low since the base_top date) / base_top <= 35%. At least 5 sessions since the base_top date.
- Overlay: level "Base top" (pivot), dashed "Base low", marker "Listing".

F. CALIBRATION (do this, then STOP)
Create scripts/calibrate_screeners.py (offline, no credentials, reads the repo's Parquet store; download it with the existing helper if missing).
- For each symbol in the lists below it prints PASS, or the FIRST failing rule with the actual value vs the threshold.
- It also prints our total count per screener and, for each screener, 5 symbols we show that are not in the list (so I can sanity check them).
- Lists are from ScanTheCharts screenshots on 2026-11-16 and 2026-11-17 (intraday, and our data may be one session behind, so expect small differences):
  - IPO Base: FUSIONCX, AONESTEELS, SMT, BLSPOLY, JPL, KNACK, VEEGALAND (ScanTheCharts total 6)
  - VCP: VSSL, KROSS, GOODLUCK, GNA, SANATHAN, SKYGOLD, BHAGERIA, MGEL, IOLCP, JSWINFRA, BHEL, ENGINERSIN, DOLPHIN, DELTACORP, AETHER (their total 12 to 15)
  - Stage 2 Breakout (partial of ~63): ALICON, SRD, GCSL, ESAFSFB, ANURAS, APOLLO, SURYODAY, SBIN, HDFCLIFE, NAVINFLUOR
  - Near Pivot (partial of ~49): SHALPAINTS, DVL, MMFL, ATL, SANSERA, DCBBANK, GROWW, APLAPOLLO, GLFL, PDSL, CHEMBOND
- Print the table in the final message. Do NOT tune thresholds yet. STOP after printing and wait for my review.

G. Tests and docs
- Update the pure-function tests (pass case and one failing case per rule threshold for each screener, including the ATR-scaled closeness, the 3-session recency and the zigzag contractions), and docs/SCREENERS.md. State clearly that these are our definitions inspired by ScanTheCharts' descriptions, not their exact results.
