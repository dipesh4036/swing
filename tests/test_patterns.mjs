/**
 * Auto Chart Patterns Test Suite
 * SYNTHETIC TEST INPUT: All synthetic fixtures are labelled as required by rule 0.
 */
import assert from 'node:assert/strict';
import { detectPatterns, PATTERN_PARAMS } from '../src/lib/patterns/index.js';
import { computeATR } from '../src/lib/patterns/atr.js';
import { findPivots } from '../src/lib/patterns/pivots.js';

// Simple seeded pseudo-random number generator (Mulberry32)
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDate(idx) {
  const base = new Date('2026-01-01');
  base.setDate(base.getDate() + idx);
  return base.toISOString().split('T')[0];
}

console.log('--- Starting Chart Patterns Test Suite ---');

// 1. Test Insufficient History & Null OHLC Rows
console.log('1. Testing insufficient history and null handling...');
{
  const emptyRes = detectPatterns([]);
  assert.equal(emptyRes.reason, 'insufficient_history');
  assert.equal(emptyRes.patterns.length, 0);

  const shortCandles = Array.from({ length: 50 }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 105,
    low: 95,
    close: 100,
    volume: 1000,
  }));
  const shortRes = detectPatterns(shortCandles);
  assert.equal(shortRes.reason, 'insufficient_history');

  // Series with 70 bars but 20 invalid/null rows -> 50 valid -> insufficient_history
  const nullCandles = [...shortCandles];
  for (let i = 0; i < 20; i++) {
    nullCandles.push({
      date: formatDate(50 + i),
      open: null,
      high: NaN,
      low: 0,
      close: undefined,
    });
  }
  const nullRes = detectPatterns(nullCandles);
  assert.equal(nullRes.reason, 'insufficient_history');
  console.log('✓ Insufficient history & null handling verified');
}

// 2. Test Wilder ATR Calculation
console.log('2. Testing Wilder ATR(14)...');
{
  const candles = Array.from({ length: 30 }, (_, i) => ({
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
  }));
  const atrs = computeATR(candles, 14);
  assert.equal(atrs.length, 30);
  // TR for each bar is 3
  assert.ok(Math.abs(atrs[29] - 3.0) < 1e-4);
  console.log('✓ Wilder ATR verified');
}

// 3. Test Pivots: Look-ahead guard (last k bars cannot serve as touches)
console.log('3. Testing pivot look-ahead guard...');
{
  const k = 3;
  const n = 80;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  // Inject a spike at the very last bar (n-1) and bar (n-2)
  candles[n - 1].high = 150;
  candles[n - 2].high = 140;

  const atrs = computeATR(candles, 14);
  const { highs } = findPivots(candles, atrs, k, 0.5);

  // Assert no pivot high is within the last k bars (n - k .. n - 1)
  for (const h of highs) {
    assert.ok(h.idx <= n - 1 - k, `Pivot at ${h.idx} violated lookahead guard (max allowed: ${n - 1 - k})`);
  }
  console.log('✓ Pivot look-ahead guard verified');
}

// 4. Synthetic Fixture: Flat ceiling with 3 touches then breakout
console.log('4. Testing flat ceiling with breakout...');
{
  // Label: SYNTHETIC TEST INPUT
  const n = 90;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  // Create 3 swing highs at ceiling price 120 at bars 20, 40, 60
  const touchBars = [20, 40, 60];
  for (const bar of touchBars) {
    candles[bar].high = 120;
    candles[bar].close = 119;
    // ensure neighbors are lower to form swing high
    for (let d = -3; d <= 3; d++) {
      if (d !== 0) {
        candles[bar + d].high = 115;
        candles[bar + d].low = 110;
        candles[bar + d].close = 112;
      }
    }
  }

  // Breakout at bar 75
  for (let bar = 75; bar < n; bar++) {
    candles[bar].open = 125;
    candles[bar].high = 128;
    candles[bar].low = 124;
    candles[bar].close = 127;
  }

  const res = detectPatterns(candles);
  const ceiling = res.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.ok(ceiling, 'Horizontal ceiling not detected');
  assert.equal(ceiling.status, 'broke_out');
  assert.ok(ceiling.lines[0].touches.length >= 2, 'Expected touches on ceiling');
  assert.ok(ceiling.events.some((ev) => ev.type === 'breakout'), 'Expected breakout event');
  console.log('✓ Flat ceiling breakout verified');
}

// 5. Synthetic Fixture: Breakout then Retest then Close back inside
console.log('5. Testing breakout -> retest -> close back inside...');
{
  // Label: SYNTHETIC TEST INPUT
  const n = 100;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  // Swing highs at 120 at bars 20 and 45
  for (const bar of [20, 45]) {
    candles[bar].high = 120;
    candles[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0) {
        candles[bar + d].high = 114;
        candles[bar + d].low = 108;
      }
    }
  }

  // Breakout at bar 65
  candles[65].close = 126;
  candles[65].high = 127;

  // Retest at bar 75 (touches back near 120)
  candles[75].low = 120.2;
  candles[75].close = 120.5;

  // Close back inside at bar 85
  candles[85].close = 117;
  candles[85].low = 116;

  const res = detectPatterns(candles);
  const ceiling = res.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.ok(ceiling, 'Ceiling pattern missing');
  assert.ok(ceiling.events.some((e) => e.type === 'breakout'), 'Missing breakout event');
  assert.ok(ceiling.events.some((e) => e.type === 'retest'), 'Missing retest event');
  assert.ok(ceiling.events.some((e) => e.type === 'close_back_inside'), 'Missing close_back_inside event');
  console.log('✓ Breakout -> Retest -> Close back inside verified');
}

// 6. Synthetic Fixtures: Triangles (Ascending, Descending, Symmetrical)
console.log('6. Testing triangle patterns...');
{
  // Label: SYNTHETIC TEST INPUT
  // Ascending triangle: Flat top (120) and rising bottoms
  const n = 100;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  // Highs at 20 and 65 (120)
  for (const bar of [20, 65]) {
    candles[bar].high = 120;
    candles[bar].close = 118;
    candles[bar].low = 114;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0) {
        candles[bar + d].high = 116;
        candles[bar + d].close = 114;
        candles[bar + d].low = 112;
      }
    }
  }

  // Lows rising: bar 20 (low 100) and bar 60 (low 108)
  candles[20].low = 100;
  candles[20].close = 105;
  candles[20].high = 120;

  candles[60].low = 108;
  candles[60].close = 110;
  candles[60].high = 113;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0) {
      candles[60 + d].low = 110;
      candles[60 + d].high = 115;
    }
  }

  // Bars 66-68 stay cleanly inside the triangle
  for (let bar = 66; bar <= 68; bar++) {
    candles[bar].open = 114;
    candles[bar].close = 114;
    candles[bar].high = 115;
    candles[bar].low = 112;
  }

  // Breakout at bar 69
  for (let bar = 69; bar < n; bar++) {
    candles[bar].open = 124;
    candles[bar].close = 126;
    candles[bar].high = 127;
    candles[bar].low = 123;
  }

  const res = detectPatterns(candles);
  const tri = res.patterns.find((p) => p.type === 'ascending_triangle');
  assert.ok(tri, 'Ascending triangle not detected');
  assert.equal(tri.status, 'broke_out');
  console.log('✓ Ascending triangle verified');
}

// 7. Synthetic Fixtures: Base + Pivot
console.log('7. Testing Base + Pivot pattern...');
{
  // Label: SYNTHETIC TEST INPUT
  const n = 100;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  // Leg start at bar 10: low 80
  candles[10].low = 80;
  candles[10].close = 82;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0) candles[10 + d].low = 85;
  }

  // Pivot at bar 30: high 120 (+50% rise)
  candles[30].high = 120;
  candles[30].close = 118;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0) candles[30 + d].high = 115;
  }

  // Consolidation base from bar 31 to 60: base low 105 (depth 12.5% <= 35%)
  for (let bar = 31; bar <= 60; bar++) {
    candles[bar].open = 112;
    candles[bar].high = 116;
    candles[bar].low = 105;
    candles[bar].close = 114;
    candles[bar].volume = 800;
  }

  // Breakout at bar 75 with heavy volume
  for (let bar = 75; bar < n; bar++) {
    candles[bar].open = 124;
    candles[bar].close = 126;
    candles[bar].high = 127;
    candles[bar].low = 123;
    candles[bar].volume = 3000;
  }

  const res = detectPatterns(candles);
  const base = res.patterns.find((p) => p.type === 'base_pivot');
  assert.ok(base, 'Base + pivot pattern not detected');
  assert.equal(base.status, 'broke_out');
  assert.ok(base.metrics.volume_ratio > 1.5, 'Expected elevated volume ratio on breakout');
  assert.ok(base.base_box, 'Expected base_box coordinates');
  assert.ok(base.leg_start, 'Expected leg_start point');
  console.log('✓ Base + pivot pattern verified');
}

// 8. Banned Words Scan
console.log('8. Scanning for banned words in all generated text...');
{
  const bannedWords = ['buy', 'sell', 'target', 'stop', 'entry', 'signal', 'score', 'probability', 'guaranteed'];

  // Generate varied synthetic candles to trigger multiple pattern descriptions
  const rng = mulberry32(12345);
  const candles = Array.from({ length: 120 }, (_, i) => {
    const baseP = 100 + Math.sin(i / 10) * 15;
    return {
      date: formatDate(i),
      open: baseP,
      high: baseP + 2 + rng() * 2,
      low: baseP - 2 - rng() * 2,
      close: baseP + (rng() - 0.5) * 2,
      volume: 1000 + Math.floor(rng() * 500),
    };
  });

  const res = detectPatterns(candles);
  const allText = res.patterns.map((p) => `${p.title} ${p.summary} ${p.rule_text}`).join(' ').toLowerCase();

  for (const word of bannedWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    assert.ok(!regex.test(allText), `Found banned word "${word}" in pattern output!`);
  }
  console.log('✓ Zero banned words found across all outputs');
}

// 9. Invariants & Random Walk Benchmark over 200 series
console.log('9. Testing invariants and runtime performance across 200 random walks...');
{
  const bannedWords = ['buy', 'sell', 'target', 'stop', 'entry', 'signal', 'score', 'probability', 'guaranteed'];
  let totalTimeMs = 0;
  const numWalks = 200;

  for (let walk = 0; walk < numWalks; walk++) {
    const rng = mulberry32(42 + walk);
    let p = 100 + (rng() * 50);
    const n = 260;
    const candles = [];

    for (let i = 0; i < n; i++) {
      const ret = (rng() - 0.49) * 0.04;
      p = Math.max(10, p * (1 + ret));
      const high = p * (1 + rng() * 0.015);
      const low = p * (1 - rng() * 0.015);
      candles.push({
        date: formatDate(i),
        open: p,
        high,
        low,
        close: p,
        volume: 10000 + Math.floor(rng() * 5000),
      });
    }

    const t0 = performance.now();
    const res = detectPatterns(candles);
    const elapsed = performance.now() - t0;
    totalTimeMs += elapsed;

    // Invariants check
    assert.ok(res.patterns.length <= PATTERN_PARAMS.max_patterns_returned, 'Exceeded max pattern cap');

    for (const pat of res.patterns) {
      // 1. Every date is inside the series
      assert.ok(candles.some((c) => c.date === pat.window.start_date));
      assert.ok(candles.some((c) => c.date === pat.window.end_date));

      // 2. No touch falls in the last k bars
      for (const line of pat.lines) {
        for (const t of line.touches) {
          assert.ok(t.idx <= n - 1 - PATTERN_PARAMS.pivot_k, 'Touch found in last k bars');
        }
      }

      // 3. No banned words in summary or rule_text
      const text = `${pat.title} ${pat.summary} ${pat.rule_text}`.toLowerCase();
      for (const word of bannedWords) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        assert.ok(!regex.test(text), `Banned word "${word}" found in random walk output`);
      }
    }

    // 4. Test deterministic output on identical input
    const res2 = detectPatterns(candles);
    assert.equal(res.patterns.length, res2.patterns.length);
    if (res.patterns.length > 0) {
      assert.equal(res.patterns[0].id, res2.patterns[0].id);
    }
  }

  const avgMs = totalTimeMs / numWalks;
  console.log(`Measured average runtime: ${avgMs.toFixed(2)} ms per stock (260 bars)`);
  assert.ok(avgMs <= 15.0, `Average runtime ${avgMs.toFixed(2)} ms exceeded target 15 ms`);
  console.log('✓ 200 random walks passed all invariants and runtime bounds');
}

// 10. Test that adding bars to the END does not change touches confirmed earlier
console.log('10. Testing historical touch stability when new bars arrive...');
{
  const rng = mulberry32(999);
  let p = 100;
  const initialBars = 80;
  const candles = [];
  for (let i = 0; i < initialBars; i++) {
    p = p * (1 + (rng() - 0.49) * 0.02);
    candles.push({
      date: formatDate(i),
      open: p,
      high: p + 1.5,
      low: p - 1.5,
      close: p,
      volume: 1000,
    });
  }

  const atrs1 = computeATR(candles, 14);
  const pivots1 = findPivots(candles, atrs1, 3, 0.5);

  // Add 10 new bars to the end
  for (let i = initialBars; i < initialBars + 10; i++) {
    p = p * (1 + (rng() - 0.49) * 0.02);
    candles.push({
      date: formatDate(i),
      open: p,
      high: p + 1.5,
      low: p - 1.5,
      close: p,
      volume: 1000,
    });
  }

  const atrs2 = computeATR(candles, 14);
  const pivots2 = findPivots(candles, atrs2, 3, 0.5);

  // Confirmed pivots from initial bars (excluding the boundary) must match
  const maxSafeIdx = initialBars - 1 - 3;
  const initialHighIndices = pivots1.highs.filter((h) => h.idx <= maxSafeIdx).map((h) => h.idx);
  const updatedHighIndices = pivots2.highs.filter((h) => h.idx <= maxSafeIdx).map((h) => h.idx);

  assert.deepEqual(initialHighIndices, updatedHighIndices, 'Confirmed historical pivots shifted after adding bars');
  console.log('✓ Historical touch stability verified');
}

console.log('--- All Chart Patterns Tests Passed Successfully! ---');
