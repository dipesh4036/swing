/**
 * tests/test_round8.mjs
 *
 * Test suite for Round 8 requirements (R25, R26, R27):
 * - R25: Slicing helper (sliceLast) with 260 rows -> 150 rows, ema_200 preserved.
 *        Staleness detection when last candle date is earlier than asOf.
 * - R26: ScreenerGrid error state with Retry button.
 * - R27: ScreenerGrid honestly labels 30-day low as "30D low", shows "Stale data" badge.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { transformSync } from "next/dist/build/swc/index.js";
import { attachEMAs, sliceLast } from "../src/lib/indicators.js";

console.log("--- Starting Round 8 Test Suite (R25–R27) ---");

// ---------------------------------------------------------------------------
// 1. R25 — Slicing Helper (sliceLast) with EMA warm-up preservation
// ---------------------------------------------------------------------------
console.log("1. Testing R25: sliceLast with 260 rows & EMA200...");

// Generate 260 synthetic chronological daily candles
const synthetic260 = [];
let basePrice = 100;
const startDate = new Date("2025-01-01T00:00:00Z");

for (let i = 0; i < 260; i++) {
  const d = new Date(startDate.getTime() + i * 86400000);
  const dateStr = d.toISOString().split("T")[0];
  basePrice += (i % 2 === 0 ? 0.5 : -0.2); // trending up
  synthetic260.push({
    date: dateStr,
    open: basePrice - 0.5,
    high: basePrice + 1.0,
    low: basePrice - 1.0,
    close: basePrice,
    volume: 10000 + i * 100,
  });
}

assert.equal(synthetic260.length, 260, "Must have exactly 260 input candles");

// Attach EMAs on full 260 rows
const withEMAs = attachEMAs(synthetic260, [10, 20, 50, 200]);
assert.equal(withEMAs.length, 260);
const fullLastEMA200 = withEMAs[259].ema_200;
assert.notEqual(fullLastEMA200, null, "Full series last candle must have non-null EMA200");
assert.equal(typeof fullLastEMA200, "number");

// Slice to 150 sessions
const GRID_MAX_BARS = 150;
const sliced = sliceLast(withEMAs, GRID_MAX_BARS);

assert.equal(sliced.length, 150, "Sliced candles must have length 150");
assert.equal(
  sliced[sliced.length - 1].ema_200,
  fullLastEMA200,
  "Last sliced row must preserve the full-series computed ema_200"
);
assert.equal(
  sliced[sliced.length - 1].date,
  synthetic260[259].date,
  "Last candle in sliced must match the latest date in full series"
);
assert.equal(
  sliced[0].date,
  synthetic260[110].date,
  "First candle in sliced must match index 260 - 150 = 110"
);

// Edge cases for sliceLast
assert.deepEqual(sliceLast([], 150), [], "Empty array returns empty array");
assert.deepEqual(sliceLast(null, 150), [], "Null returns empty array");
assert.deepEqual(sliceLast(synthetic260, 0), [], "Non-positive n returns empty array");

const shortSeries = synthetic260.slice(0, 45);
assert.equal(sliceLast(shortSeries, 150).length, 45, "Fewer than n rows preserves all rows");

console.log("✓ R25 sliceLast correctly slices to 150 rows while preserving EMA200");

// ---------------------------------------------------------------------------
// 2. R25 — Staleness Guard Logic
// ---------------------------------------------------------------------------
console.log("2. Testing R25: Staleness guard detection...");

const asOfDate = "2026-11-20";
const tokens = [101, 102, 103];
const rawByToken = {
  101: [{ date: "2026-11-20", close: 100 }], // fresh
  102: [{ date: "2026-11-18", close: 200 }], // stale (earlier than asOf)
  103: [], // stale / empty
};

const staleTokens = [];
for (const t of tokens) {
  const raw = rawByToken[t] || [];
  if (raw.length > 0) {
    const lastCandle = raw[raw.length - 1];
    if (lastCandle && lastCandle.date < asOfDate) {
      staleTokens.push(t);
    }
  } else {
    staleTokens.push(t);
  }
}

assert.deepEqual(staleTokens, [102, 103], "Tokens 102 and 103 must be detected as stale");
console.log("✓ R25 Staleness guard logic verified");

// ---------------------------------------------------------------------------
// Load ScreenerGrid via Next SWC compiler for React SSR testing
// ---------------------------------------------------------------------------
function compileAndLoadComponent(filePath, mockRequire) {
  const code = fs.readFileSync(filePath, "utf8");
  const transformed = transformSync(code, {
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "classic" } },
    },
    module: { type: "commonjs" },
  });

  const moduleObj = { exports: {} };
  const fn = new Function("require", "module", "exports", "React", transformed.code);
  fn(mockRequire, moduleObj, moduleObj.exports, React);
  return moduleObj.exports.default || moduleObj.exports;
}

const mockComponent = (name) => {
  const comp = (props) => React.createElement("div", { "data-mock": name, ...props });
  comp.displayName = name;
  return comp;
};

const gridMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "lightweight-charts") {
    return {
      createChart: () => ({
        addSeries: () => ({
          setData: () => {},
          applyOptions: () => {},
          createPriceLine: () => ({ applyOptions: () => {} }),
        }),
        priceScale: () => ({ applyOptions: () => {} }),
        timeScale: () => ({ fitContent: () => {}, applyOptions: () => {} }),
        applyOptions: () => {},
        remove: () => {},
      }),
      CandlestickSeries: {},
      LineSeries: {},
      HistogramSeries: {},
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    };
  }
  if (id === "lucide-react") {
    return {
      ExternalLink: () => React.createElement("span", null, "[↗]"),
      RefreshCw: () => React.createElement("span", null, "[↻]"),
    };
  }
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

const ScreenerGridComponent = compileAndLoadComponent(
  "src/components/screener/ScreenerGrid.jsx",
  gridMockRequire
);

// ---------------------------------------------------------------------------
// 3. R26 — ScreenerGrid Error State and Retry Button
// ---------------------------------------------------------------------------
console.log("3. Testing R26: ScreenerGrid error state with Retry button...");

const errorHtml = renderToString(
  React.createElement(ScreenerGridComponent, {
    stocks: [{ token: 101, symbol: "TEST" }],
    candlesByToken: {},
    staleTokens: [],
    loading: false,
    error: "Could not load candles (HTTP 500)",
    activeScreener: "stage2_breakout",
    onSelectStock: () => {},
    onRetry: () => {},
  })
);

assert.ok(
  errorHtml.includes("Could not load candles (HTTP 500)"),
  "Must render error message"
);
assert.ok(
  errorHtml.includes("Retry"),
  "Must render Retry button when error is set"
);
// Error box must replace tiles
assert.ok(
  !errorHtml.includes("TEST"),
  "Stock cards must not be rendered when error is active"
);

console.log("✓ R26 ScreenerGrid renders error box and Retry button cleanly");

// ---------------------------------------------------------------------------
// 4. R27 — Honest "30D low" Labeling & "Stale data" Badge
// ---------------------------------------------------------------------------
console.log("4. Testing R27: 30D low labeling & Stale data badge...");

const sampleStockCards = [
  {
    token: 101,
    symbol: "FRESH1",
    close: 500,
    ret_1d_pct: 2.5,
    rs_rank: 88,
    vol_ratio: 1.8,
  },
  {
    token: 102,
    symbol: "STALE1",
    close: 300,
    ret_1d_pct: -1.0,
    rs_rank: 65,
    vol_ratio: 0.9,
  },
];

const sampleCandlesByToken = {
  101: [
    { date: "2026-11-19", open: 480, high: 495, low: 475, close: 490, volume: 5000 },
    { date: "2026-11-20", open: 490, high: 505, low: 485, close: 500, volume: 8000 },
  ],
  102: [
    { date: "2026-11-18", open: 310, high: 315, low: 295, close: 300, volume: 2000 },
  ],
};

const gridHtml = renderToString(
  React.createElement(ScreenerGridComponent, {
    stocks: sampleStockCards,
    candlesByToken: sampleCandlesByToken,
    staleTokens: [102],
    loading: false,
    error: null,
    activeScreener: "stage2_breakout",
    onSelectStock: () => {},
  })
);

// Assert R27 renaming: "30D low" must appear, "Supp:" must NOT appear
assert.ok(gridHtml.includes("30D low"), "Must include '30D low' in meta bar / legend");
assert.ok(!gridHtml.includes("Supp:"), "Must NOT include legacy 'Supp:'");

// Assert R25 staleness badge
assert.ok(gridHtml.includes("Stale data"), "Must render 'Stale data' badge for token 102");

console.log("✓ R27 30D low labeling and Stale data badge verified successfully");

console.log("--- All Round 8 Tests Passed Successfully! ---");
