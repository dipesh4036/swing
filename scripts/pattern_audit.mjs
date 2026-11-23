/**
 * Pattern Audit Script - Round 4 (V3, V4, V5, V6)
 * Runs pure JS chart pattern detector across screener tokens in Neon DB.
 * Read-only role, no secrets printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool, types } from 'pg';
import { detectPatterns } from '../src/lib/patterns/index.js';
import { computeATR } from '../src/lib/patterns/atr.js';
import { PATTERN_PARAMS } from '../src/lib/patterns/params.js';
import { getLinePrice } from '../src/lib/patterns/trendlines.js';

// Return DATE (type OID 1082) as raw string 'YYYY-MM-DD'
types.setTypeParser(1082, (str) => str);

// Load DATABASE_URL from .env or .env.local if not in process.env
if (!process.env.DATABASE_URL) {
  for (const envFile of ['.env.local', '.env']) {
    const fullPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/^DATABASE_URL=(.*)$/);
        if (match) {
          process.env.DATABASE_URL = match[1].trim().replace(/^["']|["']$/g, '');
          break;
        }
      }
    }
    if (process.env.DATABASE_URL) break;
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function runAudit() {
  console.log('=== AUTO CHART PATTERNS AUDIT & VERIFICATION (V3–V6) ===\n');

  // 1. Fetch latest screener tokens with symbols
  const tokensRes = await pool.query(`
    SELECT DISTINCT r.token, i.symbol
    FROM daily_screener_results r
    JOIN instruments i ON r.token = i.token
    ORDER BY i.symbol
  `);

  const stocks = tokensRes.rows;
  console.log(`Found ${stocks.length} active screener stocks.`);

  if (stocks.length === 0) {
    console.log('No screener stocks found in database.');
    await pool.end();
    return;
  }

  // 2. Fetch candles for all tokens
  const tokenList = stocks.map((s) => s.token);
  const candlesRes = await pool.query(
    `
    SELECT token, trade_date as date, open::float, high::float, low::float, close::float, volume::float
    FROM screener_candles
    WHERE token = ANY($1::int[])
    ORDER BY token, trade_date ASC
  `,
    [tokenList]
  );

  const candlesByToken = new Map();
  for (const r of candlesRes.rows) {
    if (!candlesByToken.has(r.token)) {
      candlesByToken.set(r.token, []);
    }
    candlesByToken.get(r.token).push(r);
  }

  console.log(`Loaded candle history across ${candlesByToken.size} tokens.\n`);

  // 3. Run pattern detector across all stocks
  const typeCounts = {};
  const statusCounts = {};
  const patternsPerStock = [];
  const currentPatternsPerStock = [];
  const baseDepths = [];
  const touchesCounts = {};
  let stocksWithCurrentPattern = 0;
  let totalDetectorTimeMs = 0;
  let totalStocksEvaluated = 0;

  const evaluatedStockData = [];

  for (const stock of stocks) {
    const candles = candlesByToken.get(stock.token) || [];
    if (candles.length < 60) continue;

    evaluatedStockData.push({ stock, candles });

    const t0 = performance.now();
    const result = detectPatterns(candles);
    const elapsed = performance.now() - t0;

    totalDetectorTimeMs += elapsed;
    totalStocksEvaluated++;

    const stockPatterns = result.patterns;
    patternsPerStock.push(stockPatterns.length);

    const currentPats = stockPatterns.filter((p) => p.status !== 'historical');
    currentPatternsPerStock.push(currentPats.length);
    if (currentPats.length > 0) stocksWithCurrentPattern++;

    for (const pat of stockPatterns) {
      typeCounts[pat.type] = (typeCounts[pat.type] || 0) + 1;
      statusCounts[pat.status] = (statusCounts[pat.status] || 0) + 1;

      // Track touches distribution for line patterns
      if (pat.lines && pat.lines[0]?.touches) {
        const tCount = pat.lines[0].touches.length;
        touchesCounts[tCount] = (touchesCounts[tCount] || 0) + 1;
      }

      // Track base depths
      if (pat.type === 'base_pivot' && pat.metrics?.base_depth_pct != null) {
        baseDepths.push(pat.metrics.base_depth_pct);
      }
    }
  }

  // --- V3 Statistics ---
  const totalPatterns = patternsPerStock.reduce((a, b) => a + b, 0);
  const avgPatterns = totalStocksEvaluated > 0 ? (totalPatterns / totalStocksEvaluated).toFixed(2) : 0;
  const maxPatterns = patternsPerStock.length > 0 ? Math.max(...patternsPerStock) : 0;
  const totalCurrentPatterns = currentPatternsPerStock.reduce((a, b) => a + b, 0);
  const avgCurrentPatterns = totalStocksEvaluated > 0 ? (totalCurrentPatterns / totalStocksEvaluated).toFixed(2) : 0;
  const maxCurrentPatterns = currentPatternsPerStock.length > 0 ? Math.max(...currentPatternsPerStock) : 0;

  console.log('--- V3: PATTERN COUNTS BY TYPE ---');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type.padEnd(25)}: ${count}`);
  }

  console.log('\n--- V3: PATTERN COUNTS BY STATUS ---');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status.padEnd(25)}: ${count}`);
  }

  console.log('\n--- V3: PATTERN DISTRIBUTION & BASE STATS ---');
  console.log(`  Evaluated stocks                    : ${totalStocksEvaluated}`);
  console.log(`  Total patterns detected             : ${totalPatterns}`);
  console.log(`  Patterns per stock (all)            : avg ${avgPatterns}, max ${maxPatterns}`);
  console.log(`  Total CURRENT patterns              : ${totalCurrentPatterns}`);
  console.log(`  Current patterns per stock          : avg ${avgCurrentPatterns}, max ${maxCurrentPatterns}`);
  console.log(`  Stocks with >= 1 CURRENT pattern    : ${stocksWithCurrentPattern} / ${totalStocksEvaluated} (${((stocksWithCurrentPattern / totalStocksEvaluated) * 100).toFixed(1)}%)`);
  console.log(`  Total Bases Found                   : ${baseDepths.length} / ${totalStocksEvaluated} (${((baseDepths.length / totalStocksEvaluated) * 100).toFixed(1)}%)`);

  if (baseDepths.length > 0) {
    baseDepths.sort((a, b) => a - b);
    const minDepth = baseDepths[0].toFixed(1);
    const medianDepth = baseDepths[Math.floor(baseDepths.length / 2)].toFixed(1);
    const maxDepth = baseDepths[baseDepths.length - 1].toFixed(1);
    console.log(`  Base Depth % Distribution           : min ${minDepth}%, median ${medianDepth}%, max ${maxDepth}% (limit <= 25.0%)`);
  }

  console.log('\n--- V3: TOUCHES DISTRIBUTION (Main Line) ---');
  const sortedTouches = Object.keys(touchesCounts).map(Number).sort((a, b) => a - b);
  for (const t of sortedTouches) {
    console.log(`  ${t} touches : ${touchesCounts[t]} lines`);
  }

  // --- V4 Real Node Benchmarks ---
  console.log('\n--- V4: REAL MEASURED BENCHMARKS (10 runs each) ---');

  const subset40 = evaluatedStockData.slice(0, 40);

  // 40 tiles of 150 bars
  const times150 = [];
  for (let trial = 0; trial < 10; trial++) {
    const t0 = performance.now();
    for (const item of subset40) {
      const sliced150 = item.candles.slice(-150);
      detectPatterns(sliced150);
    }
    times150.push(performance.now() - t0);
  }
  const min150 = Math.min(...times150).toFixed(2);
  const max150 = Math.max(...times150).toFixed(2);
  const avg150 = (times150.reduce((a, b) => a + b, 0) / times150.length).toFixed(2);
  const perTile150 = (avg150 / 40).toFixed(2);
  console.log(`  40 tiles of 150 bars : min ${min150} ms, avg ${avg150} ms, max ${max150} ms (avg per tile: ${perTile150} ms, target <= 8.0 ms)`);

  // 40 tiles of 260 bars
  const times260 = [];
  for (let trial = 0; trial < 10; trial++) {
    const t0 = performance.now();
    for (const item of subset40) {
      const sliced260 = item.candles.slice(-260);
      detectPatterns(sliced260);
    }
    times260.push(performance.now() - t0);
  }
  const min260 = Math.min(...times260).toFixed(2);
  const max260 = Math.max(...times260).toFixed(2);
  const avg260 = (times260.reduce((a, b) => a + b, 0) / times260.length).toFixed(2);
  const perTile260 = (avg260 / 40).toFixed(2);
  console.log(`  40 tiles of 260 bars : min ${min260} ms, avg ${avg260} ms, max ${max260} ms (avg per tile: ${perTile260} ms, target <= 15.0 ms)`);

  // Single 1,200-bar history
  const base1200Candles = [];
  if (subset40.length > 0) {
    let seed = subset40[0].candles;
    while (base1200Candles.length < 1200) {
      base1200Candles.push(...seed);
    }
    base1200Candles.length = 1200;
  }
  const times1200 = [];
  for (let trial = 0; trial < 10; trial++) {
    const t0 = performance.now();
    detectPatterns(base1200Candles);
    times1200.push(performance.now() - t0);
  }
  const min1200 = Math.min(...times1200).toFixed(2);
  const max1200 = Math.max(...times1200).toFixed(2);
  const avg1200 = (times1200.reduce((a, b) => a + b, 0) / times1200.length).toFixed(2);
  console.log(`  Single 1,200-bar history : min ${min1200} ms, avg ${avg1200} ms, max ${max1200} ms`);

  // --- V5 Hand Checks on Real DB Candles (3 stocks per check, CURRENT patterns only) ---
  console.log('\n--- V5: HAND CHECKS (3 STOCKS PER CHECK, CURRENT PATTERNS ONLY) ---');

  const currentSloped = [];
  const currentTriangles = [];
  const currentBases = [];

  for (const item of evaluatedStockData) {
    const res = detectPatterns(item.candles);
    const atrs = computeATR(item.candles, 14);

    for (const pat of res.patterns) {
      if (pat.status === 'historical') continue;

      if (currentSloped.length < 3 && (pat.type === 'sloped_resistance' || pat.type === 'sloped_support')) {
        const line = pat.lines[0];
        if (line.touches && line.touches.length >= 3) {
          currentSloped.push(evaluateSlopedCheck(item.stock.symbol, pat, item.candles, atrs));
        }
      }

      if (currentTriangles.length < 3 && (pat.type === 'ascending_triangle' || pat.type === 'descending_triangle' || pat.type === 'symmetrical_triangle')) {
        currentTriangles.push(evaluateTriangleCheck(item.stock.symbol, pat, item.candles, atrs));
      }

      if (currentBases.length < 3 && pat.type === 'base_pivot') {
        currentBases.push(evaluateBaseCheck(item.stock.symbol, pat, item.candles));
      }
    }
  }

  console.log('\n1. Sloped Lines (>= 3 touches, Current only):');
  for (let i = 0; i < currentSloped.length; i++) {
    printSlopedCheck(i + 1, currentSloped[i]);
  }

  console.log('\n2. Triangles (Current only):');
  for (let i = 0; i < currentTriangles.length; i++) {
    printTriangleCheck(i + 1, currentTriangles[i]);
  }

  console.log('\n3. Base + Pivot (Current only):');
  for (let i = 0; i < currentBases.length; i++) {
    printBaseCheck(i + 1, currentBases[i]);
  }

  // --- V6 ABCAPITAL Sanity Check ---
  console.log('\n--- V6: ABCAPITAL SANITY CHECK AGAINST REFERENCE CHART ---');
  const abCapitalData = evaluatedStockData.find((d) => d.stock.symbol === 'ABCAPITAL');
  if (abCapitalData) {
    const res = detectPatterns(abCapitalData.candles);
    const basePat = res.patterns.find((p) => p.type === 'base_pivot');
    if (basePat) {
      const legStart = basePat.leg_start;
      const pivotLine = basePat.lines.find((l) => l.role === 'pivot');
      const baseLowLine = basePat.lines.find((l) => l.role === 'base_low');
      const lastCandle = abCapitalData.candles[abCapitalData.candles.length - 1];

      // Find actual date of base low
      const pivotIdx = pivotLine?.touches?.[0]?.idx ?? pivotLine?.idx1;
      let baseLowIdx = pivotIdx;
      let minLow = Infinity;
      for (let b = pivotIdx; b < abCapitalData.candles.length; b++) {
        if (abCapitalData.candles[b].low < minLow) {
          minLow = abCapitalData.candles[b].low;
          baseLowIdx = b;
        }
      }

      const barsFromPivot = abCapitalData.candles.length - 1 - pivotIdx;

      console.log(`  Symbol                  : ABCAPITAL`);
      console.log(`  Status                  : ${basePat.status}`);
      console.log(`  Leg Start               : ${legStart?.date} at ₹${legStart?.price}`);
      console.log(`  Pivot Peak              : ${pivotLine?.touches?.[0]?.date} at ₹${pivotLine?.p1}`);
      console.log(`  Detected Base Low       : ${abCapitalData.candles[baseLowIdx]?.date} at ₹${minLow.toFixed(2)}`);
      console.log(`  Base Depth %            : ${basePat.metrics?.base_depth_pct}%`);
      console.log(`  Bars from Pivot to Last : ${barsFromPivot} bars (last date: ${lastCandle?.date})`);
      console.log(`  Reference Base Low      : ₹395.35`);
      console.log(`  Equals 395.35?          : ${Math.abs(minLow - 395.35) < 0.05 ? 'YES (EXACT MATCH)' : 'NO'}`);
      if (Math.abs(minLow - 395.35) >= 0.05) {
        console.log(`  Explanation             : Detected low is ₹${minLow.toFixed(2)} vs reference ₹395.35.`);
      }
    } else {
      console.log('  ABCAPITAL base_pivot not found.');
    }
  } else {
    console.log('  ABCAPITAL not in screener candles.');
  }

  await pool.end();
}

function evaluateSlopedCheck(symbol, pat, candles, atrs) {
  const line = pat.lines[0];
  const isResistance = line.role === 'resistance' || line.role === 'upper_resistance';
  const touches = line.touches || [];
  const firstIdx = touches[0].idx;
  const lastIdx = touches[touches.length - 1].idx;

  const touchDetails = touches.map((t) => {
    const lineVal = getLinePrice(line.idx1, line.p1, line.slope, t.idx);
    const atr = atrs[t.idx] || 1;
    const signedDistAtr = (t.price - lineVal) / atr;
    return {
      date: t.date,
      swingPrice: t.price,
      lineVal: Number(lineVal.toFixed(2)),
      distAtr: Number(signedDistAtr.toFixed(4)),
    };
  });

  let maxPenetrationAtr = -Infinity;
  for (let b = firstIdx; b <= lastIdx; b++) {
    const c = candles[b];
    const atr = atrs[b] || 1;
    const lineVal = getLinePrice(line.idx1, line.p1, line.slope, b);
    const signedPen = isResistance ? (c.close - lineVal) / atr : (lineVal - c.close) / atr;
    if (signedPen > maxPenetrationAtr) maxPenetrationAtr = signedPen;
  }

  return {
    symbol,
    title: pat.title,
    status: pat.status,
    role: line.role,
    touches: touchDetails,
    maxPenetrationAtr: Number(maxPenetrationAtr.toFixed(4)),
  };
}

function printSlopedCheck(idx, data) {
  console.log(`  (${idx}) ${data.symbol} - ${data.title} [Status: ${data.status}] (${data.role}):`);
  console.log(`      Touches (${data.touches.length}):`);
  for (const t of data.touches) {
    console.log(`        Date: ${t.date} | Swing Price: ₹${t.swingPrice} | Line Val: ₹${t.lineVal} | Distance: ${t.distAtr} ATR`);
  }
  console.log(`      Max Close Penetration between first & last touch: ${data.maxPenetrationAtr} ATR (Tolerance: <= 0.2 ATR)`);
}

function evaluateTriangleCheck(symbol, pat, candles, atrs) {
  const upLine = pat.lines.find((l) => l.role === 'upper_resistance');
  const lowLine = pat.lines.find((l) => l.role === 'lower_support');

  const evalLine = (line, isResistance) => {
    const touches = line.touches || [];
    const firstIdx = touches[0].idx;
    const lastIdx = touches[touches.length - 1].idx;

    const touchDetails = touches.map((t) => {
      const lineVal = getLinePrice(line.idx1, line.p1, line.slope, t.idx);
      const atr = atrs[t.idx] || 1;
      const signedDistAtr = (t.price - lineVal) / atr;
      return {
        date: t.date,
        swingPrice: t.price,
        lineVal: Number(lineVal.toFixed(2)),
        distAtr: Number(signedDistAtr.toFixed(4)),
      };
    });

    let maxPen = -Infinity;
    for (let b = firstIdx; b <= lastIdx; b++) {
      const c = candles[b];
      const atr = atrs[b] || 1;
      const lineVal = getLinePrice(line.idx1, line.p1, line.slope, b);
      const signedPen = isResistance ? (c.close - lineVal) / atr : (lineVal - c.close) / atr;
      if (signedPen > maxPen) maxPen = signedPen;
    }

    return { touches: touchDetails, maxPen: Number(maxPen.toFixed(4)) };
  };

  const upEval = evalLine(upLine, true);
  const lowEval = evalLine(lowLine, false);

  const startIdx = Math.min(upLine.idx1, lowLine.idx1);
  const endIdx = Math.max(upLine.idx2, lowLine.idx2);
  const startWidth = getLinePrice(upLine.idx1, upLine.p1, upLine.slope, startIdx) - getLinePrice(lowLine.idx1, lowLine.p1, lowLine.slope, startIdx);
  const endWidth = getLinePrice(upLine.idx1, upLine.p1, upLine.slope, endIdx) - getLinePrice(lowLine.idx1, lowLine.p1, lowLine.slope, endIdx);
  const convergenceRatio = startWidth > 0 ? (endWidth / startWidth).toFixed(3) : 'N/A';

  return {
    symbol,
    title: pat.title,
    status: pat.status,
    up: upEval,
    low: lowEval,
    startWidth: Number(startWidth.toFixed(2)),
    endWidth: Number(endWidth.toFixed(2)),
    convergenceRatio,
  };
}

function printTriangleCheck(idx, data) {
  console.log(`  (${idx}) ${data.symbol} - ${data.title} [Status: ${data.status}]:`);
  console.log(`      Upper Line Touches (${data.up.touches.length}):`);
  for (const t of data.up.touches) {
    console.log(`        Date: ${t.date} | Swing Price: ₹${t.swingPrice} | Line Val: ₹${t.lineVal} | Distance: ${t.distAtr} ATR`);
  }
  console.log(`      Upper Max Penetration: ${data.up.maxPen} ATR (Tolerance: <= 0.2 ATR)`);

  console.log(`      Lower Line Touches (${data.low.touches.length}):`);
  for (const t of data.low.touches) {
    console.log(`        Date: ${t.date} | Swing Price: ₹${t.swingPrice} | Line Val: ₹${t.lineVal} | Distance: ${t.distAtr} ATR`);
  }
  console.log(`      Lower Max Penetration: ${data.low.maxPen} ATR (Tolerance: <= 0.2 ATR)`);
  console.log(`      Convergence: start width ₹${data.startWidth}, end width ₹${data.endWidth}, ratio ${data.convergenceRatio} (<= 0.6)`);
}

function evaluateBaseCheck(symbol, pat, candles) {
  const pivotLine = pat.lines.find((l) => l.role === 'pivot');
  const pivotIdx = pivotLine?.touches?.[0]?.idx ?? pivotLine?.idx1;
  const legStart = pat.leg_start;

  // Verify pivot is maximum high between leg start and last bar (except breakout)
  let maxHigh = -Infinity;
  for (let b = legStart.idx; b < candles.length; b++) {
    if (candles[b].high > maxHigh) maxHigh = candles[b].high;
  }

  // Base low = minimum low from pivot to last bar
  let minLow = Infinity;
  let baseLowDate = '';
  for (let b = pivotIdx; b < candles.length; b++) {
    if (candles[b].low < minLow) {
      minLow = candles[b].low;
      baseLowDate = candles[b].date;
    }
  }

  const barsFromPivot = candles.length - 1 - pivotIdx;

  return {
    symbol,
    title: pat.title,
    status: pat.status,
    legStart: { date: legStart.date, price: legStart.price },
    pivot: { date: pivotLine?.touches?.[0]?.date, price: pivotLine?.p1, isMaxHigh: Math.abs(pivotLine?.p1 - maxHigh) < 0.1 || pat.status === 'broke_out' },
    baseLow: { date: baseLowDate, price: Number(minLow.toFixed(2)) },
    priorRisePct: pat.metrics?.prior_rise_pct,
    baseDepthPct: pat.metrics?.base_depth_pct,
    barsFromPivot,
  };
}

function printBaseCheck(idx, data) {
  console.log(`  (${idx}) ${data.symbol} - ${data.title} [Status: ${data.status}]:`);
  console.log(`      Leg Start      : ${data.legStart.date} at ₹${data.legStart.price}`);
  console.log(`      Pivot (Peak)   : ${data.pivot.date} at ₹${data.pivot.price} (Verified peak: ${data.pivot.isMaxHigh})`);
  console.log(`      Base Low       : ${data.baseLow.date} at ₹${data.baseLow.price}`);
  console.log(`      Prior Rise %   : ${data.priorRisePct}% (>= 20%)`);
  console.log(`      Base Depth %   : ${data.baseDepthPct}% (<= 25%)`);
  console.log(`      Bars from Pivot: ${data.barsFromPivot} bars (<= 40 bars)`);
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  pool.end();
  process.exit(1);
});
