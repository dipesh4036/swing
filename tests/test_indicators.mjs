/**
 * tests/test_indicators.mjs
 *
 * Unit tests for src/lib/indicators.js:
 * 1. computeEMA: SMA-seeded, multiplier k = 2/(p+1), exact match
 * 2. attachEMAs: attaches ema_10, ema_20, ema_50, ema_200
 * 3. aggregateWeekly: aggregates daily candles to Monday-start weekly candles
 */

import assert from "node:assert/strict";
import { computeEMA, attachEMAs, aggregateWeekly } from "../src/lib/indicators.js";

function runTests() {
  console.log("--- Starting Indicators Test Suite ---");

  // 1. computeEMA: Basic calculation verification
  console.log("1. Testing computeEMA calculation...");
  // 5 candles with prices [10, 11, 12, 13, 14] and period 3
  // Index 0: null
  // Index 1: null
  // Index 2: SMA = (10 + 11 + 12) / 3 = 11.0
  // Index 3: k = 2 / (3 + 1) = 0.5; EMA = (13 - 11.0) * 0.5 + 11.0 = 12.0
  // Index 4: EMA = (14 - 12.0) * 0.5 + 12.0 = 13.0
  const testCandles = [
    { close: 10 },
    { close: 11 },
    { close: 12 },
    { close: 13 },
    { close: 14 },
  ];
  const ema3 = computeEMA(testCandles, 3);
  assert.equal(ema3.length, 5);
  assert.equal(ema3[0], null);
  assert.equal(ema3[1], null);
  assert.equal(ema3[2], 11.0);
  assert.equal(ema3[3], 12.0);
  assert.equal(ema3[4], 13.0);

  // Insufficient candles
  const shortEma = computeEMA(testCandles.slice(0, 2), 3);
  assert.deepEqual(shortEma, [null, null]);

  // 2. attachEMAs
  console.log("2. Testing attachEMAs...");
  // 20 candles
  const candles20 = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    close: 100 + i,
  }));
  const attached = attachEMAs(candles20, [10, 20]);
  assert.equal(attached.length, 20);
  assert.equal(attached[8].ema_10, null);
  assert.ok(attached[9].ema_10 !== null, "ema_10 should be present at index 9");
  assert.equal(attached[18].ema_20, null);
  assert.ok(attached[19].ema_20 !== null, "ema_20 should be present at index 19");

  // 3. aggregateWeekly
  console.log("3. Testing aggregateWeekly...");
  // Mon 2026-01-05 through Fri 2026-01-09 (1 week)
  // Mon 2026-01-12 through Wed 2026-01-14 (second week)
  const daily = [
    { date: "2026-01-05", open: 100, high: 105, low: 98, close: 104, volume: 1000 }, // Mon
    { date: "2026-01-06", open: 104, high: 108, low: 102, close: 107, volume: 1500 }, // Tue
    { date: "2026-01-07", open: 107, high: 110, low: 106, close: 109, volume: 2000 }, // Wed
    { date: "2026-01-08", open: 109, high: 109, low: 101, close: 103, volume: 800 },  // Thu
    { date: "2026-01-09", open: 103, high: 106, low: 100, close: 105, volume: 1200 }, // Fri
    { date: "2026-01-12", open: 105, high: 115, low: 104, close: 112, volume: 3000 }, // Mon next week
    { date: "2026-01-13", open: 112, high: 114, low: 110, close: 111, volume: 2500 }, // Tue
    { date: "2026-01-14", open: 111, high: 118, low: 109, close: 117, volume: 4000 }, // Wed
  ];

  const weekly = aggregateWeekly(daily);
  assert.equal(weekly.length, 2, "Should aggregate into exactly 2 weekly candles");

  // Week 1 check
  assert.equal(weekly[0].date, "2026-01-09", "Week 1 date should be last session date");
  assert.equal(weekly[0].open, 100, "Week 1 open should be first session open");
  assert.equal(weekly[0].high, 110, "Week 1 high should be max high of week");
  assert.equal(weekly[0].low, 98, "Week 1 low should be min low of week");
  assert.equal(weekly[0].close, 105, "Week 1 close should be last session close");
  assert.equal(weekly[0].volume, 6500, "Week 1 volume should be sum of week volumes");

  // Week 2 check
  assert.equal(weekly[1].date, "2026-01-14", "Week 2 date should be Wednesday");
  assert.equal(weekly[1].open, 105);
  assert.equal(weekly[1].high, 118);
  assert.equal(weekly[1].low, 104);
  assert.equal(weekly[1].close, 117);
  assert.equal(weekly[1].volume, 9500);

  console.log("--- All Indicators Tests Passed Successfully! ---");
}

runTests();

