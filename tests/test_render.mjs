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
  assert.ok(html.includes("All Stocks"), "ScreenerPage must contain 'All Stocks'");
  assert.ok(html.includes("Chart View"), "ScreenerPage must contain 'Chart View' instead of Nifty 500");
}, "ScreenerPage must render without throwing");
console.log("✓ ScreenerPage rendered successfully with 'All Stocks' and 'Chart View'");

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
  if (id === "@/lib/patterns") {
    return {
      detectPatterns: () => ({ patterns: [] }),
    };
  }
  if (id === "@/components/charts/patternLayers") {
    return {
      PatternSeriesPrimitive: class MockPatternPrimitive {},
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
// 4. SectorRotationPage & Components Smoke Tests (T11)
// -----------------------------------------------------------------------------
console.log("4. Testing SectorRotationPage and Tab 3 components renderToString...");

const sectorMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "next/dynamic") return (importer) => mockComponent("DynamicComponent");
  if (id === "next/link") {
    return ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
  }
  if (id === "next/navigation") {
    return {
      useRouter: () => ({ push: () => {}, replace: () => {} }),
      useSearchParams: () => new URLSearchParams("view=map&metric=1m"),
    };
  }
  if (id === "@/components/industry-strength/SectorDashboard") {
    return () => React.createElement("div", { id: "mock-sector-dashboard" }, "Industries Relative Strength");
  }
  if (id === "@/components/sectors/SectorTreeMap" || id === "@/components/sectors/IndustryTreeMap") {
    return ({ sectors, industries, stocks }) => React.createElement("div", { id: "mock-treemap" }, `Treemap with ${(sectors || industries)?.length || 0} items, ${stocks?.length || 0} stocks`);
  }
  if (id === "@/components/sectors/SectorScatterPlot" || id === "@/components/sectors/IndustryScatterPlot") {
    return ({ sectors, industries }) => React.createElement("div", { id: "mock-scatter" }, `Scatter with ${(sectors || industries)?.length || 0} items`);
  }
  if (id === "@/components/sectors/SectorTableView" || id === "@/components/sectors/IndustryTableView") {
    return ({ sectors, industries }) => React.createElement("div", { id: "mock-table" }, `Table with ${(sectors || industries)?.length || 0} items`);
  }
  if (id === "@/components/sectors/StockExplorerView" || id === "@/components/sectors/IndustryStockExplorerView") {
    return ({ stocks }) => React.createElement("div", { id: "mock-explorer" }, `Explorer with ${stocks?.length || 0} stocks`);
  }
  if (id === "@/components/industry-strength/StockDetailPanel") {
    return ({ stock }) => React.createElement("div", { id: "mock-detail" }, `Detail for ${stock?.symbol}`);
  }
  if (id === "@/components/sectors/IndustryDetailDrawer") {
    return ({ industry }) => React.createElement("div", { id: "mock-drawer" }, `Drawer for ${industry?.industry}`);
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
  assert.ok(html.includes("Sector Rotation") || html.includes("Industries"));
}, "SectorRotationPage must render without throwing");
console.log("✓ SectorRotationPage rendered successfully with 'Industries'");

// -----------------------------------------------------------------------------
// 5. V1: Real Component Render Tests (ScreenerChart, StockDetailPanel, PatternDetailPanel, PatternLayersBar)
// -----------------------------------------------------------------------------
console.log("5. Testing V1 real chart and pattern components renderToString...");

// Import real underlying modules for maximum fidelity
import { detectPatterns } from "../src/lib/patterns/index.js";
import { attachEMAs, aggregateWeekly } from "../src/lib/indicators.js";
import { formatPatternDate, describePattern } from "../src/lib/patterns/explain.js";
import { PatternSeriesPrimitive } from "../src/components/charts/patternLayers.js";

// Common realistic 260-candle daily dataset
const realistic260Candles = Array.from({ length: 260 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  const base = 500 + Math.sin(i / 15) * 50;
  return {
    date: d.toISOString().split("T")[0],
    open: base,
    high: base + 5,
    low: base - 5,
    close: base + 2,
    volume: 100000 + (i % 10) * 10000,
  };
});

const chartMockRequire = (id) => {
  if (id === "react") return React;
  if (id === "lightweight-charts") {
    return {
      createChart: () => ({
        addSeries: () => ({
          setData: () => {},
          applyOptions: () => {},
          createPriceLine: () => ({ applyOptions: () => {} }),
          attachPrimitive: () => {},
        }),
        priceScale: () => ({ applyOptions: () => {} }),
        timeScale: () => ({ fitContent: () => {}, applyOptions: () => {}, logicalToCoordinate: (idx) => idx }),
        applyOptions: () => {},
        remove: () => {},
        subscribeCrosshairMove: () => {},
        unsubscribeCrosshairMove: () => {},
      }),
      CandlestickSeries: {},
      LineSeries: {},
      HistogramSeries: {},
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
    };
  }
  if (id === "lucide-react") {
    return new Proxy({}, {
      get: (_, prop) => () => React.createElement("span", { "data-icon": String(prop) })
    });
  }
  if (id === "@/lib/indicators") {
    return { attachEMAs, aggregateWeekly };
  }
  if (id === "@/lib/patterns") {
    return { detectPatterns };
  }
  if (id === "@/lib/patterns/explain") {
    return { formatPatternDate, describePattern };
  }
  if (id === "@/components/charts/patternLayers") {
    return { PatternSeriesPrimitive };
  }
  if (id === "@/components/charts/PatternLayersBar") {
    return {
      __esModule: true,
      get PatternLayersBar() { return RealPatternLayersBar; },
      get default() { return RealPatternLayersBar; },
    };
  }
  if (id === "@/components/charts/PatternDetailPanel") {
    return {
      __esModule: true,
      get PatternDetailPanel() { return RealPatternDetailPanel; },
      get default() { return RealPatternDetailPanel; },
    };
  }
  return {
    default: mockComponent(id),
    __esModule: true,
  };
};

// 5a. PatternLayersBar
const RealPatternLayersBar = compileAndLoadComponent(
  "src/components/charts/PatternLayersBar.jsx",
  chartMockRequire
).PatternLayersBar;

assert.doesNotThrow(() => {
  const htmlDaily = renderToString(React.createElement(RealPatternLayersBar, {
    layers: { patternLines: true, breakoutRetest: true, basePivot: true, ema_21: false },
    onToggleLayer: () => {},
    counts: { patternLines: 3, breakoutRetest: 1, basePivot: 1 },
    timeframe: "D",
    offscreenCount: 2,
  }));
  assert.ok(htmlDaily.includes("Pattern lines"));
  assert.ok(htmlDaily.includes("Breakout + retest"));
  assert.ok(htmlDaily.includes("Base + pivot"));

  const htmlWeekly = renderToString(React.createElement(RealPatternLayersBar, {
    layers: { patternLines: false, breakoutRetest: false, basePivot: false, ema_21: false },
    onToggleLayer: () => {},
    counts: {},
    timeframe: "W",
  }));
  assert.ok(htmlWeekly.includes("opacity-40 cursor-not-allowed"));
}, "PatternLayersBar must render in both daily and weekly timeframe modes");
console.log("✓ PatternLayersBar rendered successfully (timeframe D & W)");

// 5b. PatternDetailPanel
const RealPatternDetailPanel = compileAndLoadComponent(
  "src/components/charts/PatternDetailPanel.jsx",
  chartMockRequire
).PatternDetailPanel;

assert.doesNotThrow(() => {
  // Empty state with reason
  const htmlEmpty = renderToString(React.createElement(RealPatternDetailPanel, {
    patterns: [],
    reason: "insufficient_history",
  }));
  assert.ok(htmlEmpty.includes("Not enough daily history"));

  // With realistic active patterns and historical pattern
  const samplePatterns = [
    {
      id: "pat_1",
      type: "ascending_triangle",
      title: "Ascending triangle",
      status: "broke_out",
      lines: [{ role: "upper_resistance", p1: 520, p2: 520, idx1: 100, idx2: 200, touches: [{ date: "2026-05-01", price: 520 }] }],
      window: { start_date: "2026-04-01", end_date: "2026-08-01", found_date: "2026-08-01" },
      metrics: { span_bars: 50, touches: 4, atr_beyond: 0.8 },
      events: [{ type: "breakout", date: "2026-08-01", price: 525 }],
      summary: "Ascending triangle breakout test summary",
      rule_text: "Rule text for triangle",
    },
    {
      id: "pat_hist",
      type: "horizontal_ceiling",
      title: "Horizontal ceiling",
      status: "historical",
      lines: [{ role: "resistance", p1: 480, p2: 480, idx1: 20, idx2: 80, touches: [{ date: "2026-02-01", price: 480 }] }],
      window: { start_date: "2026-01-15", end_date: "2026-03-20", found_date: "2026-03-20" },
      metrics: { span_bars: 40, touches: 3, atr_beyond: 2.5 },
      events: [],
      summary: "Historical ceiling summary",
      rule_text: "Rule text for ceiling",
    },
  ];

  const htmlActive = renderToString(React.createElement(RealPatternDetailPanel, {
    patterns: samplePatterns,
    focusedPatternId: "pat_1",
    onSelectPattern: () => {},
  }));
  assert.ok(htmlActive.includes("Ascending triangle"));
  assert.ok(htmlActive.includes("Broke out"));
  assert.ok(htmlActive.includes("Other patterns:"));
  assert.ok(htmlActive.includes("ended 20 Mar 2026"));

  // Focused on historical pattern
  const htmlHistFocused = renderToString(React.createElement(RealPatternDetailPanel, {
    patterns: samplePatterns,
    focusedPatternId: "pat_hist",
    onSelectPattern: () => {},
  }));
  assert.ok(htmlHistFocused.includes("Horizontal ceiling"));
  assert.ok(htmlHistFocused.includes("Historical"));
}, "PatternDetailPanel must render empty, active, and historical patterns cleanly");
console.log("✓ PatternDetailPanel rendered successfully (empty, active, historical)");

// 5c. ScreenerChart
const RealScreenerChart = compileAndLoadComponent(
  "src/components/screener/ScreenerChart.jsx",
  chartMockRequire
);

assert.doesNotThrow(() => {
  // Case 1: 260 daily candles with overlay and patterns
  const html260 = renderToString(React.createElement(RealScreenerChart, {
    stockData: {
      symbol: "TESTSTK",
      candles: realistic260Candles,
      overlay: {
        pivot: 520,
        rules: ["above_50dma", "rs_rank_leader"],
      },
    },
    screenerId: "stage2_breakout",
    loading: false,
    error: null,
  }));
  assert.ok(typeof html260 === "string" && html260.length > 0);
  assert.ok(html260.includes("Pattern lines"));
  assert.ok(html260.includes("EMA 10"));

  // Case 2: Short / empty candles
  const htmlEmpty = renderToString(React.createElement(RealScreenerChart, {
    stockData: { symbol: "EMPTY", candles: [] },
    screenerId: "stage2_breakout",
  }));
  assert.ok(typeof htmlEmpty === "string");

  // Case 3: 10 short candles
  const htmlShort = renderToString(React.createElement(RealScreenerChart, {
    stockData: { symbol: "SHORT", candles: realistic260Candles.slice(0, 10) },
    screenerId: "stage2_breakout",
  }));
  assert.ok(typeof htmlShort === "string");
}, "ScreenerChart must render 260 daily candles, overlay, and edge cases without error");
console.log("✓ ScreenerChart rendered successfully (260 bars, overlay, short/empty)");

// 5d. StockDetailPanel
const RealStockDetailPanel = compileAndLoadComponent(
  "src/components/industry-strength/StockDetailPanel.jsx",
  chartMockRequire
);

assert.doesNotThrow(() => {
  const sampleStock = {
    token: 5001,
    symbol: "SECTORSTK",
    name: "Sector Stock Limited",
    sector: "bank",
    close: 1450.5,
    ret_1d: 2.1,
    ret_1w: 4.5,
    ret_1m: 12.3,
    ret_3m: 25.4,
    ret_6m: 40.1,
    pct_from_52w_high: -3.2,
    rs_rank: 89,
    leader: true,
    above_50dma: true,
    above_200dma: true,
    stage: 2,
    vol_ratio: 1.8,
    screeners: ["near_pivot", "stage2_breakout"],
  };

  const htmlStockPanel = renderToString(React.createElement(RealStockDetailPanel, {
    stock: sampleStock,
    onClose: () => {},
    onShowSector: () => {},
    isDark: true,
  }));
  assert.ok(htmlStockPanel.includes("SECTORSTK"));
  assert.ok(htmlStockPanel.includes("Sector Stock Limited"));
  assert.ok(htmlStockPanel.includes("RS Rank"));
  assert.ok(htmlStockPanel.includes("89"));
  assert.ok(htmlStockPanel.includes("stage2 breakout"));
}, "StockDetailPanel must render sector stock detail with technicals and screener tags");
console.log("✓ StockDetailPanel rendered successfully");

// Restore fetch
globalThis.fetch = originalFetch;

console.log("All Render Smoke Tests Passed Successfully!");
