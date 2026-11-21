import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import { transformSync } from "next/dist/build/swc/index.js";

console.log("--- Starting Render Smoke Test Suite (R23) ---");

// Helper to compile JSX to CJS via Next SWC and evaluate in a sandboxed module
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

// -----------------------------------------------------------------------------
// 1. MarketBreadthDashboardPage Smoke Test
// -----------------------------------------------------------------------------
console.log("1. Testing MarketBreadthDashboardPage renderToString...");

const mockBreadthState = {
  isLoading: false,
  error: null,
  asOfDate: "2026-11-20",
  lastUpdatedAt: "2026-11-20T17:00:00Z",
  coverage: { total: 2500, active: 2500, pct: 100 },
  keyMetrics: { advances: 1200, declines: 1000 },
  history: [{ date: "2026-11-20", advances: 1200, declines: 1000 }],
  marketRead: { label: "Neutral", score: 50 },
  participationData: [],
  participationStats: {},
  stageComparisonData: [],
  institutionalFlows: { fii: { net: 100 }, dii: { net: 200 } },
  highsLows: { highs: 50, lows: 10 },
  formattedIndices: [],
  performance: { large: { "1M": 2.5 }, mid: { "1M": 1.5 }, small: { "1M": -0.5 } },
  rebasedSeries: { large: [], mid: [], small: [] },
  capSeries: { large: [], mid: [], small: [] },
  data: {
    capSeries: { large: [], mid: [], small: [] },
    asOfDate: "2026-11-20",
    lastUpdatedAt: "2026-11-20T17:00:00Z",
  },
};

const mockComponent = (name) => {
  const Comp = (props) => React.createElement("div", { "data-component": name }, props.children);
  Comp.displayName = name;
  return Comp;
};

const dashboardMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "@/hooks/useMarketBreadth") {
    return { useMarketBreadth: () => mockBreadthState };
  }
  if (id === "@/lib/freshness") {
    return { isDataStale: () => false };
  }
  if (id === "lucide-react") {
    return {
      AlertTriangle: () => React.createElement("span", null, "[!]"),
      RefreshCw: () => React.createElement("span", null, "[R]"),
    };
  }
  // All mock child components
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

const MarketBreadthDashboardPage = compileAndLoadComponent(
  "src/app/(terminal)/page.jsx",
  dashboardMockRequire
);

assert.doesNotThrow(() => {
  const html = renderToString(React.createElement(MarketBreadthDashboardPage));
  assert.ok(typeof html === "string" && html.length > 0);
  assert.ok(html.includes("data-component"));
}, "MarketBreadthDashboardPage must render without throwing");
console.log("✓ MarketBreadthDashboardPage rendered successfully");

// -----------------------------------------------------------------------------
// 2. ScreenerPage Smoke Test
// -----------------------------------------------------------------------------
console.log("2. Testing ScreenerPage renderToString...");

// Mock global fetch
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ rows: [], as_of_date: "2026-11-20" }),
});

const screenerMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "next/dynamic") {
    return (loader, options) => {
      const DynamicComp = (props) => React.createElement("div", { "data-dynamic": "true" }, props.children);
      return DynamicComp;
    };
  }
  if (id === "@/lib/freshness") {
    return { isDataStale: () => false };
  }
  if (id === "lucide-react") {
    return {
      Layers: () => React.createElement("span", null, "[L]"),
      Info: () => React.createElement("span", null, "[i]"),
      ChevronLeft: () => React.createElement("span", null, "[<]"),
      RefreshCw: () => React.createElement("span", null, "[R]"),
      Search: () => React.createElement("span", null, "[S]"),
      X: () => React.createElement("span", null, "[X]"),
      AlertTriangle: () => React.createElement("span", null, "[!]"),
    };
  }
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

const ScreenerPage = compileAndLoadComponent(
  "src/app/(terminal)/screener/page.jsx",
  screenerMockRequire
);

assert.doesNotThrow(() => {
  const html = renderToString(React.createElement(ScreenerPage));
  assert.ok(typeof html === "string" && html.length > 0);
  assert.ok(html.includes("List View"), "ScreenerPage must contain 'List View'");
  assert.ok(html.includes("Chart View"), "ScreenerPage must contain 'Chart View' instead of Nifty 500");
}, "ScreenerPage must render without throwing");
console.log("✓ ScreenerPage rendered successfully with 'List View' and 'Chart View'");

// -----------------------------------------------------------------------------
// 3. ScreenerGrid Smoke Test
// -----------------------------------------------------------------------------
console.log("3. Testing ScreenerGrid renderToString...");

const gridMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "lightweight-charts") {
    return {
      createChart: () => ({
        addSeries: () => ({
          setData: () => {},
          applyOptions: () => {},
          createPriceLine: () => ({ applyOptions: () => {} }),
        }),
        priceScale: () => ({ applyOptions: () => {} }),
        timeScale: () => ({ fitContent: () => {}, applyOptions: () => {} }),
        applyOptions: () => {},
        remove: () => {},
      }),
      CandlestickSeries: {},
      LineSeries: {},
      HistogramSeries: {},
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    };
  }
  if (id === "lucide-react") {
    return {
      ExternalLink: () => React.createElement("span", null, "[↗]"),
      RefreshCw: () => React.createElement("span", null, "[↻]"),
    };
  }
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

const ScreenerGridComponent = compileAndLoadComponent(
  "src/components/screener/ScreenerGrid.jsx",
  gridMockRequire
);

const sampleStocks = [
  {
    token: 101,
    symbol: "TESTSTK1",
    close: 450.5,
    ret_1d_pct: 3.2,
    rs_rank: 85,
    vol_ratio: 2.1,
    dist_to_pivot_pct: -0.015,
  },
  {
    token: 102,
    symbol: "TESTSTK2",
    close: 1200.0,
    ret_1d_pct: -1.5,
    rs_rank: 72,
    vol_ratio: 1.4,
    stage: 2,
  },
];

const sampleCandles = {
  101: [
    { date: "2026-11-18", open: 430, high: 440, low: 425, close: 435, volume: 10000, ema_10: 432 },
    { date: "2026-11-19", open: 435, high: 452, low: 434, close: 450.5, volume: 25000, ema_10: 435 },
  ],
  102: [],
};

assert.doesNotThrow(() => {
  const gridHtml = renderToString(
    React.createElement(ScreenerGridComponent, {
      stocks: sampleStocks,
      candlesByToken: sampleCandles,
      loading: false,
      activeScreener: "stage2_breakout",
      onSelectStock: () => {},
    })
  );
  assert.ok(typeof gridHtml === "string" && gridHtml.length > 0);
  assert.ok(gridHtml.includes("TESTSTK1"));
  assert.ok(gridHtml.includes("TESTSTK2"));
  assert.ok(gridHtml.includes("Chart View (Fast Scan)"));
}, "ScreenerGrid must render candidate stock cards without throwing");
console.log("✓ ScreenerGrid rendered successfully with fast scan candidate cards");

// -----------------------------------------------------------------------------
// 4. SectorRotationPage Smoke Test
// -----------------------------------------------------------------------------
console.log("4. Testing SectorRotationPage renderToString...");

const sectorMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "next/dynamic") return (importer) => mockComponent("DynamicComponent");
  if (id === "next/link") {
    return ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
  }
  if (id === "@/components/sectors/SectorScatterPlot") {
    return ({ sectors }) => React.createElement("div", { id: "mock-scatter" }, `Scatter with ${sectors?.length || 0} sectors`);
  }
  if (id === "lucide-react") {
    return new Proxy({}, {
      get: (_, prop) => () => React.createElement("span", { "data-icon": String(prop) })
    });
  }
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

const SectorRotationPage = compileAndLoadComponent(
  "src/app/(terminal)/sectors/page.jsx",
  sectorMockRequire
);

assert.doesNotThrow(() => {
  const html = renderToString(React.createElement(SectorRotationPage));
  assert.ok(typeof html === "string" && html.length > 0);
  assert.ok(html.includes("Sector Rotation"));
  assert.ok(html.includes("Where is money moving?"));
}, "SectorRotationPage must render without throwing");
console.log("✓ SectorRotationPage rendered successfully with 'Sector Rotation' and 'Where is money moving?'");

// Restore fetch
globalThis.fetch = originalFetch;

console.log("All Render Smoke Tests Passed Successfully!");
