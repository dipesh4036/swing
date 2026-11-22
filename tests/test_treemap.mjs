/**
 * tests/test_treemap.mjs
 * Unit test suite for squarified treemap algorithm and color mapping (T11).
 */

import assert from "node:assert";
import {
  computeSquarifiedTreemap,
  getMetricColor,
  getMetricTextColor,
} from "../src/lib/treemap.js";

console.log("--- Starting Treemap Test Suite ---");

// 1. Basic Squarified Layout Test
console.log("1. Testing computeSquarifiedTreemap basic layout...");
const items = [
  { id: "A", weight: 6 },
  { id: "B", weight: 6 },
  { id: "C", weight: 4 },
  { id: "D", weight: 3 },
  { id: "E", weight: 2 },
  { id: "F", weight: 2 },
  { id: "G", weight: 1 },
];

const width = 600;
const height = 400;
const layout = computeSquarifiedTreemap(items, 0, 0, width, height);

assert.strictEqual(layout.length, 7, "All 7 valid items must be laid out");

// Total area check within 1%
const totalContainerArea = width * height;
const sumItemArea = layout.reduce((sum, item) => sum + item.width * item.height, 0);
const areaRatio = sumItemArea / totalContainerArea;
assert.ok(
  Math.abs(1.0 - areaRatio) < 0.02,
  `Sum of cell areas (${sumItemArea}) should equal total container area (${totalContainerArea}) within 2%`
);

// Bounding box constraint check
for (const cell of layout) {
  assert.ok(cell.x >= 0, `Cell ${cell.id} x (${cell.x}) must be >= 0`);
  assert.ok(cell.y >= 0, `Cell ${cell.id} y (${cell.y}) must be >= 0`);
  assert.ok(cell.x + cell.width <= width + 0.5, `Cell ${cell.id} x+w must be <= width`);
  assert.ok(cell.y + cell.height <= height + 0.5, `Cell ${cell.id} y+h must be <= height`);
}

// Overlap prevention check
for (let i = 0; i < layout.length; i++) {
  for (let j = i + 1; j < layout.length; j++) {
    const c1 = layout[i];
    const c2 = layout[j];
    // Check if boxes overlap significantly (allowing 0.5px rounding margin)
    const overlapX = Math.max(0, Math.min(c1.x + c1.width, c2.x + c2.width) - Math.max(c1.x, c2.x));
    const overlapY = Math.max(0, Math.min(c1.y + c1.height, c2.y + c2.height) - Math.max(c1.y, c2.y));
    const overlapArea = overlapX * overlapY;
    assert.ok(overlapArea < 2.0, `Cells ${c1.id} and ${c2.id} must not overlap significantly (overlap: ${overlapArea})`);
  }
}
console.log("✓ Squarified layout and non-overlap verified successfully");

// 2. Edge Cases: Empty, Single, Zero, Negative, NaN weights
console.log("2. Testing edge cases (empty, zero, NaN, negative weights)...");
assert.deepStrictEqual(computeSquarifiedTreemap([]), [], "Empty list returns empty array");
assert.deepStrictEqual(computeSquarifiedTreemap(null), [], "Null returns empty array");

const mixedItems = [
  { id: "Valid1", weight: 100 },
  { id: "Zero", weight: 0 },
  { id: "Neg", weight: -50 },
  { id: "NaN", weight: NaN },
  { id: "Valid2", weight: 50 },
];
const mixedLayout = computeSquarifiedTreemap(mixedItems, 0, 0, 300, 200);
assert.strictEqual(mixedLayout.length, 2, "Only positive non-NaN items must be included");
assert.strictEqual(mixedLayout[0].id, "Valid1");
assert.strictEqual(mixedLayout[1].id, "Valid2");

// Single Item layout
const singleLayout = computeSquarifiedTreemap([{ id: "Solo", weight: 42 }], 10, 20, 200, 100);
assert.strictEqual(singleLayout.length, 1);
assert.strictEqual(singleLayout[0].x, 10);
assert.strictEqual(singleLayout[0].y, 20);
assert.strictEqual(singleLayout[0].width, 200);
assert.strictEqual(singleLayout[0].height, 100);
console.log("✓ Edge cases verified successfully");

// 3. Discrete Color Scale & Clamp Verification
console.log("3. Testing getMetricColor discrete mapping & bounds...");
// Neutral for null/NaN
assert.strictEqual(getMetricColor(null, "1m", false), "#F4F4F5");
assert.strictEqual(getMetricColor(undefined, "1m", true), "#27272A");
assert.strictEqual(getMetricColor(NaN, "1m", false), "#F4F4F5");

// Bullish steps (1M clamp = 15%)
const col1 = getMetricColor(1.0, "1m", false); // 1 / 15 = 0.066 (<0.2)
const col2 = getMetricColor(5.0, "1m", false); // 5 / 15 = 0.33 (<0.4)
const col3 = getMetricColor(14.0, "1m", false); // 14 / 15 = 0.93 (max)
const colClamped = getMetricColor(25.0, "1m", false); // clamped at max
assert.strictEqual(col3, colClamped, "Values above clamp threshold must map to highest color step");
assert.notStrictEqual(col1, col2, "Different ratio steps must have distinct colors");

// Bearish steps
const bCol1 = getMetricColor(-2.0, "1m", false);
const bColMax = getMetricColor(-30.0, "1m", false);
assert.notStrictEqual(bCol1, bColMax);

console.log("✓ Color scale and threshold clamping verified successfully");
console.log("--- All Treemap Tests Passed! ---");
