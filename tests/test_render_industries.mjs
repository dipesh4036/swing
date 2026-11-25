import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { transformSync } from "next/dist/build/swc/index.js";

console.log("--- Starting Industry Rotation SSR Render Test Suite (I5) ---");

function compileAndLoadComponent(filePath, mockRequire) {
  const code = fs.readFileSync(filePath, "utf8");
  const transformed = transformSync(code, {
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "classic" } },
    },
    module: { type: "commonjs" },
  });

  const moduleObj = { exports: {} };
  const fn = new Function("require", "module", "exports", "React", transformed.code);
  fn(mockRequire, moduleObj, moduleObj.exports, React);
  return moduleObj.exports.default || moduleObj.exports;
}

const mockLucide = new Proxy({}, {
  get: (target, prop) => {
    const Icon = (props) => React.createElement("svg", { "data-icon": prop, ...props });
    Icon.displayName = prop;
    return Icon;
  },
});

const mockRequire = (id) => {
  if (id === "react") return React;
  if (id === "lucide-react") return mockLucide;
  if (id.includes("treemap")) return {
    computeSquarifiedTreemap: (items, x, y, w, h) =>
      items.map((it, idx) => ({ ...it, x: x + idx * 100, y: y + idx * 50, width: 200, height: 100 })),
    getMetricColor: () => "#10B981",
    getMetricTextColor: () => "#FFFFFF",
  };
  if (id.includes("SectorRSChart")) {
    const MockChart = () => React.createElement("div", { "data-component": "SectorRSChart" });
    return { default: MockChart };
  }
  return {};
};

// Realistic Test Payloads
const mockIndustries = [
  {
    sector: "Capital Goods",
    basic_industry: "Heavy Electrical Equipment",
    n_stocks: 8,
    median_1d: 1.5,
    median_1w: 3.2,
    median_1m: 8.4,
    median_3m: 18.2,
    median_6m: 32.0,
    pct_above_50: 75.0,
    pct_above_200: 62.5,
    n_20d_high: 3,
    n_20d_low: 0,
    pct_leaders: 37.5,
    mcap_cr: 245000.5,
    rank: 1,
    rank_change: 2,
    tag: "Leading",
    quadrant: "leading",
    rs_x: 2.5,
    rs_y: 104.2,
  },
  {
    sector: "Financial Services",
    basic_industry: "Private Sector Bank",
    n_stocks: 6,
    median_1d: -0.4,
    median_1w: 1.1,
    median_1m: 4.5,
    median_3m: 9.8,
    median_6m: 14.2,
    pct_above_50: 66.7,
    pct_above_200: 50.0,
    n_20d_high: 1,
    n_20d_low: 1,
    pct_leaders: 16.7,
    mcap_cr: 1850000.0,
    rank: 2,
    rank_change: -1,
    tag: "Weakening",
    quadrant: "weakening",
    rs_x: -0.8,
    rs_y: 102.1,
  },
  // Small industry (<5 stocks, unranked)
  {
    sector: "Textiles",
    basic_industry: "Silk Textiles",
    n_stocks: 2,
    median_1d: null,
    median_1w: 0.5,
    median_1m: -2.1,
    median_3m: null,
    median_6m: null,
    pct_above_50: null,
    pct_above_200: null,
    n_20d_high: 0,
    n_20d_low: 1,
    pct_leaders: 0.0,
    mcap_cr: 1200.0,
    rank: null,
    rank_change: null,
    tag: "Lagging",
    quadrant: "lagging",
    rs_x: -1.5,
    rs_y: 96.4,
  },
];

const mockSectors = [
  {
    name: "Capital Goods",
    macro: "Industrials",
    n_stocks: 18,
    mcap_cr: 450000.0,
    median_1d: 1.2,
    median_1w: 2.8,
    median_1m: 7.5,
    median_3m: 15.0,
    pct_above_50: 72.2,
    pct_above_200: 61.1,
  },
  {
    name: "Financial Services",
    macro: "Financial Services",
    n_stocks: 11,
    mcap_cr: 2200000.0,
    median_1d: -0.2,
    median_1w: 0.9,
    median_1m: 4.1,
    median_3m: 8.5,
    pct_above_50: 63.6,
    pct_above_200: 54.5,
  },
];

const mockStocks = [
  {
    symbol: "ABB",
    name: "ABB India Limited",
    macro: "Industrials",
    sector: "Capital Goods",
    industry: "Electrical Equipment",
    basic_industry: "Heavy Electrical Equipment",
    close: 8250.0,
    ret_1d: 2.1,
    ret_1w: 4.5,
    ret_1m: 12.0,
    ret_3m: 24.5,
    ret_6m: 40.2,
    pct_from_52w_high: -3.5,
    above_20ema: true,
    above_50dma: true,
    above_200dma: true,
    stage: 2,
    vol_ratio: 1.8,
    avg_traded_value: 50000000,
    rs_rank: 88,
    screeners: ["stage2", "vcp"],
    mcap_cr: 174800.0,
    at_20d_high: true,
    at_20d_low: false,
    is_leader: true,
  },
  {
    symbol: "UNCLASSIFIED_STK",
    name: "Unclassified Company Ltd",
    macro: null,
    sector: "Unclassified",
    industry: null,
    basic_industry: "Silk Textiles",
    close: 150.0,
    ret_1d: -1.2,
    ret_1w: -2.5,
    ret_1m: -5.0,
    ret_3m: null,
    ret_6m: null,
    pct_from_52w_high: -25.0,
    above_20ema: false,
    above_50dma: false,
    above_200dma: null,
    stage: 4,
    vol_ratio: 0.5,
    avg_traded_value: 500000,
    rs_rank: 22,
    screeners: [],
    mcap_cr: null, // Null market cap test case
    at_20d_high: false,
    at_20d_low: true,
    is_leader: false,
  },
];

// 1. IndustryTableView SSR test
console.log("1. Testing IndustryTableView SSR render...");
const IndustryTableView = compileAndLoadComponent("src/components/sectors/IndustryTableView.jsx", mockRequire);
const tableHtml = renderToString(
  React.createElement(IndustryTableView, {
    industries: mockIndustries,
    sectors: mockSectors,
    selectedSector: "all",
    onSectorChange: () => {},
    onSelectIndustry: () => {},
  })
);
assert(tableHtml.includes("Heavy Electrical Equipment"), "Must render industry name");
assert(tableHtml.includes("Leading"), "Must render tag");
assert(tableHtml.includes("Rank"), "Must render Rank header");
console.log("✓ IndustryTableView rendered successfully");

// 2. IndustryDetailDrawer SSR test
console.log("2. Testing IndustryDetailDrawer SSR render...");
const IndustryDetailDrawer = compileAndLoadComponent("src/components/sectors/IndustryDetailDrawer.jsx", mockRequire);
const drawerHtml = renderToString(
  React.createElement(IndustryDetailDrawer, {
    industry: mockIndustries[0],
    allStocks: mockStocks,
    asOf: "2026-11-23",
    onClose: () => {},
    onSelectStock: () => {},
  })
);
assert(drawerHtml.includes("Heavy Electrical Equipment"), "Must render industry title");
assert(drawerHtml.includes("ABB"), "Must render constituent stock symbol");
assert(drawerHtml.includes("Leader"), "Must render Leader badge for leader stock");
console.log("✓ IndustryDetailDrawer rendered successfully");

// 3. IndustryTreeMap SSR test
console.log("3. Testing IndustryTreeMap SSR render...");
const IndustryTreeMap = compileAndLoadComponent("src/components/sectors/IndustryTreeMap.jsx", mockRequire);
const treemapHtml = renderToString(
  React.createElement(IndustryTreeMap, {
    sectors: mockSectors,
    industries: mockIndustries,
    stocks: mockStocks,
    metric: "1m",
    onMetricChange: () => {},
    onSelectIndustry: () => {},
    onSelectStock: () => {},
  })
);
assert(treemapHtml.includes("<svg"), "Must render SVG treemap canvas");
assert(treemapHtml.includes("Capital Goods"), "Must render sector block label");
console.log("✓ IndustryTreeMap rendered successfully");

// 4. IndustryScatterPlot SSR test
console.log("4. Testing IndustryScatterPlot SSR render...");
const IndustryScatterPlot = compileAndLoadComponent("src/components/sectors/IndustryScatterPlot.jsx", mockRequire);
const scatterHtml = renderToString(
  React.createElement(IndustryScatterPlot, {
    industries: mockIndustries,
    selectedSector: "all",
    onSectorChange: () => {},
    onSelectIndustry: () => {},
  })
);
assert(scatterHtml.includes("LEADING"), "Must render Leading quadrant watermark");
assert(scatterHtml.includes("<circle"), "Must render scatter point circles");
console.log("✓ IndustryScatterPlot rendered successfully");

// 5. IndustryStockExplorerView SSR test
console.log("5. Testing IndustryStockExplorerView SSR render...");
const IndustryStockExplorerView = compileAndLoadComponent("src/components/sectors/IndustryStockExplorerView.jsx", mockRequire);
const explorerHtml = renderToString(
  React.createElement(IndustryStockExplorerView, {
    stocks: mockStocks,
    industries: mockIndustries,
    sectors: mockSectors,
    onSelectStock: () => {},
  })
);
assert(explorerHtml.includes("ABB"), "Must render stock row ABB");
assert(explorerHtml.includes("UNCLASSIFIED_STK"), "Must render unclassified stock cleanly");
assert(explorerHtml.includes("—"), "Must render dash for null mcap");
console.log("✓ IndustryStockExplorerView rendered successfully");

console.log("--- All Industry Rotation SSR Render Tests Passed! ---");
