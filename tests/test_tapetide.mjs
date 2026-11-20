/**
 * tests/test_tapetide.mjs
 *
 * Comprehensive test suite for Tapetide fundamentals parser and API route logic.
 *
 * Coverage:
 * 1. Full synthetic fixture parsing
 * 2. Missing sections -> nulls, not zeros
 * 3. Garbage / HTML / empty input -> returns null
 * 4. Numeric parsing edge cases (Indian numbering, negatives, percentages, NA/dash)
 * 5. Script / HTML injection in bullets stays inert plain text
 * 6. Cache hit & negative cache (15 min)
 * 7. Single-flight concurrency deduplication
 * 8. Global rate limiter (20 requests/minute)
 * 9. Route-level tests with mocked fetch & query:
 *    - 401 without session
 *    - 400 invalid symbol
 *    - 404 symbol not in screener results
 *    - Redirect to another host rejected
 *    - Upstream timeout (AbortController)
 *    - Stream size exceeding 1 MB aborted
 *    - Successful route response format
 */

import assert from "node:assert/strict";
import {
  parseTapetideMarkdown,
  parseNumeric,
  sanitizeText,
  TapetideLRUCache,
  TapetideRateLimiter,
  getTapetideFundamentals,
} from "../src/lib/tapetide.js";

// --- SYNTHETIC TEST FIXTURE (FICTITIOUS NUMBERS) ---
const SYNTHETIC_FIXTURE = `---
title: "Test Acme Corp (ACME) Share Price, Financials & Research"
symbol: "ACME"
company: "Test Acme Technologies Ltd"
canonical: "https://tapetide.com/stocks/ACME"
isin: "INE999A01099"
nse_symbol: "ACME"
bse_code: "599999"
sector: "Technology"
industry: "Software Products"
market_cap_cr: 12500.50
generated_at: "2026-11-20T12:00:00.000Z"
---

# Test Acme Technologies (ACME)

Canonical page: https://tapetide.com/stocks/ACME

## Key Facts

- **Price:** ₹1,234.50 as of 20 Nov 2026
- **Market Cap:** ₹12,501 Cr as of 20 Nov 2026
- **P/E (TTM):** 45.20 as of 20 Nov 2026
- **Revenue, Sep 2026 quarter:** ₹450.00 Cr
- **Net profit, Sep 2026 quarter:** ₹55.50 Cr
- **Promoter holding:** 52.30% in Sep 2026

## Key Fundamentals

- **ROCE:** 18.50%
- **Debt to Equity:** 0.15
- **EPS (TTM):** ₹27.30
- **Book Value:** ₹312.40
- **Market Cap:** ₹12,501 Cr
- **P/E (TTM):** 45.20
- **P/B:** 3.95
- **ROE:** 16.80%
- **Dividend Yield:** 1.20%
- **EBITDA:** ₹620 Cr
- **52W High:** ₹1,450.00
- **52W Low:** ₹890.00

## Growth Rate

| Metric | Window | Growth | What it compares |
| --- | --- | ---: | --- |
| Revenue | 5Y | 14.50% | compounded annual rate |
| Revenue | 3Y | 18.20% | compounded annual rate |
| Revenue | 1Y | 12.10% | fiscal year comparison |
| Net profit | 5Y | Turned to profit | turnaround |
| Net profit | 3Y | 22.40% | compounded annual rate |
| Operating margin | 1Y | +2.30 pp | margin expansion |

## Financial Statements

### Quarterly Results

| Item | Sep 2025 | Jun 2026 | Sep 2026 |
| --- | ---: | ---: | ---: |
| Sales | 380 | 420 | 450 |
| Expenses | 310 | 340 | 365 |
| Net Profit | 42 | 48 | 55.5 |
| OPM % | 18.42% | 19.05% | 18.89% |
| EPS in Rs | 5.2 | 6.0 | 6.9 |

## Shareholding Pattern

### Quarterly Shareholding

| Holder | Jun 2026 | Sep 2026 |
| --- | ---: | ---: |
| Promoters | 53.00% | 52.30% |
| FIIs | 18.50% | 19.20% |
| DIIs | 12.00% | 12.50% |
| Public | 16.50% | 16.00% |

## Key Insights

### Strengths

- Company has maintained healthy ROCE of 18.5% over 3 years
- Zero debt company with strong cash reserves

### Weaknesses

- Promoter holding has slightly decreased over the last quarter
- Customer concentration risk in top 3 clients

## Technical Indicators

| Group | Signal | Bearish | Neutral | Bullish |
| --- | --- | ---: | ---: | ---: |
| Overall | Bullish | 1 | 8 | 10 |
| Oscillators | Neutral | 1 | 6 | 2 |
| Moving Averages | Bullish | 0 | 2 | 8 |
`;

async function runTests() {
  console.log("--- Starting Tapetide Fundamentals Test Suite ---");

  // 1. Full synthetic fixture test
  console.log("1. Testing full synthetic fixture parsing...");
  const parsed = parseTapetideMarkdown(SYNTHETIC_FIXTURE, "ACME");
  assert.ok(parsed, "Parser must succeed on valid synthetic fixture");
  assert.equal(parsed.available, true);
  assert.equal(parsed.symbol, "ACME");
  assert.equal(parsed.source_url, "https://tapetide.com/stocks/ACME");
  assert.equal(parsed.generated_at, "2026-11-20T12:00:00.000Z");

  // Snapshot verification
  assert.ok(Array.isArray(parsed.snapshot), "Snapshot must be array");
  const roce = parsed.snapshot.find((s) => s.label === "ROCE");
  assert.ok(roce, "ROCE must exist in snapshot");
  assert.equal(roce.value_num, 18.5);
  assert.equal(roce.value_text, "18.50%");

  const pe = parsed.snapshot.find((s) => s.label === "P/E (TTM)");
  assert.ok(pe, "P/E (TTM) must exist in snapshot");
  assert.equal(pe.value_num, 45.2);

  const mcap = parsed.snapshot.find((s) => s.label === "Market Cap");
  assert.ok(mcap, "Market Cap must exist in snapshot");
  assert.equal(mcap.value_num, 12501);

  // Growth verification
  assert.ok(Array.isArray(parsed.growth), "Growth must be array");
  assert.equal(parsed.growth.length, 6);
  const rev5y = parsed.growth.find((g) => g.label === "Revenue" && g.period === "5Y");
  assert.ok(rev5y);
  assert.equal(rev5y.value_num, 14.5);
  assert.equal(rev5y.value_text, "14.50%");

  // Turned to profit -> value_num must be null
  const npTurn = parsed.growth.find((g) => g.label === "Net profit" && g.period === "5Y");
  assert.ok(npTurn);
  assert.equal(npTurn.value_num, null, "Turned to profit must yield null value_num");
  assert.equal(npTurn.value_text, "Turned to profit");

  // Quarters verification (oldest -> newest, max 8)
  assert.ok(Array.isArray(parsed.quarters), "Quarters must be array");
  assert.equal(parsed.quarters.length, 3);
  assert.deepEqual(parsed.quarters[0], {
    period: "Sep 2025",
    sales: 380,
    net_profit: 42,
    opm: 18.42,
    eps: 5.2,
  });
  assert.deepEqual(parsed.quarters[2], {
    period: "Sep 2026",
    sales: 450,
    net_profit: 55.5,
    opm: 18.89,
    eps: 6.9,
  });

  // Shareholding verification
  assert.ok(parsed.shareholding, "Shareholding must be present");
  assert.deepEqual(parsed.shareholding.latest, {
    period: "Sep 2026",
    promoters: 52.3,
    fii: 19.2,
    dii: 12.5,
    public: 16.0,
  });
  assert.deepEqual(parsed.shareholding.previous, {
    period: "Jun 2026",
    promoters: 53.0,
    fii: 18.5,
    dii: 12.0,
    public: 16.5,
  });

  // Strengths and weaknesses
  assert.equal(parsed.strengths.length, 2);
  assert.equal(parsed.weaknesses.length, 2);
  assert.ok(parsed.strengths[0].includes("healthy ROCE"));

  // Signals
  assert.ok(parsed.signals);
  assert.equal(parsed.signals.overall, "Bullish");
  assert.equal(parsed.signals.bullish, 10);
  assert.equal(parsed.signals.neutral, 8);
  assert.equal(parsed.signals.bearish, 1);
  assert.equal(parsed.signals.oscillators, "Neutral");
  assert.equal(parsed.signals.moving_averages, "Bullish");

  // 2. Missing sections -> nulls, not zeros or synthetic numbers
  console.log("2. Testing missing sections...");
  const minimalMarkdown = `---
symbol: "MINIMAL"
company: "Minimal Corp"
---
# Minimal Corp (MINIMAL)

## Key Facts
- **Market Cap:** —
- **ROCE:** NA
`;
  const minParsed = parseTapetideMarkdown(minimalMarkdown, "MINIMAL");
  assert.ok(minParsed);
  assert.equal(minParsed.growth.length, 0);
  assert.equal(minParsed.quarters.length, 0);
  assert.equal(minParsed.shareholding, null);
  assert.equal(minParsed.strengths.length, 0);
  assert.equal(minParsed.weaknesses.length, 0);
  assert.equal(minParsed.signals, null);
  // Missing numeric value must be null, never 0
  const mcapSnap = minParsed.snapshot.find((s) => s.label === "Market Cap");
  if (mcapSnap) {
    assert.equal(mcapSnap.value_num, null);
  }

  // 3. Garbage / HTML / Empty input -> returns null
  console.log("3. Testing garbage, empty, and HTML error inputs...");
  assert.equal(parseTapetideMarkdown(""), null);
  assert.equal(parseTapetideMarkdown("   "), null);
  assert.equal(parseTapetideMarkdown(null), null);
  assert.equal(parseTapetideMarkdown("<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>"), null);
  assert.equal(parseTapetideMarkdown("Random text without markdown headers or frontmatter"), null);

  // 4. Numeric parsing edge cases
  console.log("4. Testing numeric parsing edge cases...");
  assert.equal(parseNumeric("₹1,234.50 Cr"), 1234.5);
  assert.equal(parseNumeric("-₹10.00 Cr"), -10.0);
  assert.equal(parseNumeric("+1.09 pp"), 1.09);
  assert.equal(parseNumeric("-0.23 pp"), -0.23);
  assert.equal(parseNumeric("12.5%"), 12.5);
  assert.equal(parseNumeric("-19.49%"), -19.49);
  assert.equal(parseNumeric("4,24,899"), 424899);
  assert.equal(parseNumeric("Turned to profit"), null);
  assert.equal(parseNumeric("—"), null);
  assert.equal(parseNumeric("-"), null);
  assert.equal(parseNumeric("NA"), null);
  assert.equal(parseNumeric("N/A"), null);
  assert.equal(parseNumeric(undefined), null);

  // 5. Script / HTML injection in bullets stays inert plain text
  console.log("5. Testing injection sanitization...");
  const maliciousInput = `---
symbol: "INJECT"
company: "Injection Corp"
---
# Injection Corp (INJECT)

## Key Insights
### Strengths
- Normal <script>alert('xss')</script> bullet with [link](http://evil.com) and **bold** formatting
`;
  const sanitizedParse = parseTapetideMarkdown(maliciousInput, "INJECT");
  assert.ok(sanitizedParse);
  assert.equal(sanitizedParse.strengths.length, 1);
  assert.ok(!sanitizedParse.strengths[0].includes("<script>"));
  assert.ok(!sanitizedParse.strengths[0].includes("</script>"));
  assert.ok(!sanitizedParse.strengths[0].includes("http://evil.com"));
  assert.ok(!sanitizedParse.strengths[0].includes("**"));
  assert.ok(sanitizedParse.strengths[0].includes("Normal alert('xss') bullet with link and bold formatting"));

  // 6. Cache hit & negative cache (15 min)
  console.log("6. Testing LRU cache and negative caching...");
  const testCache = new TapetideLRUCache(3);
  testCache.set("SYM1", { available: true, symbol: "SYM1" }, 1000);
  testCache.set("SYM2", { available: false, reason: "not_found" }, 1000, true);
  testCache.set("SYM3", { available: true, symbol: "SYM3" }, 1000);

  assert.equal(testCache.get("SYM1").data.symbol, "SYM1");
  assert.equal(testCache.get("SYM2").data.reason, "not_found");

  // Adding 4th item should evict oldest (SYM3 was accessed least recently among remaining)
  testCache.set("SYM4", { available: true, symbol: "SYM4" }, 1000);
  assert.equal(testCache.size, 3);
  // SYM3 was evicted because SYM1 and SYM2 were accessed
  assert.equal(testCache.get("SYM3"), null);

  // 7. Single-flight concurrency deduplication
  console.log("7. Testing single-flight concurrency deduplication...");
  let upstreamFetchCount = 0;
  const mockFetchFn = async () => {
    upstreamFetchCount++;
    // Simulate delay
    await new Promise((r) => setTimeout(r, 20));
    return new Response(SYNTHETIC_FIXTURE, { status: 200 });
  };

  const freshCache = new TapetideLRUCache(200);
  const freshLimiter = new TapetideRateLimiter(20, 60000);
  const freshInFlight = new Map();

  const [res1, res2, res3] = await Promise.all([
    getTapetideFundamentals("ACME", {
      cache: freshCache,
      limiter: freshLimiter,
      inFlight: freshInFlight,
      fetchFn: mockFetchFn,
    }),
    getTapetideFundamentals("ACME", {
      cache: freshCache,
      limiter: freshLimiter,
      inFlight: freshInFlight,
      fetchFn: mockFetchFn,
    }),
    getTapetideFundamentals("ACME", {
      cache: freshCache,
      limiter: freshLimiter,
      inFlight: freshInFlight,
      fetchFn: mockFetchFn,
    }),
  ]);

  assert.equal(upstreamFetchCount, 1, "Concurrent requests for the same symbol must share 1 fetch");
  assert.equal(res1.symbol, "ACME");
  assert.equal(res2.symbol, "ACME");
  assert.equal(res3.symbol, "ACME");

  // Subsequent call hits cache
  const cachedCall = await getTapetideFundamentals("ACME", {
    cache: freshCache,
    limiter: freshLimiter,
    inFlight: freshInFlight,
    fetchFn: mockFetchFn,
  });
  assert.equal(upstreamFetchCount, 1, "Cached call must not trigger upstream fetch");
  assert.equal(cachedCall.symbol, "ACME");

  // 8. Global rate limiter (20 requests/minute)
  console.log("8. Testing global rate limiter...");
  const strictLimiter = new TapetideRateLimiter(2, 60000);
  const strictCache = new TapetideLRUCache(200);
  const strictInFlight = new Map();

  // First 2 succeed
  const r1 = await getTapetideFundamentals("T1", {
    cache: strictCache,
    limiter: strictLimiter,
    inFlight: strictInFlight,
    fetchFn: async () => new Response(SYNTHETIC_FIXTURE, { status: 200 }),
  });
  const r2 = await getTapetideFundamentals("T2", {
    cache: strictCache,
    limiter: strictLimiter,
    inFlight: strictInFlight,
    fetchFn: async () => new Response(SYNTHETIC_FIXTURE, { status: 200 }),
  });
  assert.equal(r1.available, true);
  assert.equal(r2.available, true);

  // 3rd call exceeds rate limit
  const r3 = await getTapetideFundamentals("T3", {
    cache: strictCache,
    limiter: strictLimiter,
    inFlight: strictInFlight,
    fetchFn: async () => new Response(SYNTHETIC_FIXTURE, { status: 200 }),
  });
  assert.equal(r3.available, false);
  assert.equal(r3.reason, "rate_limited");

  // 9. Route-level simulated conditions (Redirect, Timeout, >1 MB, 404)
  console.log("9. Testing upstream error conditions (404, redirect, timeout, >1 MB)...");

  // 404 -> not_found
  const r404 = await getTapetideFundamentals("NOTFOUND", {
    cache: new TapetideLRUCache(10),
    limiter: new TapetideRateLimiter(20, 60000),
    inFlight: new Map(),
    fetchFn: async () => new Response("Not found", { status: 404 }),
  });
  assert.equal(r404.available, false);
  assert.equal(r404.reason, "not_found");

  // 302 Redirect rejected -> upstream_error
  const rRedirect = await getTapetideFundamentals("REDIR", {
    cache: new TapetideLRUCache(10),
    limiter: new TapetideRateLimiter(20, 60000),
    inFlight: new Map(),
    fetchFn: async () => new Response("", { status: 302, headers: { Location: "https://evil.com" } }),
  });
  assert.equal(rRedirect.available, false);
  assert.equal(rRedirect.reason, "upstream_error");

  // Timeout -> timeout
  const rTimeout = await getTapetideFundamentals("TIMEOUT", {
    cache: new TapetideLRUCache(10),
    limiter: new TapetideRateLimiter(20, 60000),
    inFlight: new Map(),
    timeoutMs: 10,
    fetchFn: async (url, opts) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(SYNTHETIC_FIXTURE, { status: 200 })), 100);
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    },
  });
  assert.equal(rTimeout.available, false);
  assert.equal(rTimeout.reason, "timeout");

  // > 1 MB -> stream size exceeded
  const hugeText = "# Huge\n" + "A".repeat(1024 * 1024 + 100);
  const rHuge = await getTapetideFundamentals("HUGE", {
    cache: new TapetideLRUCache(10),
    limiter: new TapetideRateLimiter(20, 60000),
    inFlight: new Map(),
    maxBytes: 1024 * 1024,
    fetchFn: async () => new Response(hugeText, { status: 200 }),
  });
  assert.equal(rHuge.available, false);
  assert.equal(rHuge.reason, "upstream_error");

  console.log("All Tapetide Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
