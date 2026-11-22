/**
 * Pattern Audit Script - Round 3 / U12
 * Runs pure JS chart pattern detector across screener tokens in Neon DB.
 * Read-only role, no secrets printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool, types } from 'pg';
import { detectPatterns } from '../src/lib/patterns/index.js';
import { computeATR } from '../src/lib/patterns/atr.js';
import { PATTERN_PARAMS } from '../src/lib/patterns/params.js';

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
  console.log('=== AUTO CHART PATTERNS AUDIT & BENCHMARK (U12) ===\n');

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
  const currentExamples = [];
  const patternsPerStock = [];
  const currentPatternsPerStock = [];
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

      if (pat.status !== 'historical' && currentExamples.length < 10) {
        const line = pat.lines[0];
        const touches = line?.touches || [];
        currentExamples.push({
          symbol: stock.symbol,
          type: pat.type,
          title: pat.title,
          status: pat.status,
          anchors: {
            start_date: touches[0]?.date || pat.window.start_date,
            end_date: touches[touches.length - 1]?.date || pat.window.end_date,
            start_price: touches[0]?.price || line?.p1,
            end_price: touches[touches.length - 1]?.price || line?.p2,
          },
          touches: touches.map((t) => ({ date: t.date, price: t.price })),
          summary: pat.summary,
        });
      }
    }
  }

  // U12.4 Statistics
  const totalPatterns = patternsPerStock.reduce((a, b) => a + b, 0);
  const avgPatterns = totalStocksEvaluated > 0 ? (totalPatterns / totalStocksEvaluated).toFixed(2) : 0;
  const maxPatterns = patternsPerStock.length > 0 ? Math.max(...patternsPerStock) : 0;
  const totalCurrentPatterns = currentPatternsPerStock.reduce((a, b) => a + b, 0);
  const avgCurrentPatterns = totalStocksEvaluated > 0 ? (totalCurrentPatterns / totalStocksEvaluated).toFixed(2) : 0;
  const maxCurrentPatterns = currentPatternsPerStock.length > 0 ? Math.max(...currentPatternsPerStock) : 0;

  console.log('--- PATTERN COUNTS BY TYPE ---');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type.padEnd(25)}: ${count}`);
  }

  console.log('\n--- PATTERN COUNTS BY STATUS ---');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status.padEnd(25)}: ${count}`);
  }

  console.log('\n--- U12.4 PATTERN DISTRIBUTION & CURRENT PATTERNS ---');
  console.log(`  Evaluated stocks                    : ${totalStocksEvaluated}`);
  console.log(`  Total patterns detected             : ${totalPatterns}`);
  console.log(`  Patterns per stock (all)            : avg ${avgPatterns}, max ${maxPatterns}`);
  console.log(`  Total CURRENT patterns              : ${totalCurrentPatterns}`);
  console.log(`  Current patterns per stock          : avg ${avgCurrentPatterns}, max ${maxCurrentPatterns}`);
  console.log(`  Stocks with >= 1 CURRENT pattern    : ${stocksWithCurrentPattern} / ${totalStocksEvaluated} (${((stocksWithCurrentPattern / totalStocksEvaluated) * 100).toFixed(1)}%)`);

  // U12.2 Real Node benchmarks for 40 tiles
  console.log('\n--- U12.2 REAL BENCHMARK (40 TILES) ---');

  // Benchmark 40 tiles of 150 bars
  const times150 = [];
  const subset40 = evaluatedStockData.slice(0, 40);
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
  console.log(`  40 tiles of 150 bars (10 runs) : min ${min150} ms, avg ${avg150} ms, max ${max150} ms (avg per tile: ${(avg150 / 40).toFixed(2)} ms)`);

  // Benchmark 40 tiles of 260 bars
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
  console.log(`  40 tiles of 260 bars (10 runs) : min ${min260} ms, avg ${avg260} ms, max ${max260} ms (avg per tile: ${(avg260 / 40).toFixed(2)} ms)`);

  // Benchmark 1,200 bars (Angel 5-year history)
  // Synthesize or tile candles to 1200 bars
  const times1200 = [];
  const base1200Candles = [];
  if (subset40.length > 0) {
    let seed = subset40[0].candles;
    while (base1200Candles.length < 1200) {
      base1200Candles.push(...seed);
    }
    base1200Candles.length = 1200;
  }
  for (let trial = 0; trial < 10; trial++) {
    const t0 = performance.now();
    detectPatterns(base1200Candles);
    times1200.push(performance.now() - t0);
  }
  const min1200 = Math.min(...times1200).toFixed(2);
  const max1200 = Math.max(...times1200).toFixed(2);
  const avg1200 = (times1200.reduce((a, b) => a + b, 0) / times1200.length).toFixed(2);
  console.log(`  Single 1,200-bar history (10 runs) : min ${min1200} ms, avg ${avg1200} ms, max ${max1200} ms`);

  // U12.1 Hand Checks on Real DB Candles
  console.log('\n--- U12.1 HAND CHECKS ON REAL DB CANDLES ---');
  let slopedExample = null;
  let triangleExample = null;
  let baseExample = null;

  for (const item of evaluatedStockData) {
    const res = detectPatterns(item.candles);
    const atrs = computeATR(item.candles, 14);

    for (const pat of res.patterns) {
      if (!slopedExample && (pat.type === 'sloped_resistance' || pat.type === 'sloped_support')) {
        slopedExample = verifyPatternPiercing(item.stock.symbol, pat, item.candles, atrs);
      }
      if (!triangleExample && (pat.type === 'ascending_triangle' || pat.type === 'descending_triangle' || pat.type === 'symmetrical_triangle')) {
        triangleExample = verifyPatternPiercing(item.stock.symbol, pat, item.candles, atrs);
      }
      if (!baseExample && pat.type === 'base_pivot') {
        baseExample = verifyPatternPiercing(item.stock.symbol, pat, item.candles, atrs);
      }
    }
    if (slopedExample && triangleExample && baseExample) break;
  }

  printHandCheckResult('1. Sloped Line', slopedExample);
  printHandCheckResult('2. Triangle', triangleExample);
  printHandCheckResult('3. Base + Pivot', baseExample);

  console.log('\n--- 10 CURRENT PATTERNS (for TradingView visual comparison) ---');
  console.log(JSON.stringify(currentExamples, null, 2));

  await pool.end();
}

function verifyPatternPiercing(symbol, pat, candles, atrs) {
  const line = pat.lines[0];
  const touches = line.touches || [];
  const firstIdx = touches.length > 0 ? touches[0].idx : line.idx1;
  const lastIdx = touches.length > 0 ? touches[touches.length - 1].idx : line.idx2;

  let maxAtrPenetration = 0;
  for (let bar = firstIdx; bar <= lastIdx; bar++) {
    const c = candles[bar];
    const atr = atrs[bar] || 1;
    const lnP1 = Math.log(line.p1);
    const lineP = Math.exp(lnP1 + (line.slope || 0) * (bar - line.idx1));

    let pen = 0;
    if (line.role === 'resistance' || line.role === 'upper_resistance' || line.role === 'pivot') {
      pen = Math.max(0, c.close - lineP) / atr;
    } else {
      pen = Math.max(0, lineP - c.close) / atr;
    }
    if (pen > maxAtrPenetration) maxAtrPenetration = pen;
  }

  return {
    symbol,
    type: pat.type,
    title: pat.title,
    status: pat.status,
    touches: touches.map((t) => ({ date: t.date, price: t.price })),
    drawnSpan: { start_date: candles[firstIdx]?.date, end_date: candles[lastIdx]?.date },
    maxAtrPenetration: Number(maxAtrPenetration.toFixed(4)),
    pierceTol: PATTERN_PARAMS.pierce_tol,
    passesNoPierce: maxAtrPenetration <= PATTERN_PARAMS.pierce_tol + 1e-4,
  };
}

function printHandCheckResult(label, res) {
  console.log(`\n${label}:`);
  if (!res) {
    console.log('  None found.');
    return;
  }
  console.log(`  Symbol       : ${res.symbol}`);
  console.log(`  Pattern      : ${res.title} (${res.type}) [Status: ${res.status}]`);
  console.log(`  Drawn Span   : ${res.drawnSpan.start_date} to ${res.drawnSpan.end_date}`);
  console.log(`  Touches      :`);
  for (const t of res.touches) {
    console.log(`    Date: ${t.date}, Price: ₹${t.price}`);
  }
  console.log(`  Max Penetration Between Touches: ${res.maxAtrPenetration} ATR (Tolerance: ${res.pierceTol} ATR)`);
  console.log(`  Passes No-Pierce Invariant    : ${res.passesNoPierce ? 'YES (VERIFIED)' : 'NO (FAILED)'}`);
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  pool.end();
  process.exit(1);
});
