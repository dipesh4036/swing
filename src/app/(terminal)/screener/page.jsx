"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Layers,
  Info,
  ChevronDown,
  ArrowUpDown,
  ExternalLink,
  ChevronLeft,
  AlertTriangle,
  RefreshCw,
  Search,
} from "lucide-react";

// Load lightweight-charts chart via dynamic import with ssr: false
const ScreenerChart = dynamic(
  () => import("@/components/screener/ScreenerChart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white border border-[#E5EAF2] rounded-[8px] text-[#64748B] text-sm">
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
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [showRuleInfo, setShowRuleInfo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileView, setMobileView] = useState("list"); // "list" | "chart"

  // 1. Fetch Screener List
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

      // Auto-select first stock if current selection is not in new list
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
    let isMounted = true;
    setLoadingChart(true);
    setChartError(null);

    async function loadChart() {
      try {
        const res = await fetch(
          `/api/terminal/screener/chart?token=${selectedStock.token}&screener=${activeScreener}`
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

  // Handle Sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filter & Sort Rows
  const displayedRows = React.useMemo(() => {
    if (!screenerData?.rows) return [];
    let list = [...screenerData.rows];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((r) => r.symbol.toLowerCase().includes(q));
    }

    if (sortField) {
      list.sort((a, b) => {
        let vA = a[sortField];
        let vB = b[sortField];
        if (vA === null || vA === undefined) return 1;
        if (vB === null || vB === undefined) return -1;
        if (typeof vA === "string") {
          return sortDirection === "asc"
            ? vA.localeCompare(vB)
            : vB.localeCompare(vA);
        }
        return sortDirection === "asc" ? vA - vB : vB - vA;
      });
    }
    return list;
  }, [screenerData?.rows, searchQuery, sortField, sortDirection]);

  const counts = screenerData?.counts || {};
  const currentInfo = SCREENER_INFO[activeScreener];
  const isMarketCautious =
    screenerData?.regime &&
    ["UPTREND_UNDER_PRESSURE", "CORRECTION", "RALLY_ATTEMPT"].includes(
      screenerData.regime
    );

  return (
    <div className="flex flex-col min-h-screen bg-[#F8FAFC] pb-10">
      {/* ── Top Bar / Header ────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E5EAF2] sticky top-0 z-20 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center font-bold">
              <Layers size={18} />
            </div>
            <div>
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
              <p className="text-xs text-[#64748B] mt-0.5 hidden sm:block">
                High-probability technical setups evaluated from 3-year OHLCV equity history.
              </p>
            </div>
          </div>

          {/* Universe Filter & Refresh */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-[6px] border border-[#CBD5E1] p-0.5 bg-[#F8FAFC] text-xs font-semibold">
              <button
                type="button"
                onClick={() => setUniverse("all")}
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
                onClick={() => setUniverse("nifty500")}
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
              <RefreshCw size={15} className={loadingList ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Screener Tabs Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pt-2 border-t border-[#F1F5F9]">
          <div className="flex items-center gap-1 shrink-0 pb-2">
            {SCREENERS_LIST.map((id) => {
              const info = SCREENER_INFO[id];
              const count = counts[id] || 0;
              const isActive = activeScreener === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveScreener(id);
                    setMobileView("list");
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-semibold transition-all border ${
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

          <button
            type="button"
            onClick={() => setShowRuleInfo(!showRuleInfo)}
            className={`text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-[6px] border pb-2 shrink-0 transition-colors ${
              showRuleInfo
                ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#2563EB]"
                : "border-transparent text-[#64748B] hover:text-[#17233B]"
            }`}
          >
            <Info size={14} />
            <span className="hidden sm:inline">Rules & Details</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 w-full flex-1 flex flex-col gap-4">
        {/* ── Market Regime Banner ────────────────────────────────────── */}
        {screenerData?.regime && (
          <div
            className={`px-3.5 py-2.5 rounded-[8px] text-xs font-medium border flex items-center justify-between gap-3 ${
              isMarketCautious
                ? "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]"
                : "bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]"
            }`}
          >
            <div className="flex items-center gap-2">
              {isMarketCautious ? (
                <AlertTriangle size={16} className="text-[#D97706] shrink-0" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#16A878] inline-block animate-pulse" />
              )}
              <span>
                <strong>Market Regime: {screenerData.regime}</strong>
                {isMarketCautious
                  ? " — Distribution / pressure detected in Nifty 500; breakout setups have lower follow-through probability."
                  : " — Uptrend intact; technical momentum setups aligned with market direction."}
              </span>
            </div>
            <span className="text-[10px] uppercase font-mono tracking-wider opacity-75 hidden sm:inline">
              Nifty 500 Breadth Read
            </span>
          </div>
        )}

        {/* ── Rule Info Card (Collapsible) ────────────────────────────── */}
        {showRuleInfo && currentInfo && (
          <div className="bg-white border border-[#E5EAF2] rounded-[8px] p-4 text-xs shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-sm text-[#17233B]">
                {currentInfo.name} Criteria
              </span>
              <span className="text-[10px] text-[#94A3B8] font-mono">
                Source: SCREENER_PARAMS
              </span>
            </div>
            <p className="text-[#64748B] mb-3">{currentInfo.desc}</p>
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

        {/* ── Main Workspace: List Left + Chart Right ─────────────────── */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT PANEL: Candidate List Table (12 col mobile, 5 col desktop) */}
          <div
            className={`lg:col-span-5 flex flex-col bg-white border border-[#E5EAF2] rounded-[8px] overflow-hidden shadow-xs ${
              mobileView === "chart" ? "hidden lg:flex" : "flex"
            }`}
          >
            {/* Table Header Controls */}
            <div className="p-3 border-b border-[#E5EAF2] flex items-center justify-between gap-2 bg-[#FAFAFA]">
              <div className="relative flex-1 max-w-[200px]">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"
                />
                <input
                  type="text"
                  placeholder="Filter symbol..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-7 pr-2 py-1 text-xs rounded-[6px] border border-[#CBD5E1] bg-white focus:outline-hidden focus:border-[#2563EB]"
                />
              </div>
              <div className="text-xs text-[#64748B] font-medium">
                Showing <strong>{displayedRows.length}</strong> of {screenerData?.rows?.length || 0}
              </div>
            </div>

            {/* Candidate Table */}
            <div className="overflow-x-auto max-h-[620px] overflow-y-auto no-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E5EAF2] text-[10px] text-[#64748B] uppercase font-semibold sticky top-0 z-10">
                  <tr>
                    <th
                      className="px-3 py-2 cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("symbol")}
                    >
                      <div className="flex items-center gap-1">
                        Symbol
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="px-2 py-2 text-right cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("close")}
                    >
                      Close
                    </th>
                    <th
                      className="px-2 py-2 text-right cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("ret_1d_pct")}
                    >
                      1D %
                    </th>
                    <th
                      className="px-2 py-2 text-right cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("vol_ratio")}
                    >
                      Vol
                    </th>
                    <th
                      className="px-2 py-2 text-right cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("rs_rank")}
                    >
                      RS
                    </th>
                    <th
                      className="px-2 py-2 text-right cursor-pointer hover:text-[#17233B]"
                      onClick={() => handleSort("dist_to_pivot_pct")}
                    >
                      Pivot %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9]">
                  {loadingList ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[#94A3B8]">
                        <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        Scanning market candidates...
                      </td>
                    </tr>
                  ) : listError ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[#EF4444]">
                        {listError}
                      </td>
                    </tr>
                  ) : displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-[#64748B]">
                        No stocks match today.
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((row) => {
                      const isSelected = selectedStock?.token === row.token;
                      return (
                        <tr
                          key={row.token}
                          onClick={() => {
                            setSelectedStock(row);
                            setMobileView("chart");
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-[#EFF6FF] border-l-3 border-[#2563EB]"
                              : "hover:bg-[#F8FAFC]"
                          }`}
                        >
                          {/* Symbol Column */}
                          <td className="px-3 py-2.5 font-semibold text-[#17233B]">
                            <div className="flex items-center gap-1.5">
                              <span>{row.symbol}</span>
                              {row.in_nifty500 && (
                                <span className="text-[9px] font-bold px-1 py-0.2 rounded-xs bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                                  500
                                </span>
                              )}
                              <a
                                href={`https://www.tradingview.com/chart/?symbol=NSE:${row.symbol}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[#94A3B8] hover:text-[#2563EB] inline-block"
                                title="Open in TradingView"
                              >
                                <ExternalLink size={11} />
                              </a>
                            </div>
                          </td>

                          {/* Close Column */}
                          <td className="px-2 py-2.5 text-right font-mono font-medium text-[#17233B]">
                            {row.close !== null ? `₹${row.close.toLocaleString("en-IN")}` : "—"}
                          </td>

                          {/* 1D % Column */}
                          <td
                            className={`px-2 py-2.5 text-right font-mono font-medium ${
                              row.ret_1d_pct !== null
                                ? row.ret_1d_pct >= 0
                                  ? "text-[#16A878]"
                                  : "text-[#EF4444]"
                                : "text-[#94A3B8]"
                            }`}
                          >
                            {row.ret_1d_pct !== null
                              ? `${row.ret_1d_pct > 0 ? "+" : ""}${row.ret_1d_pct}%`
                              : "—"}
                          </td>

                          {/* Volume Ratio Column */}
                          <td className="px-2 py-2.5 text-right font-mono text-[#64748B]">
                            {row.vol_ratio !== null ? `${row.vol_ratio}x` : "—"}
                          </td>

                          {/* RS Rank Column */}
                          <td className="px-2 py-2.5 text-right font-mono font-semibold text-[#17233B]">
                            {row.rs_rank !== null ? (
                              <span
                                className={`px-1.5 py-0.5 rounded-[4px] text-[10px] ${
                                  row.rs_rank >= 80
                                    ? "bg-[#DCFCE7] text-[#166534]"
                                    : row.rs_rank >= 70
                                    ? "bg-[#FEF9C3] text-[#854D0E]"
                                    : "bg-[#F1F5F9] text-[#64748B]"
                                }`}
                              >
                                {row.rs_rank}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>

                          {/* Pivot Distance % Column */}
                          <td className="px-2 py-2.5 text-right font-mono text-[#64748B]">
                            {row.dist_to_pivot_pct !== null
                              ? `${row.dist_to_pivot_pct > 0 ? "+" : ""}${row.dist_to_pivot_pct}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT PANEL: Interactive Chart (12 col mobile, 7 col desktop) */}
          <div
            className={`lg:col-span-7 flex flex-col min-h-[520px] ${
              mobileView === "list" ? "hidden lg:flex" : "flex"
            }`}
          >
            {/* Mobile back button to list view */}
            <div className="lg:hidden mb-2">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-[6px] bg-white border border-[#CBD5E1] text-[#2563EB]"
              >
                <ChevronLeft size={16} />
                Back to Candidate List
              </button>
            </div>

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
