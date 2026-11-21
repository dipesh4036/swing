import assert from "node:assert/strict";
import {
  SECTORS,
  SECTOR_KEYS,
  computeSessionReturn,
  computeStandardReturns,
  computeAlignedRS,
  computeQuadrant,
  computeRSSeries,
} from "../src/lib/sector-math.js";

console.log("--- Starting Sector Math Test Suite ---");

// 1. SECTORS definitions
console.log("1. Testing SECTORS taxonomy...");
assert.equal(SECTORS.length, 12, "Must contain exactly 12 active canonical sectors");
assert.equal(SECTOR_KEYS.length, 12);
assert.ok(SECTOR_KEYS.includes("bank"));
assert.ok(SECTOR_KEYS.includes("it"));
assert.ok(SECTOR_KEYS.includes("healthcare"));
assert.ok(SECTOR_KEYS.includes("consumer_durables"));
assert.ok(SECTOR_KEYS.includes("oil_gas"));
console.log("✓ Sector taxonomy verified");

// 2. computeSessionReturn
console.log("2. Testing computeSessionReturn...");
assert.equal(computeSessionReturn(null, 5), null);
assert.equal(computeSessionReturn([], 5), null);
assert.equal(computeSessionReturn([{ trade_date: "2026-01-01", close: 100 }], 5), null);

// 6 sessions -> valid 5-session return
const sixCandles = [
  { trade_date: "2026-01-01", close: 100 },
  { trade_date: "2026-01-02", close: 102 },
  { trade_date: "2026-01-03", close: 104 },
  { trade_date: "2026-01-04", close: 106 },
  { trade_date: "2026-01-05", close: 108 },
  { trade_date: "2026-01-06", close: 110 },
];
const ret5 = computeSessionReturn(sixCandles, 5);
assert.equal(ret5, 10.0, "5-session return from 100 to 110 should be 10.0%");
console.log("✓ Session return calculation verified");

// 3. computeAlignedRS
console.log("3. Testing computeAlignedRS...");
const sectorCandles = [
  { trade_date: "2026-01-01", close: 200 },
  { trade_date: "2026-01-02", close: 210 },
  { trade_date: "2026-01-04", close: 220 }, // 01-03 missing in sector
];
const benchCandles = [
  { trade_date: "2026-01-01", close: 100 },
  { trade_date: "2026-01-03", close: 105 }, // 01-03 only in bench
  { trade_date: "2026-01-04", close: 110 },
];
const aligned = computeAlignedRS(sectorCandles, benchCandles);
assert.equal(aligned.length, 2, "Only dates present in both (01-01, 01-04) must be included");
assert.equal(aligned[0].trade_date, "2026-01-01");
assert.equal(aligned[0].rs, 2.0); // 200 / 100
assert.equal(aligned[1].trade_date, "2026-01-04");
assert.equal(aligned[1].rs, 2.0); // 220 / 110
console.log("✓ Date alignment and RS ratio verified");

// 4. computeQuadrant
console.log("4. Testing computeQuadrant...");
// < 60 sessions -> null
const shortRS = Array.from({ length: 59 }, (_, i) => ({
  trade_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  rs: 1.0,
}));
assert.deepEqual(computeQuadrant(shortRS), { quadrant: null, x: null, y: null });

// Synthesize 70 sessions for testing quadrant regimes
// Case A: Leading (RS rising, above 50 SMA and above 10 sessions ago)
const leadingRS = Array.from({ length: 70 }, (_, i) => ({
  trade_date: `d-${i}`,
  rs: 1.0 + i * 0.01, // steadily increasing
}));
const qLeading = computeQuadrant(leadingRS);
assert.equal(qLeading.quadrant, "leading");
assert.ok(qLeading.x > 0);
assert.ok(qLeading.y > 0);

// Case B: Lagging (RS falling, below 50 SMA and below 10 sessions ago)
const laggingRS = Array.from({ length: 70 }, (_, i) => ({
  trade_date: `d-${i}`,
  rs: 2.0 - i * 0.01, // steadily decreasing
}));
const qLagging = computeQuadrant(laggingRS);
assert.equal(qLagging.quadrant, "lagging");
assert.ok(qLagging.x < 0);
assert.ok(qLagging.y < 0);
console.log("✓ Quadrant classifications verified (leading, lagging, boundary guard <60)");

// 5. computeRSSeries
console.log("5. Testing computeRSSeries...");
const testSeries = [
  { trade_date: "2026-01-01", rs: 2.0 },
  { trade_date: "2026-01-02", rs: 2.2 },
  { trade_date: "2026-01-03", rs: 2.5 },
];
const rebased = computeRSSeries(testSeries, 120);
assert.equal(rebased.length, 3);
assert.equal(rebased[0].time, "2026-01-01");
assert.equal(rebased[0].value, 100.0, "Base session must be 100.0");
assert.equal(rebased[1].value, 110.0, "2.2 / 2.0 * 100 = 110.0");
assert.equal(rebased[2].value, 125.0, "2.5 / 2.0 * 100 = 125.0");
console.log("✓ Rebased RS series rebased cleanly to 100.0");

console.log("--- All Sector Math Tests Passed Successfully! ---");
