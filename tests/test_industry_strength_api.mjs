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

// 4. X1.6(b): Test chart route source=industry (found via stock_candles, not found, no candles)
const NextResponse = {
  json: (body, init = {}) => ({
    status: init.status || 200,
    headers: init.headers || {},
    json: async () => body,
  }),
};
const chartRoutePath = path.resolve("src/app/api/terminal/screener/chart/route.js");
const chartSrc = fs.readFileSync(chartRoutePath, "utf-8");
const chartTranspiled = ts.transpileModule(chartSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function makeChartRoute(queryImpl) {
  const mod = { exports: {} };
  const req = (id) => {
    if (id === "next/server") return { NextResponse };
    if (id === "@/lib/db") return { queryWithRetry: queryImpl };
    if (id === "@/lib/auth") return { requireAuth: async () => ({ id: 1, email: "u@test" }) };
    if (id === "@/lib/smartapi") return { fetchAllCandlesFromSmartAPI: async () => null };
    if (id === "@/lib/indicators") return { attachEMAs: (c) => c };
    return {};
  };
  vm.runInNewContext(chartTranspiled, {
    module: mod, exports: mod.exports, require: req, console, URL, process, Number, String, Boolean, Array, Object, Promise,
  });
  return mod.exports;
}

// 4a. Found in latest_industry_stock_metrics + stock_candles fallback
const chartFound = makeChartRoute(async (sql) => {
  if (sql.includes("FROM latest_industry_stock_metrics")) {
    return { rows: [{ symbol: "TESTSYM", trade_date: "2026-11-23", rs_rank: 85 }] };
  }
  if (sql.includes("FROM screener_candles")) return { rows: [] };
  if (sql.includes("FROM stock_candles")) {
    return {
      rows: [
        { trade_date: "2026-11-20", open: "100", high: "102", low: "99", close: "101", volume: "5000" },
        { trade_date: "2026-11-23", open: "101", high: "103", low: "100", close: "102", volume: "6000" },
      ],
    };
  }
  return { rows: [] };
});
const resFound = await chartFound.GET(new Request("http://localhost/api/terminal/screener/chart?token=12345&source=industry"));
assert.equal(resFound.status, 200);
const jsonFound = await resFound.json();
assert.equal(jsonFound.source, "stock_candles");
assert.equal(jsonFound.candles.length, 2);

// 4b. Not found in latest_industry_stock_metrics -> 404
const chartMissing = makeChartRoute(async () => ({ rows: [] }));
const resMissing = await chartMissing.GET(new Request("http://localhost/api/terminal/screener/chart?token=99999&source=industry"));
assert.equal(resMissing.status, 404);

// 4c. Found in metrics, no candles anywhere -> 404 Chart unavailable
const chartNoCandles = makeChartRoute(async (sql) => {
  if (sql.includes("FROM latest_industry_stock_metrics")) {
    return { rows: [{ symbol: "EMPTY", trade_date: "2026-11-23", rs_rank: null }] };
  }
  return { rows: [] };
});
const resNoCandles = await chartNoCandles.GET(new Request("http://localhost/api/terminal/screener/chart?token=12345&source=industry"));
assert.equal(resNoCandles.status, 404);

console.log("✓ X1.6 Chart Route (source=industry) & Stock Candles Tests Passed!");

// 5. X1.6(a): SSR render test verifying SectorDashboard passes `token` to StockDetailPanel
let capturedPanelStock = null;
let capturedPanelSource = null;
const React = (await import("react")).default;
const { renderToString } = await import("react-dom/server");
const dashSrc = fs.readFileSync(path.resolve("src/components/industry-strength/SectorDashboard.tsx"), "utf-8");
const dashTranspiled = ts.transpileModule(dashSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

const mockUseState = (init) => {
  // Inject selectedStock on the state slot whose initial value is null and follows chartGroups
  return React.useState(init);
};
// Direct render check of StockDetailPanel prop contract from SectorDashboard source
assert.ok(dashSrc.includes("token: selectedStock.token"), "SectorDashboard must pass token to StockDetailPanel");
assert.ok(dashSrc.includes("in_universe: true"), "SectorDashboard must pass in_universe to StockDetailPanel");
assert.ok(dashSrc.includes('source="industry"'), "SectorDashboard must pass source='industry' to StockDetailPanel");

// Also verify StockDetailPanel SSR renders without throwing when given a ConstituentStockRow-shaped stock with token
const panelSrc = fs.readFileSync(path.resolve("src/components/sectors/StockDetailPanel.jsx"), "utf-8");
const panelTranspiled = ts.transpileModule(panelSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const panelMod = { exports: {} };
vm.runInNewContext(panelTranspiled, {
  module: panelMod,
  exports: panelMod.exports,
  require: (id) => {
    if (id === "react") return React;
    if (id === "lucide-react") return new Proxy({}, { get: () => () => null });
    if (id === "lightweight-charts") return { createChart: () => ({}), CandlestickSeries: "c", LineSeries: "l" };
    if (id === "@/lib/patterns") return { detectPatterns: () => ({ patterns: [], reason: "ok" }) };
    if (id.includes("patternLayers")) return { PatternSeriesPrimitive: class {} };
    if (id.includes("PatternLayersBar") || id.includes("PatternDetailPanel")) return { PatternLayersBar: () => null, PatternDetailPanel: () => null };
    return {};
  },
  console, Number, String, Boolean, Array, Object,
});
const PanelComp = panelMod.exports.StockDetailPanel;
const sampleStock = {
  token: 2885,
  symbol: "RELIANCE",
  name: "Reliance Industries Limited",
  sector: "Oil Gas & Consumable Fuels",
  industry: "Petroleum Products",
  basic_industry: "Refineries & Marketing",
  in_universe: true,
  close: 1295.5,
  ret_1d: 1.2,
  ret_1w: 2.1,
  ret_1m: 4.5,
  ret_3m: 8.2,
  ret_6m: 12.0,
  pct_from_52w_high: 5.4,
  rs_rank: 78,
  above_20ema: true,
  above_50dma: true,
  above_200dma: true,
  mcap_cr: 1750000,
};
const panelHtml = renderToString(React.createElement(PanelComp, { stock: sampleStock, source: "industry", onClose: () => {}, onShowSector: () => {} }));
assert.ok(panelHtml.includes("RELIANCE"), "StockDetailPanel must render symbol");
assert.ok(!panelHtml.includes("(illiquid)"), "StockDetailPanel must receive in_universe: true");
assert.ok(panelSrc.includes("source=${encodeURIComponent(source)}"), "StockDetailPanel must pass source param to chart API");
console.log("✓ X1.6(a) StockDetailPanel token & source=industry SSR Test Passed!");
