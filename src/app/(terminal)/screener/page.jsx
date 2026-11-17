"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Layers,
  Info,
  ChevronLeft,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

// Load lightweight-charts chart via dynamic import with ssr: false
const ScreenerChart = dynamic(
  () => import("@/components/screener/ScreenerChart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white text-[#64748B] text-sm">
        <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3" />
        <span>Loading chart module...</span>
      </div>
    ),
  }
);

const SCREENER_INFO = {
  stage2_breakout: {
    name: "Stage 2 Breakout",
    short: "Breakout",
    desc: "Stage 2 uptrend stocks breaking out of a 20-session pivot on >=1.5x average volume and not extended (>5%).",
    rules: [
      "Passes 8-rule Trend Template & Stage 2",
      "New 20-session high breakout today",
      "Not extended: close <= 1.05x pivot",
      "Closing in upper 40% of day's range",
      "Volume >= 1.5x 50-day average volume",
    ],
  },
  vcp: {
    name: "VCP",
    short: "VCP",
    desc: "Volatility Contraction Pattern: 3 consecutive 15-day tightening contractions near 52W high with volume dry-up.",
    rules: [
      "Passes 8-rule Trend Template & within 15% of 52W high",
      "Above 50 SMA & within 5% of 20-session pivot",
      "3 contracting 15-session windows: depth w1 > w2 > w3",
      "w3 contraction range <= 10%",
      "Volume dry-up: 10-day avg volume <= 0.85x 50-day avg",
    ],
  },
  near_pivot: {
    name: "Near Pivot",
    short: "Near Pivot",
    desc: "Trend Template stocks consolidating within 3% below their 20-session pivot resistance.",
    rules: [
      "Passes 8-rule Trend Template",
      "Within 3% below 20-session high pivot",
      "Tradable: close >= ₹20, avg volume >= 25k, traded value >= ₹1 Cr",
    ],
  },
  ipo_base: {
    name: "IPO Base",
    short: "IPO Base",
    desc: "Recent IPOs (listed < 365 days) building a tight primary consolidation base within 10% of listing high.",
    rules: [
      "Listed within the last 365 days (>= 15 trading sessions)",
      "Above 20 EMA with average volume >= 25,000",
      "Base depth <= 35% from listing high",
      "Close within 10% of listing high",
      "10-session range tightness <= 12%",
    ],
  },
  ema50_pullback: {
    name: "50 EMA Pullback",
    short: "50 EMA Pullback",
    desc: "Stage 2 stocks pulling back on quiet volume to test a rising 50 EMA after an extension >=8%.",
    rules: [
      "Passes 8-rule Trend Template",
      "50 EMA rising over last 10 sessions",
      "Touched 50 EMA: low <= 1.02x 50 EMA",
      "Held 50 EMA: close >= 0.99x 50 EMA",
      "Prior extension >= 1.08x 50 EMA in last 15 sessions",
      "Quiet volume: volume <= 50-day average volume",
    ],
  },
};

const SCREENERS_LIST = [
  "stage2_breakout",
  "vcp",
  "near_pivot",
  "ipo_base",
  "ema50_pullback",
];

export default function ScreenerPage() {
  const [universe, setUniverse] = useState("all"); // "all" | "nifty500"
  const [activeScreener, setActiveScreener] = useState("stage2_breakout");
  const [screenerData, setScreenerData] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChart, setLoadingChart] = useState(false);
  const [listError, setListError] = useState(null);
  const [chartError, setChartError] = useState(null);
  const [sortBy, setSortBy] = useState("default");
  const [showRuleInfo, setShowRuleInfo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileView, setMobileView] = useState("list"); // "list" | "chart"

  // 1. Fetch Screener Candidate List
  const fetchScreenerList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/terminal/screener?screener=${activeScreener}&universe=${universe}`
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      setScreenerData(data);

      // Preserve currently selected stock if it exists in new list, else select first
      if (data.rows && data.rows.length > 0) {
        setSelectedStock((prev) => {
          if (prev && data.rows.some((r) => r.token === prev.token)) {
            return prev;
          }
          return data.rows[0];
        });
      } else {
        setSelectedStock(null);
        setChartData(null);
      }
    } catch (err) {
      console.error("Failed to load screener data:", err);
      setListError(err.message || "Failed to load screener candidates");
    } finally {
      setLoadingList(false);
    }
  }, [activeScreener, universe]);

  useEffect(() => {
    fetchScreenerList();
  }, [fetchScreenerList]);

  // 2. Fetch Selected Stock Chart Data
  useEffect(() => {
    if (!selectedStock) {
      setChartData(null);
      return;
    }

    // Guard against race conditions when switching screener tabs or universes
    if (screenerData?.rows && !screenerData.rows.some((r) => r.token === selectedStock.token)) {
      return;
    }

    let isMounted = true;
    setLoadingChart(true);
    setChartError(null);

    async function loadChart() {
      try {
        const res = await fetch(
          `/api/terminal/screener/chart?token=${selectedStock.token}&screener=${activeScreener}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP error ${res.status}`);
        }
        const data = await res.json();
        if (isMounted) {
          setChartData(data);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to load chart data:", err);
          setChartError(err.message || "Failed to load chart candles");
        }
      } finally {
        if (isMounted) {
          setLoadingChart(false);
        }
      }
    }

    loadChart();
    return () => {
      isMounted = false;
    };
  }, [selectedStock, activeScreener]);

  // Filter & Sort Candidate Rows
  const displayedRows = useMemo(() => {
    if (!screenerData?.rows) return [];
    let list = [...screenerData.rows];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((r) => r.symbol.toLowerCase().includes(q));
    }

    if (sortBy !== "default") {
      list.sort((a, b) => {
        let vA, vB;
        switch (sortBy) {
          case "rs_desc":
            vA = a.rs_rank; vB = b.rs_rank;
            if (vA === null || vA === undefined) return 1;
            if (vB === null || vB === undefined) return -1;
            return vB - vA;
          case "ret_1d_desc":
            vA = a.ret_1d_pct; vB = b.ret_1d_pct;
            if (vA === null || vA === undefined) return 1;
            if (vB === null || vB === undefined) return -1;
            return vB - vA;
          case "vol_desc":
            vA = a.vol_ratio; vB = b.vol_ratio;
            if (vA === null || vA === undefined) return 1;
            if (vB === null || vB === undefined) return -1;
            return vB - vA;
          case "symbol_asc":
            return (a.symbol || "").localeCompare(b.symbol || "");
          case "price_desc":
            vA = a.close; vB = b.close;
            if (vA === null || vA === undefined) return 1;
            if (vB === null || vB === undefined) return -1;
            return vB - vA;
          case "pivot_dist_asc":
            vA = a.dist_to_pivot_pct; vB = b.dist_to_pivot_pct;
            if (vA === null || vA === undefined) return 1;
            if (vB === null || vB === undefined) return -1;
            return vA - vB;
          default:
            return 0;
        }
      });
    }

    return list;
  }, [screenerData?.rows, searchQuery, sortBy]);

  const counts = screenerData?.counts || {};
  const currentInfo = SCREENER_INFO[activeScreener];
  const isMarketCautious =
    screenerData?.regime &&
    ["UPTREND_UNDER_PRESSURE", "CORRECTION", "RALLY_ATTEMPT"].includes(
      screenerData.regime
    );

  return (
    <div className="flex flex-col h-full lg:h-screen lg:max-h-screen bg-[#F8FAFC] overflow-hidden">
      {/* ── Top Header Section (Fixed Height) ───────────────────────── */}
      <div className="bg-white border-b border-[#E5EAF2] shrink-0">
        {/* Top Bar: Title & Controls */}
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[6px] bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center font-bold">
              <Layers size={16} />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[#17233B] tracking-tight">
                Stock Screener
              </h1>
              {screenerData?.asOf && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-[4px] bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]">
                  As of {screenerData.asOf}
                </span>
              )}
            </div>
          </div>

          {/* Right Controls: All / 500 toggle, Refresh, Rules & Details */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-[6px] border border-[#CBD5E1] p-0.5 bg-[#F8FAFC] text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  if (universe !== "all") {
                    setSelectedStock(null);
                    setChartData(null);
                    setUniverse("all");
                  }
                }}
                className={`px-2.5 py-1 rounded-[4px] transition-colors ${
                  universe === "all"
                    ? "bg-[#2563EB] text-white shadow-2xs"
                    : "text-[#64748B] hover:text-[#17233B]"
                }`}
              >
                All Stocks
              </button>
              <button
                type="button"
                onClick={() => {
                  if (universe !== "nifty500") {
                    setSelectedStock(null);
                    setChartData(null);
                    setUniverse("nifty500");
                  }
                }}
                className={`px-2.5 py-1 rounded-[4px] transition-colors ${
                  universe === "nifty500"
                    ? "bg-[#2563EB] text-white shadow-2xs"
                    : "text-[#64748B] hover:text-[#17233B]"
                }`}
              >
                Nifty 500
              </button>
            </div>

            <button
              type="button"
              onClick={fetchScreenerList}
              className="p-1.5 rounded-[6px] border border-[#E2E8F0] text-[#64748B] hover:text-[#17233B] hover:bg-[#F1F5F9] transition-colors"
              title="Refresh screener data"
            >
              <RefreshCw size={14} className={loadingList ? "animate-spin" : ""} />
            </button>

            <button
              type="button"
              onClick={() => setShowRuleInfo(!showRuleInfo)}
              className={`text-xs flex items-center gap-1 px-2.5 py-1 rounded-[6px] border transition-colors ${
                showRuleInfo
                  ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB]"
                  : "bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#17233B]"
              }`}
            >
              <Info size={13} />
              <span className="hidden sm:inline">Rules & Details</span>
            </button>
          </div>
        </div>

        {/* Screener Tabs Bar */}
        <div className="px-4 flex items-center gap-1 overflow-x-auto no-scrollbar pb-2">
          {SCREENERS_LIST.map((id) => {
            const info = SCREENER_INFO[id];
            const count = counts[id] || 0;
            const isActive = activeScreener === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (activeScreener !== id) {
                    setSelectedStock(null);
                    setChartData(null);
                    setActiveScreener(id);
                    setMobileView("list");
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-all border whitespace-nowrap ${
                  isActive
                    ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB] shadow-2xs"
                    : "bg-white border-[#E2E8F0] text-[#64748B] hover:border-[#CBD5E1] hover:text-[#17233B]"
                }`}
              >
                <span>{info.short}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isActive
                      ? "bg-[#2563EB] text-white"
                      : "bg-[#F1F5F9] text-[#64748B]"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Slim Single-Line Market Regime Banner */}
        {screenerData?.regime && (
          <div className="px-4 py-1.5 border-t border-[#F1F5F9] bg-[#FAFAFA] flex items-center justify-between text-xs text-[#64748B]">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 inline-block ${
                  isMarketCautious ? "bg-[#F59E0B]" : "bg-[#16A34A]"
                }`}
              />
              <span className="truncate">
                Market regime: <strong className="text-[#17233B]">{screenerData.regime}</strong>
                {isMarketCautious
                  ? " — Distribution detected; breakout setups have lower follow-through."
                  : " — Uptrend intact; momentum setups aligned with market direction."}
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#94A3B8] shrink-0 hidden md:inline">
              Nifty 500 Breadth
            </span>
          </div>
        )}
      </div>

      {/* ── Rules & Details Drawer (Collapsible) ───────────────────── */}
      {showRuleInfo && currentInfo && (
        <div className="bg-white border-b border-[#E5EAF2] p-4 text-xs shrink-0 shadow-xs relative">
          <button
            type="button"
            onClick={() => setShowRuleInfo(false)}
            className="absolute top-3 right-3 text-[#94A3B8] hover:text-[#17233B] p-1"
            title="Close rules"
          >
            <X size={15} />
          </button>
          <div className="mb-1">
            <span className="font-bold text-sm text-[#17233B] mr-2">
              {currentInfo.name} Criteria
            </span>
            <span className="text-[10px] text-[#94A3B8] font-mono">
              Source: SCREENER_PARAMS
            </span>
          </div>
          <p className="text-[#64748B] mb-2.5 max-w-3xl">{currentInfo.desc}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {currentInfo.rules.map((rule, idx) => (
              <div
                key={idx}
                className="flex items-start gap-1.5 p-2 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569]"
              >
                <span className="text-[#2563EB] font-bold">✓</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Workspace: Two-Column Full-Height Layout ───────────── */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT COLUMN: Stock Candidate List (Fixed 320px on Desktop) */}
        <div
          className={`w-full lg:w-[320px] lg:shrink-0 flex flex-col border-r border-[#E5EAF2] bg-white h-full overflow-hidden ${
            mobileView === "chart" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Controls: Search filter & Sort Dropdown */}
          <div className="p-2.5 border-b border-[#E5EAF2] bg-[#FAFAFA] flex flex-col gap-2 shrink-0">
            <div className="relative w-full">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"
              />
              <input
                type="text"
                placeholder="Filter symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-xs rounded-[5px] border border-[#CBD5E1] bg-white focus:outline-hidden focus:border-[#2563EB]"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-[11px] font-medium text-[#475569] bg-white border border-[#CBD5E1] rounded-[4px] px-2 py-0.5 focus:outline-hidden focus:border-[#2563EB] cursor-pointer"
              >
                <option value="default">Sort: Default</option>
                <option value="rs_desc">Sort: RS Rank (High)</option>
                <option value="ret_1d_desc">Sort: 1D % (High)</option>
                <option value="vol_desc">Sort: Vol Ratio (High)</option>
                <option value="symbol_asc">Sort: Symbol (A-Z)</option>
                <option value="price_desc">Sort: Price (High)</option>
                <option value="pivot_dist_asc">Sort: Pivot Dist (Near)</option>
              </select>

              <span className="text-[11px] font-mono text-[#94A3B8]">
                {displayedRows.length} stocks
              </span>
            </div>
          </div>

          {/* Scrollable Compact Stock Rows (~48px each) */}
          <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-[#F1F5F9]">
            {loadingList ? (
              <div className="p-8 text-center text-[#94A3B8] text-xs">
                <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Scanning market candidates...
              </div>
            ) : listError ? (
              <div className="p-6 text-center text-[#EF4444] text-xs">
                {listError}
              </div>
            ) : displayedRows.length === 0 ? (
              <div className="p-8 text-center text-[#64748B] text-xs">
                No stocks match this screener today.
              </div>
            ) : (
              displayedRows.map((row) => {
                const isSelected = selectedStock?.token === row.token;
                return (
                  <button
                    key={row.token}
                    type="button"
                    onClick={() => {
                      setSelectedStock(row);
                      setMobileView("chart");
                    }}
                    className={`w-full text-left px-3 py-2 transition-colors flex flex-col justify-center h-[50px] ${
                      isSelected
                        ? "bg-[#EFF6FF] border-l-3 border-[#2563EB]"
                        : "hover:bg-[#F8FAFC]"
                    }`}
                  >
                    {/* Line 1: Symbol + RS Badge (Left), Price (Right) */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-xs text-[#17233B] truncate">
                          {row.symbol}
                        </span>
                        {row.rs_rank !== null && row.rs_rank !== undefined ? (
                          <span
                            className={`text-[9px] font-mono px-1 py-0.2 rounded-[3px] font-semibold ${
                              row.rs_rank >= 80
                                ? "bg-[#DCFCE7] text-[#166534]"
                                : row.rs_rank >= 70
                                ? "bg-[#FEF9C3] text-[#854D0E]"
                                : "bg-[#F1F5F9] text-[#64748B]"
                            }`}
                          >
                            RS {row.rs_rank}
                          </span>
                        ) : (
                          <span className="text-[9px] text-[#94A3B8] font-mono">—</span>
                        )}
                      </div>
                      <span className="font-mono text-xs font-semibold text-[#17233B]">
                        {row.close !== null && row.close !== undefined
                          ? `₹${row.close.toLocaleString("en-IN")}`
                          : "—"}
                      </span>
                    </div>

                    {/* Line 2: 1D % (Left), Vol Ratio (Right) */}
                    <div className="flex items-center justify-between text-[11px] font-mono mt-0.5">
                      <span
                        className={`font-medium ${
                          row.ret_1d_pct !== null && row.ret_1d_pct !== undefined
                            ? row.ret_1d_pct >= 0
                              ? "text-[#16A34A]"
                              : "text-[#EF4444]"
                            : "text-[#94A3B8]"
                        }`}
                      >
                        {row.ret_1d_pct !== null && row.ret_1d_pct !== undefined
                          ? `${row.ret_1d_pct > 0 ? "+" : ""}${row.ret_1d_pct}%`
                          : "—"}
                      </span>
                      <span className="text-[#64748B]">
                        Vol {row.vol_ratio !== null && row.vol_ratio !== undefined ? `${row.vol_ratio}x` : "—"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Chart Panel (Fills Remaining Width and Height) */}
        <div
          className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-white ${
            mobileView === "list" ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* Mobile Back Button */}
          <div className="lg:hidden p-2 border-b border-[#E5EAF2] bg-[#FAFAFA] shrink-0">
            <button
              type="button"
              onClick={() => setMobileView("list")}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-[5px] bg-white border border-[#CBD5E1] text-[#2563EB]"
            >
              <ChevronLeft size={15} />
              Back to Candidate List
            </button>
          </div>

          {/* Interactive Chart Canvas (70vh on mobile, full-height on desktop) */}
          <div className="flex-1 min-h-[70vh] lg:min-h-0 h-full">
            <ScreenerChart
              stockData={chartData}
              screenerId={activeScreener}
              loading={loadingChart}
              error={chartError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
