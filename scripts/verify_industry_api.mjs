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
  console.log("--- Running G7 Payload Invariants Verification ---");
  const { buildIndustriesPayload } = await import("../src/lib/industries-data.js");

  const startTime = Date.now();
  const payload = await buildIndustriesPayload(queryFn);
  const latency = Date.now() - startTime;

  const jsonStr = JSON.stringify(payload);
  const bytes = Buffer.byteLength(jsonStr, "utf8");
  const sizeKb = (bytes / 1024).toFixed(2);
  console.log(`Payload built in ${latency}ms, size: ${sizeKb} KB (${bytes} bytes)`);

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

  // 3. Every classified stock's basic_industry exists in industries[]
  const industryNames = new Set(payload.industries.map((ind) => ind.basic_industry));
  const classifiedStocks = payload.stocks.filter((s) => s.basic_industry != null);
  for (const s of classifiedStocks) {
    if (!industryNames.has(s.basic_industry)) {
      errors.push(`Stock ${s.symbol} has basic_industry "${s.basic_industry}" not found in industries[]`);
    }
  }

  // 4. Sector n_stocks = sum over member stocks
  for (const sec of payload.sectors) {
    const memberStocksCount = payload.stocks.filter((s) => (s.sector || "Unclassified") === sec.name).length;
    if (sec.n_stocks !== memberStocksCount) {
      errors.push(`Sector "${sec.name}" n_stocks (${sec.n_stocks}) does not match member stock count (${memberStocksCount})`);
    }
  }

  // 5. stocks[] count equals universe / classified count
  if (payload.coverage.n_classified !== classifiedStocks.length) {
    errors.push(`coverage.n_classified (${payload.coverage.n_classified}) != actual classified stocks count (${classifiedStocks.length})`);
  }

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

  const passed = errors.length === 0;
  const result = {
    gate: "G7",
    passed,
    sizeKb: Number(sizeKb),
    sizeBytes: bytes,
    errors,
    warnings,
    asOf: payload.asOf,
    coverage: payload.coverage,
    sectorsCount: payload.sectors.length,
    industriesCount: payload.industries.length,
    stocksCount: payload.stocks.length,
  };

  mkdirSync(resolve(process.cwd(), "probe_output"), { recursive: true });
  writeFileSync(resolve(process.cwd(), "probe_output/g7_payload_result.json"), JSON.stringify(result, null, 2));

  console.log(`G7 Result: ${passed ? "PASS" : "FAIL"}`);
  if (errors.length > 0) {
    console.error("G7 Errors:", errors);
  }
  await pool.end();
  return passed;
}

runG7Verification().catch((err) => {
  console.error("G7 Verification script failed:", err);
  process.exit(1);
});
