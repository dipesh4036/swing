import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadTsModule(relPath, mocks = {}) {
  const fullPath = path.resolve(relPath);
  const src = fs.readFileSync(fullPath, "utf-8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const req = (id) => {
    if (mocks[id]) return mocks[id];
    if (id.startsWith("@/lib/industry-types")) {
      return loadTsModule("src/lib/industry-types.ts", mocks);
    }
    return {};
  };
  vm.runInNewContext(outputText, {
    module: mod,
    exports: mod.exports,
    require: req,
    console,
    Number,
    Math,
    String,
    Boolean,
    Array,
    Object,
    Promise,
  });
  return mod.exports;
}

console.log("--- Starting Industry Strength TypeScript & Adapter Tests ---");

const strengthLib = loadTsModule("src/lib/industry-strength.ts", {
  "@/lib/db": { queryWithRetry: async () => ({ rows: [] }) },
});

// 1. Validate enums
assert.equal(strengthLib.validateLevel("macro"), "macro");
assert.equal(strengthLib.validateLevel("invalid_level"), "industry");
assert.equal(strengthLib.validateUniverse("liquid"), "liquid");
assert.equal(strengthLib.validateUniverse("foo"), "all");
assert.equal(strengthLib.validatePeriod("3m"), "3m");
assert.equal(strengthLib.validatePeriod("99y"), "1m");

// 2. Test getRankings with mocked completed snapshot & rows
const mockQuery = async (sql) => {
  if (sql.includes("FROM industry_snapshots")) {
    return {
      rows: [{
        snapshot_id: "20261123_120000_abc",
        trade_date: "2026-11-23",
        classification_date: "2026-11-25",
        methodology_version: "rs_sts_v1",
        total_stocks: 2592,
        classified_stocks: 2573,
        eligible_stocks: 2540,
        group_count: 280,
      }],
    };
  }
  if (sql.includes("FROM daily_industry_strength")) {
    return {
      rows: [
        {
          group_id: "ind_1",
          level: "industry",
          label: "Banks",
          parent_id: "sec_1",
          full_path: "Financial Services > Financial Services > Banks",
          macro_label: "Financial Services",
          sector_label: "Financial Services",
          industry_label: "Banks",
          basic_industry_label: null,
          rank: 1,
          n_stocks: 40,
          n_eligible: 38,
          adv: 28,
          dec: 10,
          unch: 2,
          rs_sts: "88.5000",
          rs_sts_prev: "82.0000",
          rs_line: "1.052",
          rs_above_ema21: true,
          ret_1d: "1.25",
          ret_1w: "2.5",
          ret_1m: "6.4",
          ret_3m: "12.1",
          ret_6m: null,
          pct_above_20ema: "70.0",
          pct_above_50dma: "65.0",
          pct_above_200dma: "55.0",
          n_valid_20ema: 40,
          n_valid_50dma: 40,
          n_valid_200dma: 38,
          mcap_cr: "4500000",
        },
      ],
    };
  }
  return { rows: [] };
};

const rankings = await strengthLib.getRankings({ level: "industry", universe: "all" }, mockQuery);
assert.equal(rankings.snapshotId, "20261123_120000_abc");
assert.equal(rankings.coverage.classifiedStocks, 2573);
assert.equal(rankings.groups.length, 1);
assert.equal(rankings.groups[0].rsSts, 88.5);
assert.equal(rankings.groups[0].ret6m, null); // null stays null, never 0
assert.equal(rankings.groups[0].rsTrend, "improving");

// 3. Test Screener legacy compatibility adapter
const { resolveScreenerSectorParam } = await import("../src/lib/screener-sector-adapter.js");
assert.equal(resolveScreenerSectorParam("bank").value, "Banks");
assert.equal(resolveScreenerSectorParam("it").value, "Information Technology");
assert.equal(resolveScreenerSectorParam("psu_bank").mode, "unsupported");
assert.equal(resolveScreenerSectorParam("Healthcare").mode, "mapped");

console.log("✓ Industry Strength API & Screener Adapter Tests Passed!");
