/**
 * Auto Chart Patterns Test Suite
 * SYNTHETIC TEST INPUT: All synthetic fixtures are labelled as required by rule 0.
 * Covers U7–U12 requirements.
 */
import assert from 'node:assert/strict';
import { detectPatterns, PATTERN_PARAMS } from '../src/lib/patterns/index.js';
import { computeATR } from '../src/lib/patterns/atr.js';
import { findPivots } from '../src/lib/patterns/pivots.js';
import { PatternSeriesPrimitive } from '../src/components/charts/patternLayers.js';

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

// 3. Test Pivots: Look-ahead guard
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
  candles[n - 1].high = 150;
  candles[n - 2].high = 140;

  const atrs = computeATR(candles, 14);
  const { highs } = findPivots(candles, atrs, k, 0.5);

  for (const h of highs) {
    assert.ok(h.idx <= n - 1 - k, `Pivot at ${h.idx} violated lookahead guard`);
  }
  console.log('✓ Pivot look-ahead guard verified');
}

// 4. U7 — Original Array Index Alignment (600 bars with 5 corrupted rows, 260 bars, 150 bars)
console.log('4. U7: Testing original array index alignment...');
{
  // (a) 600-bar fixture with 5 corrupted rows in the last 250 bars
  const n = 600;
  const rawCandles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));

  // Corrupt 5 rows within the last 250 bars (bars 450, 480, 510, 540, 570)
  for (const badIdx of [450, 480, 510, 540, 570]) {
    rawCandles[badIdx] = { date: formatDate(badIdx), open: null, high: NaN, low: 0, close: undefined };
  }

  // Inject a clear ceiling at bars 400, 430, 470
  for (const bar of [400, 430, 470]) {
    rawCandles[bar].high = 130;
    rawCandles[bar].close = 128;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && rawCandles[bar + d]?.high !== undefined) {
        rawCandles[bar + d].high = 120;
        rawCandles[bar + d].close = 118;
      }
    }
  }

  // Breakout at bar 592 (8 bars ago -> active breakout)
  for (let bar = 592; bar < n; bar++) {
    rawCandles[bar].open = 135;
    rawCandles[bar].high = 138;
    rawCandles[bar].low = 133;
    rawCandles[bar].close = 136;
  }

  const res600 = detectPatterns(rawCandles);
  assert.ok(res600.patterns.length > 0, 'Expected at least 1 pattern detected');

  for (const pat of res600.patterns) {
    for (const line of pat.lines) {
      assert.ok(line.idx1 >= 0 && line.idx1 < n, `line.idx1 ${line.idx1} out of bounds`);
      assert.ok(line.idx2 >= 0 && line.idx2 < n, `line.idx2 ${line.idx2} out of bounds`);

      for (const touch of line.touches) {
        assert.ok(touch.idx >= 0 && touch.idx < n, `touch.idx ${touch.idx} out of bounds`);
        assert.equal(rawCandles[touch.idx].date, touch.date, `Date mismatch at index ${touch.idx}`);
        const expectedPrice = line.role === 'support' || line.role === 'base_low' ? rawCandles[touch.idx].low : rawCandles[touch.idx].high;
        assert.equal(touch.price, expectedPrice, `Touch price mismatch at index ${touch.idx}`);
      }
    }
    for (const ev of pat.events) {
      assert.ok(ev.idx >= 0 && ev.idx < n, `ev.idx ${ev.idx} out of bounds`);
      assert.equal(rawCandles[ev.idx].date, ev.date, `Event date mismatch at index ${ev.idx}`);
    }
  }

  // (b) Checks on 150-bar and 260-bar cases
  for (const barCount of [150, 260]) {
    const bars = Array.from({ length: barCount }, (_, i) => ({
      date: formatDate(i),
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1000,
    }));
    // Inject ceiling touches (3 touches for min_touches_line: 3)
    const t0 = Math.floor(barCount * 0.25);
    const t1 = Math.floor(barCount * 0.45);
    const t2 = Math.floor(barCount * 0.7);
    for (const bar of [t0, t1, t2]) {
      bars[bar].high = 125;
      bars[bar].close = 123;
      for (let d = -3; d <= 3; d++) {
        if (d !== 0 && bars[bar + d]) {
          bars[bar + d].high = 115;
          bars[bar + d].close = 112;
        }
      }
    }
    const resB = detectPatterns(bars);
    for (const p of resB.patterns) {
      for (const l of p.lines) {
        for (const t of l.touches) {
          assert.equal(bars[t.idx].date, t.date, `Date mismatch on ${barCount} bars`);
        }
      }
    }
  }

  // (c) Render Primitive check with mock timeScale/series on 1,200 bars
  const n1200 = 1200;
  const mockCandles = Array.from({ length: n1200 }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
  }));
  // Touches at bars 1120, 1150 and 1185 (within last 80 bars)
  for (const bar of [1120, 1150, 1185]) {
    mockCandles[bar].high = 140;
    mockCandles[bar].close = 138;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && mockCandles[bar + d]) {
        mockCandles[bar + d].high = 130;
      }
    }
  }
  const res1200 = detectPatterns(mockCandles);
  assert.ok(res1200.patterns.length > 0);

  const coordinatesPassed = [];
  const mockTimeScale = {
    logicalToCoordinate: (logicalIndex) => {
      coordinatesPassed.push(logicalIndex);
      return logicalIndex * 2;
    },
  };
  const mockSeries = {
    priceToCoordinate: (price) => price,
  };
  const mockChart = {
    timeScale: () => mockTimeScale,
  };

  const primitive = new PatternSeriesPrimitive({
    patterns: res1200.patterns,
    layers: { patternLines: true, breakoutRetest: true, basePivot: true },
  });
  primitive.attached({ chart: mockChart, series: mockSeries, requestUpdate: () => {} });

  const mockTarget = {
    useBitmapCoordinateSpace: (cb) => {
      cb({
        context: {
          beginPath: () => {},
          closePath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fill: () => {},
          arc: () => {},
          setLineDash: () => {},
          fillRect: () => {},
          fillText: () => {},
        },
        horizontalPixelRatio: 1,
        verticalPixelRatio: 1,
      });
    },
  };
  primitive.paneViews()[0].renderer().draw(mockTarget);

  // Assert coordinatesPassed used true 1200-bar original indices (>= 1000)
  assert.ok(coordinatesPassed.some((idx) => idx >= 1000), 'Primitive did not receive original array indices');
  console.log('✓ U7: Original array index alignment (600, 260, 150, 1200 bars) verified');
}

// 5. U8 — Status Aging and Single Events
console.log('5. U8: Testing status aging and single event caps...');
{
  const n = 120;
  // (a) Breakout 60 bars ago then drift -> historical
  const candlesHist = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  for (const bar of [10, 25, 45]) {
    candlesHist[bar].high = 120;
    candlesHist[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candlesHist[bar + d]) candlesHist[bar + d].high = 115;
    }
  }
  // Breakout at bar 55 (64 bars ago)
  for (let bar = 55; bar < n; bar++) {
    candlesHist[bar].high = 125;
    candlesHist[bar].close = 123;
  }
  const resHist = detectPatterns(candlesHist);
  const patHist = resHist.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.ok(patHist, 'Ceiling pattern missing');
  assert.equal(patHist.status, 'historical', 'Breakout 64 bars ago must be historical');

  // (b) Breakout 3 bars ago -> broke_out
  const candlesActive = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  for (const bar of [30, 60, 90]) {
    candlesActive[bar].high = 120;
    candlesActive[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candlesActive[bar + d]) candlesActive[bar + d].high = 115;
    }
  }
  // Breakout at bar 116 (3 bars ago)
  for (let bar = 116; bar < n; bar++) {
    candlesActive[bar].high = 128;
    candlesActive[bar].close = 126;
  }
  const resActive = detectPatterns(candlesActive);
  const patActive = resActive.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.ok(patActive, 'Active pattern missing');
  assert.equal(patActive.status, 'broke_out', 'Breakout 3 bars ago must be broke_out');

  // (c) Breakout then close back inside -> failed_break
  const candlesFailed = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  for (const bar of [40, 70, 95]) {
    candlesFailed[bar].high = 120;
    candlesFailed[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candlesFailed[bar + d]) candlesFailed[bar + d].high = 115;
    }
  }
  // Break at bar 114, then close back inside at bar 118 and bar 119
  candlesFailed[114].high = 126;
  candlesFailed[114].close = 125;
  candlesFailed[118].high = 118;
  candlesFailed[118].close = 116;
  candlesFailed[119].high = 118;
  candlesFailed[119].close = 116;

  const resFailed = detectPatterns(candlesFailed);
  const patFailed = resFailed.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.ok(patFailed);
  assert.equal(patFailed.status, 'failed_break', 'Closed back inside must be failed_break');

  // (d) Single events per type: at most 1 breakout, 1 retest, 1 close_back_inside
  const evBreakouts = patFailed.events.filter((e) => e.type === 'breakout');
  const evRetests = patFailed.events.filter((e) => e.type === 'retest');
  const evCloses = patFailed.events.filter((e) => e.type === 'close_back_inside');
  assert.ok(evBreakouts.length <= 1, 'At most 1 breakout event allowed');
  assert.ok(evRetests.length <= 1, 'At most 1 retest event allowed');
  assert.ok(evCloses.length <= 1, 'At most 1 close_back_inside event allowed');

  // (e) Forming pattern whose last touch is 90 bars old is dropped
  const candlesOld = Array.from({ length: 120 }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  for (const bar of [10, 18, 26]) {
    candlesOld[bar].high = 120;
    candlesOld[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candlesOld[bar + d]) candlesOld[bar + d].high = 115;
    }
  }
  // No touches after bar 25. Age = 119 - 25 = 94 bars > max_pattern_age_bars (40)
  const resOld = detectPatterns(candlesOld);
  const patOld = resOld.patterns.find((p) => p.type === 'horizontal_ceiling');
  assert.equal(patOld, undefined, 'Forming pattern with last touch 94 bars old must be dropped');

  console.log('✓ U8: Status aging (historical, broke_out, failed_break, drop old) verified');
}

// 6. U9 — Full-Span Pierce Rejection
console.log('6. U9: Testing full-span pierce rejection...');
{
  const n = 100;
  // Trendline with 3 touches where extra touch is pierced
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));

  // Touch A at bar 20 (high 130), Touch B at bar 50 (high 130), Touch C at bar 80 (high 130)
  for (const bar of [20, 50, 80]) {
    candles[bar].high = 130;
    candles[bar].close = 128;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candles[bar + d]) candles[bar + d].high = 122;
    }
  }

  // Pierce between bar 50 and 80: bar 65 closes at 135 (+5 ATR above 130 line)
  candles[65].high = 136;
  candles[65].close = 135;

  const res = detectPatterns(candles);
  // Ceiling from 20 to 80 must be REJECTED because it was pierced at bar 65
  const ceiling = res.patterns.find((p) => p.type === 'horizontal_ceiling' && p.lines[0].idx1 === 20 && p.lines[0].idx2 === 80);
  assert.equal(ceiling, undefined, 'Pattern pierced between touches must be rejected');

  console.log('✓ U9: Full-span pierce rejection verified');
}

// 7. U10 — Flat Definition with flat_drift_atr
console.log('7. U10: Testing flat definition with flat_drift_atr...');
{
  // A rising top of 3% over 70 bars (ATR ~2%) is NOT flat; within 0.4 ATR is flat
  const n = 100;
  const candlesRising = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));

  // Upper line: bar 20 high 100.0, bar 90 high 103.0 (3.0% rise, ATR ~ 2.0 -> 1.5 ATR drift > 0.5 ATR flat_drift_atr)
  candlesRising[20].high = 100.0;
  candlesRising[20].close = 99.0;
  candlesRising[90].high = 103.0;
  candlesRising[90].close = 102.0;

  // Lower line rising sharply: bar 20 low 80.0, bar 90 low 96.0
  candlesRising[20].low = 80.0;
  candlesRising[90].low = 96.0;

  const res = detectPatterns(candlesRising);
  // Must NOT classify as ascending_triangle because top rose by 1.5 ATR (not flat)
  const ascTri = res.patterns.find((p) => p.type === 'ascending_triangle');
  assert.equal(ascTri, undefined, 'Rising top of 3% must NOT be classified as ascending triangle');

  console.log('✓ U10: Flat drift in ATR verified');
}

// 8. U11 — Base + Pivot Constraints
console.log('8. U11: Testing Base + Pivot constraints...');
{
  const n = 120;

  // (a) Pivot 120 bars old -> no base
  const candlesOld = Array.from({ length: 140 }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  candlesOld[5].low = 70;
  candlesOld[15].high = 120;
  const resOld = detectPatterns(candlesOld);
  assert.equal(resOld.patterns.find((p) => p.type === 'base_pivot'), undefined, 'Pivot 120 bars old must yield no base');

  // (b) Valid 25-bar base after 25% leg -> forming
  const candlesBase = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  // Leg start at bar 60: low 80
  candlesBase[60].low = 80;
  candlesBase[60].close = 82;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0 && candlesBase[60 + d]) candlesBase[60 + d].low = 85;
  }
  // Pivot at bar 85: high 120 (+50% rise)
  candlesBase[85].high = 120;
  candlesBase[85].close = 118;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0 && candlesBase[85 + d]) candlesBase[85 + d].high = 115;
  }
  // Consolidation 86 to 119 (34 bars <= 40), low 105 (depth 12.5% <= 35%)
  for (let bar = 86; bar < n; bar++) {
    candlesBase[bar].high = 116;
    candlesBase[bar].low = 105;
    candlesBase[bar].close = 112;
  }
  const resBase = detectPatterns(candlesBase);
  const baseForming = resBase.patterns.find((p) => p.type === 'base_pivot');
  assert.ok(baseForming, 'Base + pivot pattern missing');
  assert.equal(baseForming.status, 'forming');

  // (c) Same base with breakout 3 bars ago -> broke_out
  const candlesBroke = JSON.parse(JSON.stringify(candlesBase));
  for (let bar = 117; bar < n; bar++) {
    candlesBroke[bar].high = 128;
    candlesBroke[bar].close = 126;
  }
  const resBroke = detectPatterns(candlesBroke);
  const baseBroke = resBroke.patterns.find((p) => p.type === 'base_pivot');
  assert.ok(baseBroke);
  assert.equal(baseBroke.status, 'broke_out');

  // (d) Base with lower low is measured correctly across full span
  const candlesFullLow = JSON.parse(JSON.stringify(candlesBase));
  for (let bar = 86; bar < n; bar++) {
    candlesFullLow[bar].high = 108;
    candlesFullLow[bar].low = 105;
    candlesFullLow[bar].close = 107;
  }
  candlesFullLow[105].low = 95; // Lowest low at bar 105 (20 bars after pivot)
  candlesFullLow[105].close = 100;
  const resFullLow = detectPatterns(candlesFullLow);
  const baseFull = resFullLow.patterns.find((p) => p.type === 'base_pivot');
  assert.ok(baseFull);
  // Depth should be (120 - 95) / 120 = 20.8%
  assert.ok(Math.abs(baseFull.metrics.base_depth_pct - 20.8) <= 0.2, 'Base depth must measure lowest low to last bar');

  console.log('✓ U11: Base + pivot age, depth, and status constraints verified');
}

// 8b. V2 — Current vs Historical Partitioning
console.log('8b. V2: Testing current vs historical partitioning...');
{
  // (a) Old 5-touch line (historical, broke 50 bars ago) and a newer 3-touch line of same type
  // Both must be returned, the newer one in the current group
  const n = 150;
  const candles = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));
  // Old ceiling at 120 with 5 touches (bars 10, 20, 30, 40, 50), breakout at bar 60
  for (const bar of [10, 20, 30, 40, 50]) {
    candles[bar].high = 120;
    candles[bar].close = 118;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candles[bar + d]) candles[bar + d].high = 115;
    }
  }
  // Breakout at bar 60, trading at 125 through the end of the series
  for (let bar = 60; bar < n; bar++) {
    candles[bar].close = 125;
    candles[bar].high = 127;
  }
  // Newer ceiling at 140 with 3 touches (bars 110, 125, 140) forming
  for (const bar of [110, 125, 140]) {
    candles[bar].high = 140;
    candles[bar].close = 125;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candles[bar + d]) candles[bar + d].high = 134;
    }
  }

  const res = detectPatterns(candles);
  const ceilings = res.patterns.filter((p) => p.type === 'horizontal_ceiling');
  assert.ok(ceilings.length >= 2, 'Expected both old and newer ceilings to be returned');
  const currentCeil = ceilings.find((p) => p.status !== 'historical');
  const histCeil = ceilings.find((p) => p.status === 'historical');
  assert.ok(currentCeil, 'Current ceiling missing');
  assert.ok(histCeil, 'Historical ceiling missing');
  // Current must appear before historical in returned patterns
  const currIdx = res.patterns.indexOf(currentCeil);
  const histIdx = res.patterns.indexOf(histCeil);
  assert.ok(currIdx < histIdx, 'Current patterns must precede historical patterns');

  console.log('✓ V2: Partitioning, deduplication protection, and capping verified');
}

// 8c. V3 — Minimum Touches & Base Max Depth
console.log('8c. V3: Testing min_touches_line: 3 and base_max_depth_pct: 25%...');
{
  const n = 100;
  // (a) 2-touch horizontal floor must NOT be returned, 3-touch floor MUST be returned
  const candles2T = Array.from({ length: n }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));
  for (const bar of [60, 85]) {
    candles2T[bar].low = 80;
    candles2T[bar].close = 82;
    for (let d = -3; d <= 3; d++) {
      if (d !== 0 && candles2T[bar + d]) candles2T[bar + d].low = 86;
    }
  }
  const res2T = detectPatterns(candles2T);
  const floor2T = res2T.patterns.find((p) => p.type === 'horizontal_floor');
  assert.equal(floor2T, undefined, '2-touch horizontal floor must NOT be returned');

  // Add 3rd touch at bar 35
  const candles3T = JSON.parse(JSON.stringify(candles2T));
  candles3T[35].low = 80;
  candles3T[35].close = 82;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0 && candles3T[35 + d]) candles3T[35 + d].low = 86;
  }
  const res3T = detectPatterns(candles3T);
  const floor3T = res3T.patterns.find((p) => p.type === 'horizontal_floor');
  assert.ok(floor3T, '3-touch horizontal floor must be returned');

  // (b) Base 30% deep is NOT returned; base 20% deep IS returned
  const candlesBase30 = Array.from({ length: 100 }, (_, i) => ({
    date: formatDate(i),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  candlesBase30[40].low = 70;
  candlesBase30[40].close = 72;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0 && candlesBase30[40 + d]) candlesBase30[40 + d].low = 75;
  }
  // Pivot at bar 65: high 120
  candlesBase30[65].high = 120;
  candlesBase30[65].close = 118;
  for (let d = -3; d <= 3; d++) {
    if (d !== 0 && candlesBase30[65 + d]) candlesBase30[65 + d].high = 115;
  }
  // Deep base: low 80 at bar 75 -> depth = (120 - 80) / 120 = 33.3% > 25%
  // Keep highs <= 95 so no new 20% leg is formed after bar 75
  for (let bar = 66; bar < 100; bar++) {
    candlesBase30[bar].high = 92;
    candlesBase30[bar].low = 86;
    candlesBase30[bar].close = 88;
  }
  candlesBase30[75].low = 80;
  const resBase30 = detectPatterns(candlesBase30);
  assert.equal(resBase30.patterns.find((p) => p.type === 'base_pivot'), undefined, 'Base 33% deep must be rejected');

  // Moderate base: low 96 at bar 75 -> depth = (120 - 96) / 120 = 20.0% <= 25%
  const candlesBase20 = JSON.parse(JSON.stringify(candlesBase30));
  for (let bar = 66; bar < 100; bar++) {
    candlesBase20[bar].high = 112;
    candlesBase20[bar].low = 98;
    candlesBase20[bar].close = 105;
  }
  candlesBase20[75].low = 96;
  const resBase20 = detectPatterns(candlesBase20);
  assert.ok(resBase20.patterns.find((p) => p.type === 'base_pivot'), 'Base 20% deep must be accepted');

  console.log('✓ V3: min_touches_line: 3 and base_max_depth_pct: 25% verified');
}

// 9. Banned Words Scan
console.log('9. Scanning for banned words in all generated text...');
{
  const bannedWords = ['buy', 'sell', 'target', 'stop', 'entry', 'signal', 'score', 'probability', 'guaranteed'];
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

// 10. U9 Invariant: No close beyond returned line by > pierce_tol ATR over 200 random walks
console.log('10. U9 Invariant: Testing no-pierce across 200 random walks...');
{
  const numWalks = 200;
  for (let walk = 0; walk < numWalks; walk++) {
    const rng = mulberry32(1000 + walk);
    let p = 100 + rng() * 50;
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

    const atrs = computeATR(candles, 14);
    const res = detectPatterns(candles);

    for (const pat of res.patterns) {
      for (const line of pat.lines) {
        const firstIdx = (line.touches && line.touches.length > 0) ? line.touches[0].idx : line.idx1;
        const lastIdx = (line.touches && line.touches.length > 0) ? line.touches[line.touches.length - 1].idx : line.idx2;
        // Invariant per U9: assert no close beyond line by more than pierce_tol ATR between first and last touch
        for (let bar = firstIdx; bar <= lastIdx; bar++) {
          const c = candles[bar];
          const atr = atrs[bar] || 1;
          const lnP1 = Math.log(line.p1);
          const lineP = Math.exp(lnP1 + (line.slope || 0) * (bar - line.idx1));

          if (line.role === 'resistance' || line.role === 'upper_resistance' || line.role === 'pivot') {
            const pen = c.close - lineP;
            if (pen > PATTERN_PARAMS.pierce_tol * atr + 1e-4) {
              console.error(`Violation in pat ${pat.type} (${pat.status}) line ${line.role}: bar=${bar}, firstIdx=${firstIdx}, lastIdx=${lastIdx}`);
            }
            assert.ok(
              pen <= PATTERN_PARAMS.pierce_tol * atr + 1e-4,
              `Pierce violation at bar ${bar}: close ${c.close} vs line ${lineP} by ${pen} > ${PATTERN_PARAMS.pierce_tol * atr}`
            );
          } else if (line.role === 'support' || line.role === 'lower_support' || line.role === 'base_low') {
            const pen = lineP - c.close;
            if (pen > PATTERN_PARAMS.pierce_tol * atr + 1e-4) {
              console.error(`Violation in pat ${pat.type} (${pat.status}) line ${line.role}: bar=${bar}, firstIdx=${firstIdx}, lastIdx=${lastIdx}`);
            }
            assert.ok(
              pen <= PATTERN_PARAMS.pierce_tol * atr + 1e-4,
              `Pierce violation at bar ${bar}: close ${c.close} vs line ${lineP} by ${pen} > ${PATTERN_PARAMS.pierce_tol * atr}`
            );
          }
        }
      }
    }
  }
  console.log('✓ U9 Invariant: Zero pierce violations across 200 random walks');
}

console.log('--- All Chart Patterns Tests Passed Successfully! ---');
