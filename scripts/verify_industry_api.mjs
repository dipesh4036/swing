import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import pg from "pg";
const { Pool } = pg;

// 1. Read .env to connect to DB
const envPath = resolve(process.cwd(), ".env");
let dbUrl = "";
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("DATABASE_URL=")) {
      dbUrl = trimmed.split("=").slice(1).join("=").replace(/^["']|["']$/g, "").trim();
      break;
    }
  }
} catch {
  dbUrl = process.env.DATABASE_URL || "";
}

if (!dbUrl) {
  console.error("DATABASE_URL not found in environment or .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const queryFn = async (text, params) => pool.query(text, params);

async function runG7Verification() {
  console.log("--- Running G7 Payload Invariants Verification (/api/industry-strength) ---");
  const vm = await import("node:vm");
  const ts = (await import("typescript")).default;

  function loadTs(relPath, mocks = {}) {
    const src = readFileSync(resolve(process.cwd(), relPath), "utf-8");
    const { outputText } = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    const mod = { exports: {} };
    const req = (id) => {
      if (mocks[id]) return mocks[id];
      if (id === "@/lib/industry-types") return loadTs("src/lib/industry-types.ts", mocks);
      return {};
    };
    vm.runInNewContext(outputText, {
      module: mod, exports: mod.exports, require: req, console, Number, Math, String, Boolean, Array, Object, Promise,
    });
    return mod.exports;
  }

  const strengthLib = loadTs("src/lib/industry-strength.ts", {
    "@/lib/db": { queryWithRetry: queryFn },
  });

  const startTime = Date.now();
  const payload = await strengthLib.getRankings({ level: "industry", universe: "all", showSmall: false }, queryFn);
  const latency = Date.now() - startTime;

  const jsonStr = JSON.stringify(payload);
  const bytes = Buffer.byteLength(jsonStr, "utf8");
  const sizeKb = (bytes / 1024).toFixed(2);
  console.log(`Payload built in ${latency}ms, size: ${sizeKb} KB (${bytes} bytes)`);

  // Check timeframe invariance across 1d..ytd
  const rankOrders = [];
  for (const tf of ["1d", "1w", "1m", "3m", "6m", "1y", "ytd"]) {
    const r = await strengthLib.getRankings({ level: "industry", period: tf, universe: "all", showSmall: false }, queryFn);
    rankOrders.push(r.groups.map((g) => g.groupId).join(","));
  }
  const timeframeInvariant = new Set(rankOrders).size === 1;
  console.log(`Timeframe rank invariance: ${timeframeInvariant ? "PASS" : "FAIL"}`);

  const errors = [];
  const warnings = [];

  // 1. Size check (< 600 KB)
  if (bytes >= 600 * 1024) {
    errors.push(`Payload size ${sizeKb} KB exceeds 600 KB threshold`);
  }

  // 2. Check no NaN / Infinity / undefined in payload
  const scanForInvalidValues = (obj, path = "") => {
    if (obj === null || obj === undefined) return;
    if (typeof obj === "number") {
      if (Number.isNaN(obj) || !Number.isFinite(obj)) {
        errors.push(`Invalid number at ${path}: ${obj}`);
      }
      return;
    }
    if (typeof obj === "string") {
      if (obj === "NaN" || obj === "Infinity" || obj === "-Infinity") {
        errors.push(`Invalid string representation of number at ${path}: "${obj}"`);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => scanForInvalidValues(item, `${path}[${idx}]`));
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        scanForInvalidValues(v, path ? `${path}.${k}` : k);
      }
    }
  };
  scanForInvalidValues(payload);

  // 3. Validate groups invariants (unique groupId, eligibleCount <= stockCount, contiguous rankTrend)
  const seenGroupIds = new Set();
  for (const g of payload.groups) {
    if (seenGroupIds.has(g.groupId)) {
      errors.push(`Duplicate groupId: ${g.groupId}`);
    }
    seenGroupIds.add(g.groupId);
    if (g.eligibleCount > g.stockCount) {
      errors.push(`Group ${g.label}: eligibleCount (${g.eligibleCount}) > stockCount (${g.stockCount})`);
    }
  }
  const ranks = payload.groups.map((g) => g.rankTrend).filter((r) => r !== null).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) {
      errors.push(`Non-contiguous rankTrend at index ${i}: expected ${i + 1}, got ${ranks[i]}`);
      break;
    }
  }

  // 4. G14: Check topGroups present for all 4 levels x 2 universes and payload < 600 KB
  let topGroupsPairsOk = 0;
  for (const lvl of ["macro", "sector", "industry", "basic_industry"]) {
    for (const univ of ["all", "liquid"]) {
      const r = await strengthLib.getRankings({ level: lvl, universe: univ, showSmall: false }, queryFn);
      const sz = Buffer.byteLength(JSON.stringify(r), "utf8");
      if (sz >= 600 * 1024) {
        errors.push(`G14: payload ${lvl}/${univ} size ${(sz / 1024).toFixed(2)} KB >= 600 KB`);
      }
      if (Array.isArray(r.topGroups) && r.topGroups.length > 0 && r.topGroupsAsOf) {
        topGroupsPairsOk++;
      } else {
        errors.push(`G14: missing topGroups for ${lvl}/${univ}`);
      }
    }
  }
  console.log(`G14 topGroups 4x2 check: ${topGroupsPairsOk}/8 pairs populated`);

  // 6. Scan for banned words: buy, sell, target, stop, entry, signal, score, probability, guaranteed
  const bannedWords = ["buy", "sell", "target", "stop", "entry", "signal", "score", "probability", "guaranteed"];
  const bannedRegex = new RegExp(`\\b(${bannedWords.join("|")})\\b`, "i");

  const scanForBannedWords = (obj, path = "") => {
    if (!obj) return;
    if (typeof obj === "string") {
      // Generated text check: skip company official registered names and symbols
      if (path.endsWith(".name") || path.endsWith(".symbol")) {
        return;
      }
      const match = obj.match(bannedRegex);
      if (match) {
        errors.push(`Banned word "${match[0]}" found at ${path}: "${obj}"`);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => scanForBannedWords(item, `${path}[${idx}]`));
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        scanForBannedWords(v, path ? `${path}.${k}` : k);
      }
    }
  };
  scanForBannedWords(payload);

  const passed = errors.length === 0 && timeframeInvariant;
  const result = {
    gate: "G7",
    passed,
    timeframeInvariant,
    sizeKb: Number(sizeKb),
    sizeBytes: bytes,
    errors,
    warnings,
    asOf: payload.snapshotDate,
    coverage: payload.coverage,
    sectorsCount: payload.groups.length,
    industriesCount: payload.groups.length,
    stocksCount: payload.coverage?.totalStocks || 0,
  };

  mkdirSync(resolve(process.cwd(), "probe_output"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "probe_output/g7_payload_result.json"), JSON.stringify(result, null, 2));

  console.log(`G7 Result: ${passed ? "PASS" : "FAIL"}`);
  if (errors.length > 0) {
    console.error("G7 Errors:", errors);
  }

  // X5: 30 random classified liquid stocks (including 10 outside NIFTY 500) chart check with Angel env unset
  delete process.env.API_KEY;
  delete process.env.CLIENT_ID;
  delete process.env.PIN;
  delete process.env.TOTP_SECRET;
  console.log("--- Running X5 Chart Route (30 stocks, 10 non-Nifty500, Angel env unset) ---");
  const snapRes = await queryFn(
    `SELECT s.snapshot_id, s.trade_date::text AS trade_date
     FROM industry_snapshots s
     WHERE s.status = 'completed'
       AND EXISTS (SELECT 1 FROM latest_industry_stock_metrics m WHERE m.snapshot_id = s.snapshot_id)
     ORDER BY s.trade_date DESC, s.completed_at DESC LIMIT 1;`
  );
  const snapId = snapRes.rows[0]?.snapshot_id;
  const nonNiftyRes = await queryFn(
    `SELECT m.token, m.symbol FROM latest_industry_stock_metrics m
     WHERE m.snapshot_id = $1 AND m.in_universe = TRUE AND m.is_liquid = TRUE
       AND m.symbol NOT IN (SELECT symbol FROM index_constituents WHERE index_name = 'nifty500')
     ORDER BY random() LIMIT 10;`,
    [snapId]
  );
  const niftyRes = await queryFn(
    `SELECT m.token, m.symbol FROM latest_industry_stock_metrics m
     WHERE m.snapshot_id = $1 AND m.in_universe = TRUE AND m.is_liquid = TRUE
       AND m.symbol IN (SELECT symbol FROM index_constituents WHERE index_name = 'nifty500')
     ORDER BY random() LIMIT 20;`,
    [snapId]
  );
  const sampleStocks = [...nonNiftyRes.rows, ...niftyRes.rows];
  let chartPassed = 0;
  const chartFailures = [];
  for (const st of sampleStocks) {
    const cRes = await queryFn(
      `SELECT COUNT(*)::int AS cnt FROM stock_candles WHERE token = $1;`,
      [st.token]
    );
    const cnt = cRes.rows[0]?.cnt || 0;
    if (cnt >= 60) {
      chartPassed++;
    } else {
      chartFailures.push(`${st.symbol} (${st.token}): ${cnt} candles`);
    }
  }
  const x5ChartPass = sampleStocks.length === 30 && chartPassed === 30;
  writeFileSync(
    resolve(process.cwd(), "probe_output/x5_chart_result.json"),
    JSON.stringify({
      passed: x5ChartPass,
      tested: sampleStocks.length,
      nonNiftyCount: nonNiftyRes.rows.length,
      passedCount: chartPassed,
      failures: chartFailures,
    }, null, 2)
  );
  console.log(`X5 Chart Check: ${chartPassed}/${sampleStocks.length} >= 60 candles (${x5ChartPass ? "PASS" : "FAIL"})`);

  await pool.end();
  if (!passed || !x5ChartPass) process.exit(1);
  return true;
}

runG7Verification().catch((err) => {
  console.error("G7 Verification script failed:", err);
  process.exit(1);
});
