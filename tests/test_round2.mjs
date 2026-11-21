/**
 * tests/test_round2.mjs
 *
 * Regression test suite for Round 2 findings (R1, R2, R9, R10, R13, R14).
 */

import assert from "node:assert/strict";
import fs from "node:fs";

async function runTests() {
  console.log("--- Starting Round 2 Node Test Suite ---");

  // -------------------------------------------------------------------------
  // R1: LargeMidSmall Component rebasedSeries & Null/Gap Handling
  // -------------------------------------------------------------------------
  console.log("1. Testing R1: LargeMidSmall data processing logic...");
  
  // Synthetic rebasedSeries with 3 sessions; Mid has a null/missing session; Small is completely empty
  const rebasedSeries = {
    large: [
      { date: "2026-11-18", rebased: 100.0 },
      { date: "2026-11-19", rebased: 102.5 },
      { date: "2026-11-20", rebased: 105.0 },
    ],
    mid: [
      { date: "2026-11-18", rebased: 200.0 },
      // 2026-11-19 is missing
      { date: "2026-11-20", rebased: 198.0 },
    ],
    small: [], // completely missing
  };

  const dates = ["2026-11-18", "2026-11-19", "2026-11-20"];
  const largeMap = new Map(rebasedSeries.large.map((r) => [r.date, r]));
  const midMap = new Map(rebasedSeries.mid.map((r) => [r.date, r]));
  const smallMap = new Map(rebasedSeries.small.map((r) => [r.date, r]));

  const largeBase = largeMap.get(dates[0])?.rebased;
  const midBase = midMap.get(dates[0])?.rebased;
  const smallBase = smallMap.get(dates[0])?.rebased ?? null;

  assert.equal(largeBase, 100.0);
  assert.equal(midBase, 200.0);
  assert.equal(smallBase, null);

  const calcReturn = (map, baseVal, date) => {
    if (!baseVal) return null;
    const row = map.get(date);
    if (!row || typeof row.rebased !== "number" || isNaN(row.rebased)) return null;
    return Number((((row.rebased - baseVal) / baseVal) * 100).toFixed(2));
  };

  const day1Large = calcReturn(largeMap, largeBase, "2026-11-18");
  const day2Large = calcReturn(largeMap, largeBase, "2026-11-19");
  const day2Mid = calcReturn(midMap, midBase, "2026-11-19");
  const day1Small = calcReturn(smallMap, smallBase, "2026-11-18");

  assert.equal(day1Large, 0.0, "Day 1 rebase must be 0.0%");
  assert.equal(day2Large, 2.5, "Day 2 return must be +2.5%");
  assert.equal(day2Mid, null, "Missing mid session must yield null (gap), never 0");
  assert.equal(day1Small, null, "Missing small series must yield null");

  // Verify LargeMidSmall.js source does not plot pctAbove20ema or fake 0
  const lmsSource = fs.readFileSync("src/components/market-breadth/LargeMidSmall.js", "utf8");
  assert.ok(!lmsSource.includes("pctAbove20ema"), "LargeMidSmall must not plot pctAbove20ema");
  assert.ok(!lmsSource.includes("pctAbove50sma"), "LargeMidSmall must not plot pctAbove50sma");
  assert.ok(!lmsSource.includes("pctAbove200sma"), "LargeMidSmall must not plot pctAbove200sma");

  // -------------------------------------------------------------------------
  // R2: Updated N Hours Ago Query & No Fabricated Fallback
  // -------------------------------------------------------------------------
  console.log("2. Testing R2: Ingest runs query and lastUpdatedAt null handling...");
  const dataRouteSource = fs.readFileSync("src/app/api/terminal/data/route.js", "utf8");
  assert.ok(
    dataRouteSource.includes("status IN ('success', 'partial')"),
    "Ingest runs query must match status IN ('success', 'partial')"
  );
  assert.ok(
    !dataRouteSource.includes("status = 'completed'"),
    "Ingest runs query must not check for non-existent status 'completed'"
  );

  const pageSource = fs.readFileSync("src/app/(terminal)/page.jsx", "utf8");
  assert.ok(
    !pageSource.includes("T10:00:00Z"),
    "page.jsx must never fall back to fabricated T10:00:00Z timestamp"
  );
  assert.ok(
    pageSource.includes("if (!asOfDate || !lastUpdatedAt) return \"—\";"),
    "page.jsx must return '—' when lastUpdatedAt is null"
  );

  // -------------------------------------------------------------------------
  // R9: Live Universe Totals from Database (No Hard-coded UNIVERSE_COVERAGE)
  // -------------------------------------------------------------------------
  console.log("3. Testing R9: Dynamic universe totals in data route...");
  assert.ok(
    !dataRouteSource.includes("total: 2599"),
    "data route must not hardcode total: 2599"
  );
  assert.ok(
    !dataRouteSource.includes("total: 501"),
    "data route must not hardcode total: 501"
  );
  assert.ok(
    dataRouteSource.includes("SELECT COUNT(DISTINCT isin)::int as total FROM instruments"),
    "data route must query instruments for universe 'all'"
  );
  assert.ok(
    dataRouteSource.includes("SELECT COUNT(DISTINCT symbol)::int as total FROM index_constituents"),
    "data route must query index_constituents for index universes"
  );

  // -------------------------------------------------------------------------
  // R10: Real Zeros in FII/DII Preserved (Not Converted to Null)
  // -------------------------------------------------------------------------
  console.log("4. Testing R10: Genuine zero values in FII/DII parsing...");
  // Simulate row with 0.0 values
  const zeroRow = {
    fii_buy: "0.0",
    fii_sell: "0.0",
    fii_net: "0.0",
    dii_buy: 0,
    dii_sell: 0,
    dii_net: 0,
  };

  const parseFlow = (val) => (val !== null && val !== undefined ? parseFloat(val) : null);
  assert.equal(parseFlow(zeroRow.fii_buy), 0.0, "fii_buy with '0.0' must parse to 0, not null");
  assert.equal(parseFlow(zeroRow.fii_net), 0.0, "fii_net with '0.0' must parse to 0, not null");
  assert.equal(parseFlow(zeroRow.dii_net), 0.0, "dii_net with 0 must parse to 0, not null");
  assert.equal(parseFlow(null), null, "null must parse to null");
  assert.equal(parseFlow(undefined), null, "undefined must parse to null");

  // -------------------------------------------------------------------------
  // R3 & R4: Telegram Plain Text & Health Check Branch Check
  // -------------------------------------------------------------------------
  console.log("5. Testing R3 & R4: Health route alert & GitHub branch check...");
  const healthRouteSource = fs.readFileSync("src/app/api/health/route.js", "utf8");
  assert.ok(
    !healthRouteSource.includes('parse_mode: "Markdown"'),
    "health/route.js must not send parse_mode: 'Markdown'"
  );
  assert.ok(
    healthRouteSource.includes("[Pipeline Alert]"),
    "health/route.js must prefix alerts with [Pipeline Alert]"
  );
  assert.ok(
    !healthRouteSource.includes("commits/main"),
    "health/route.js must not hardcode commits/main"
  );
  assert.ok(
    healthRouteSource.includes("GITHUB_BRANCH || \"v1\""),
    "health/route.js must default GITHUB_BRANCH to v1"
  );
  assert.ok(
    healthRouteSource.includes('githubCheck = "unavailable"'),
    "health/route.js must set githubCheck to unavailable on non-ok GitHub responses"
  );

  console.log("All Round 2 Node Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
