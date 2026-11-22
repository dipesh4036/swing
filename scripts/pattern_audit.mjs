/**
 * Pattern Audit Script
 * Runs pure JS chart pattern detector across screener tokens in Neon DB.
 * Read-only role, no secrets printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool, types } from 'pg';
import { detectPatterns } from '../src/lib/patterns/index.js';

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
  console.log('=== AUTO CHART PATTERNS AUDIT ===\n');

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

  // 3. Run pattern detector and benchmark
  const typeCounts = {};
  const statusCounts = {};
  const examples = [];
  let totalDetectorTimeMs = 0;
  let totalStocksEvaluated = 0;

  for (const stock of stocks) {
    const candles = candlesByToken.get(stock.token) || [];
    if (candles.length < 60) continue;

    const t0 = performance.now();
    const result = detectPatterns(candles);
    const elapsed = performance.now() - t0;

    totalDetectorTimeMs += elapsed;
    totalStocksEvaluated++;

    for (const pat of result.patterns) {
      typeCounts[pat.type] = (typeCounts[pat.type] || 0) + 1;
      statusCounts[pat.status] = (statusCounts[pat.status] || 0) + 1;

      if (examples.length < 10) {
        const line = pat.lines[0];
        const touches = line?.touches || [];
        examples.push({
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
          summary: pat.summary,
        });
      }
    }
  }

  // 4. Output Summary Statistics
  console.log('--- PATTERN COUNTS BY TYPE ---');
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type.padEnd(25)}: ${count}`);
  }

  console.log('\n--- PATTERN COUNTS BY STATUS ---');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status.padEnd(25)}: ${count}`);
  }

  const avgMs = totalStocksEvaluated > 0 ? totalDetectorTimeMs / totalStocksEvaluated : 0;
  const grid40Ms = avgMs * 40;

  console.log('\n--- PERFORMANCE BENCHMARK ---');
  console.log(`  Evaluated stocks         : ${totalStocksEvaluated}`);
  console.log(`  Total detector runtime   : ${totalDetectorTimeMs.toFixed(2)} ms`);
  console.log(`  Average runtime per stock: ${avgMs.toFixed(2)} ms (target <= 15 ms)`);
  console.log(`  Projected 40-tile grid   : ${grid40Ms.toFixed(2)} ms`);

  console.log('\n--- 10 JSON EXAMPLES (for TradingView visual comparison) ---');
  console.log(JSON.stringify(examples, null, 2));

  await pool.end();
}

runAudit().catch((err) => {
  console.error('Audit failed:', err);
  pool.end();
  process.exit(1);
});
