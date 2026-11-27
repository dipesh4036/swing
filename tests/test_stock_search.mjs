import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import React from "react";
import { renderToString } from "react-dom/server";

function loadTsModule(relPath, mocks = {}) {
  const absPath = path.resolve(relPath);
  const src = fs.readFileSync(absPath, "utf-8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const req = (id) => {
    if (mocks[id]) return mocks[id];
    if (id.startsWith("@/")) {
      const sub = id.slice(2);
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        const cand = path.resolve("src", sub + ext);
        if (fs.existsSync(cand)) return loadTsModule(path.relative(process.cwd(), cand), mocks);
      }
    }
    return Module.createRequire(absPath)(id);
  };
  const fn = new Function("require", "module", "exports", "__filename", "__dirname", out.outputText);
  fn(req, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

const searchLib = loadTsModule("src/lib/stock-search.ts", {
  "@/lib/db": { queryWithRetry: async () => ({ rows: [] }) },
});

// 1. parseSearchQuery validation
assert.equal(searchLib.parseSearchQuery(null), null);
assert.equal(searchLib.parseSearchQuery(""), null);
assert.equal(searchLib.parseSearchQuery("   "), null);
assert.equal(searchLib.parseSearchQuery("%_%"), null);
assert.equal(searchLib.parseSearchQuery("A".repeat(31)), null);
assert.equal(searchLib.parseSearchQuery("rel%"), "rel");
assert.equal(searchLib.parseSearchQuery("RELIANCE"), "RELIANCE");

// 2. searchLiquidStocks SQL params, LIMIT 10 & prefix-before-contains ordering
let capturedSql = "";
let capturedParams = [];
const mockResults = await searchLib.searchLiquidStocks("REL", async (sql, params) => {
  capturedSql = sql;
  capturedParams = params;
  return {
    rows: [
      { token: 2885, symbol: "RELIANCE", name: "Reliance Industries Limited", industry: "Oil Gas & Consumable Fuels", industry_rank: 5, close: 1300, ret_1d: 1.2, rs_rating: 72 },
      { token: 9999, symbol: "NONREL", name: "Reliable Ventures Ltd", industry: "Consumer Services", industry_rank: 12, close: 50, ret_1d: -0.5, rs_rating: 40 },
    ],
  };
});

assert.ok(capturedSql.includes("LIMIT 10"), "Search query must enforce LIMIT 10");
assert.ok(capturedSql.includes("CASE WHEN UPPER(i.symbol) LIKE $1 THEN 0 ELSE 1 END"), "Must rank symbol prefix before name contains");
assert.deepEqual(capturedParams, ["REL%", "%REL%"]);
assert.equal(mockResults.length, 2);
assert.equal(mockResults[0].symbol, "RELIANCE");

// 3. Shortcut handler safety: ignores input focus & Cmd+C
const paletteMod = loadTsModule("src/components/shared/GlobalSearchPalette.tsx", {
  "./StockChartModal": { __esModule: true, default: () => null },
});

assert.equal(
  paletteMod.shouldIgnoreShortcut({ metaKey: true, ctrlKey: false, altKey: false, key: "c", target: { tagName: "DIV" } }),
  true,
  "Cmd+C must never be intercepted"
);
assert.equal(
  paletteMod.shouldIgnoreShortcut({ metaKey: false, ctrlKey: false, altKey: false, key: "f", target: { tagName: "INPUT" } }),
  true,
  "Keys while typing in INPUT must be ignored"
);
assert.equal(
  paletteMod.shouldIgnoreShortcut({ metaKey: false, ctrlKey: false, altKey: false, key: "f", target: { tagName: "DIV" } }),
  false
);

// 4. GlobalSearchPalette SSR render
const html = renderToString(
  React.createElement(paletteMod.default, { open: true, onOpenChange: () => {} })
);
assert.ok(html.includes("Search NSE liquid stocks"), "Palette must render search input");
assert.ok(html.includes("Enter open chart"), "Palette must show keyboard navigation hint");

// 5. Route contract checks (source=search in chart route & /api/stock-search)
const chartRouteSrc = fs.readFileSync(path.resolve("src/app/api/terminal/screener/chart/route.js"), "utf-8");
assert.ok(chartRouteSrc.includes('sourceParam === "search"'), "chart route must support source=search");
const searchRouteSrc = fs.readFileSync(path.resolve("src/app/api/stock-search/route.js"), "utf-8");
assert.ok(searchRouteSrc.includes("status: 400"), "stock-search route must return 400 on invalid q");

console.log("✓ Stock Search & Full-Screen Chart tests passed!");
