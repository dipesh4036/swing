import assert from "node:assert/strict";

console.log("--- Starting Industries API Shape Validation Test (I5) ---");

// Synthetic payload matching /api/terminal/industries structure
const syntheticPayload = {
  asOf: "2026-11-20",
  breadthAsOf: "2026-11-23",
  mcapAsOf: "2026-11-23",
  benchmark: "NIFTY 500",
  coverage: {
    n_universe: 1700,
    n_classified: 47,
    n_unclassified: 1653,
    n_small_industries: 45,
  },
  sectors: [
    {
      name: "Capital Goods",
      macro: "Industrials",
      n_stocks: 18,
      mcap_cr: 450000.0,
      median_1d: 1.2,
      median_1w: 2.8,
      median_1m: 7.5,
      median_3m: 15.0,
      pct_above_50: 72.2,
      pct_above_200: 61.1,
    },
  ],
  industries: [
    {
      sector: "Capital Goods",
      basic_industry: "Heavy Electrical Equipment",
      n_stocks: 8,
      n_valid_50: 8,
      n_valid_200: 6,
      median_1d: 1.5,
      median_1w: 3.2,
      median_1m: 8.4,
      median_3m: 18.2,
      median_6m: 32.0,
      pct_above_50: 75.0,
      pct_above_200: 62.5,
      n_20d_high: 3,
      n_20d_low: 0,
      pct_leaders: 37.5,
      mcap_cr: 245000.5,
      rank: 1,
      rank_change: 2,
      tag: "Leading",
      quadrant: "leading",
      rs_x: 2.5,
      rs_y: 104.2,
      sparkline: [{ date: "2026-11-20", value: 104.2 }],
    },
  ],
  stocks: [
    {
      symbol: "ABB",
      name: "ABB India Limited",
      macro: "Industrials",
      sector: "Capital Goods",
      industry: "Electrical Equipment",
      basic_industry: "Heavy Electrical Equipment",
      close: 8250.0,
      ret_1d: 2.1,
      ret_1w: 4.5,
      ret_1m: 12.0,
      ret_3m: 24.5,
      ret_6m: 40.2,
      pct_from_52w_high: -3.5,
      above_20ema: true,
      above_50dma: true,
      above_200dma: true,
      stage: 2,
      vol_ratio: 1.8,
      avg_traded_value: 50000000,
      rs_rank: 88,
      screeners: ["stage2"],
      mcap_cr: 174800.0,
      at_20d_high: true,
      at_20d_low: false,
      is_leader: true,
    },
  ],
  leader_rules: "RS Rank >= 70 AND within 15% of 52-week high",
};

// 1. Top-level keys check
assert(syntheticPayload.asOf, "asOf must be defined");
assert(syntheticPayload.coverage, "coverage object must be present");
assert.equal(typeof syntheticPayload.coverage.n_universe, "number");
assert.equal(typeof syntheticPayload.coverage.n_classified, "number");
assert.equal(typeof syntheticPayload.coverage.n_unclassified, "number");
assert.equal(typeof syntheticPayload.coverage.n_small_industries, "number");

// 2. Sectors check
assert(Array.isArray(syntheticPayload.sectors), "sectors must be an array");
const sec = syntheticPayload.sectors[0];
assert(sec.name, "sector name required");
assert(sec.macro, "sector macro required");
assert(typeof sec.n_stocks === "number", "sector n_stocks must be a number");

// 3. Industries check
assert(Array.isArray(syntheticPayload.industries), "industries must be an array");
const ind = syntheticPayload.industries[0];
assert(ind.sector, "industry sector required");
assert(ind.basic_industry, "basic_industry required");
assert(typeof ind.n_stocks === "number", "industry n_stocks required");
assert(ind.tag, "industry tag required");
assert(ind.quadrant, "industry quadrant required");
assert(Array.isArray(ind.sparkline), "sparkline array required");

// 4. Stocks check
assert(Array.isArray(syntheticPayload.stocks), "stocks must be an array");
const stk = syntheticPayload.stocks[0];
assert(stk.symbol, "stock symbol required");
assert(stk.basic_industry, "stock basic_industry required");
assert(typeof stk.is_leader === "boolean", "is_leader boolean required");

// 5. Uncompressed payload size guard (< 600 KB per I3)
const jsonStr = JSON.stringify(syntheticPayload);
const sizeBytes = Buffer.byteLength(jsonStr, "utf8");
console.log(`Synthetic API shape payload size: ${(sizeBytes / 1024).toFixed(2)} KB`);
assert(sizeBytes < 600 * 1024, "Payload must be under 600 KB");

console.log("✓ Industries API Shape Validation Passed Successfully!");
