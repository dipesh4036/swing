"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RefreshCw,
  AlertTriangle,
  Layers,
  Map as MapIcon,
  Table as TableIcon,
  Compass,
  List as ListIcon,
  HelpCircle,
  X,
  Info,
} from "lucide-react";

import IndustryTableView from "@/components/sectors/IndustryTableView";
import IndustryTreeMap from "@/components/sectors/IndustryTreeMap";
import IndustryScatterPlot from "@/components/sectors/IndustryScatterPlot";
import IndustryStockExplorerView from "@/components/sectors/IndustryStockExplorerView";
import IndustryDetailDrawer from "@/components/sectors/IndustryDetailDrawer";
import StockDetailPanel from "@/components/sectors/StockDetailPanel";

function IndustryRotationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL query params (default: view=industries, metric=1m)
  const initialView = ["industries", "map", "quadrant", "stocks"].includes(searchParams.get("view"))
    ? searchParams.get("view")
    : "industries";
  const initialMetric = ["1d", "1w", "1m", "3m", "50dma"].includes(searchParams.get("metric"))
    ? searchParams.get("metric")
    : "1m";
  const initialSector = searchParams.get("sector") || "all";

  const [view, setView] = useState(initialView);
  const [metric, setMetric] = useState(initialMetric);
  const [sectorFilter, setSectorFilter] = useState(initialSector);

  // Drawers
  const [selectedIndustry, setSelectedIndustry] = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);
  const [showRankHelp, setShowRankHelp] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync state to URL query params
  const updateURL = useCallback(
    (newView, newMetric, newSector) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      url.searchParams.set("view", newView);
      url.searchParams.set("metric", newMetric);
      if (newSector && newSector !== "all") {
        url.searchParams.set("sector", newSector);
      } else {
        url.searchParams.delete("sector");
      }
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    },
    []
  );

  const handleViewChange = (v) => {
    setView(v);
    updateURL(v, metric, sectorFilter);
  };

  const handleMetricChange = (m) => {
    setMetric(m);
    updateURL(view, m, sectorFilter);
  };

  const handleSectorChange = (s) => {
    setSectorFilter(s);
    updateURL(view, metric, s);
  };

  // Fetch API data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal/industries");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load industry data`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to load industry rotation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-accent" />
        <span className="text-sm text-text-muted">Loading Industries metrics...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-4 text-center">
        <AlertTriangle className="w-8 h-8 text-rose-500" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-text">Failed to Load Industry Data</h2>
          <p className="text-xs text-text-muted max-w-md">{error}</p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-surface border border-border hover:bg-surface-subtle transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  const {
    asOf,
    breadthAsOf,
    mcapAsOf,
    coverage = { n_universe: 1700, n_classified: 0, n_unclassified: 1700, n_small_industries: 0 },
    sectors = [],
    industries = [],
    stocks = [],
  } = data || {};

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header & Navigation Banner */}
      <div className="bg-surface border border-border rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg sm:text-xl font-bold text-text">Industries</h1>
              <span className="text-xs text-text-muted px-2 py-0.5 rounded bg-surface-subtle border border-border">
                Rotation &amp; Market Breadth
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Classification: NSE industry classification, fetched 2026-11-24 ·{" "}
              {coverage.n_universe} liquid · {coverage.n_classified} classified ·{" "}
              {coverage.n_unclassified} unclassified
            </p>
          </div>

          {/* Segmented View Switcher */}
          <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-xl border border-border self-start md:self-auto text-xs font-medium">
            <button
              onClick={() => handleViewChange("industries")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                view === "industries"
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Industries</span>
            </button>

            <button
              onClick={() => handleViewChange("map")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                view === "map"
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Map</span>
            </button>

            <button
              onClick={() => handleViewChange("quadrant")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                view === "quadrant"
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Quadrant</span>
            </button>

            <button
              onClick={() => handleViewChange("stocks")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                view === "stocks"
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              <span>Stocks ({stocks.length})</span>
            </button>
          </div>
        </div>

        {/* Header Metadata & How ranks work trigger */}
        <div className="pt-2 border-t border-border flex flex-wrap items-center justify-between text-xs text-text-muted gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span>As of: <strong className="text-text font-mono">{asOf || "—"}</strong></span>
            <span>Market cap as of: <strong className="text-text font-mono">{mcapAsOf || "—"}</strong></span>
            <span className="italic">Industry series use today&apos;s constituents</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowRankHelp(true)}
              className="inline-flex items-center gap-1 text-accent hover:underline font-medium"
            >
              <HelpCircle className="w-3.5 h-3.5" /> How ranks work
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1 rounded text-text-muted hover:text-text"
              title="Refresh industry data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main View Area */}
      {view === "industries" && (
        <IndustryTableView
          industries={industries}
          sectors={sectors}
          selectedSector={sectorFilter}
          onSectorChange={handleSectorChange}
          onSelectIndustry={(ind) => setSelectedIndustry(ind)}
        />
      )}

      {view === "map" && (
        <IndustryTreeMap
          sectors={sectors}
          industries={industries}
          stocks={stocks}
          metric={metric}
          onMetricChange={handleMetricChange}
          onSelectIndustry={(ind) => setSelectedIndustry(ind)}
          onSelectStock={(st) => setSelectedStock(st)}
        />
      )}

      {view === "quadrant" && (
        <IndustryScatterPlot
          industries={industries}
          selectedSector={sectorFilter}
          onSectorChange={handleSectorChange}
          onSelectIndustry={(ind) => setSelectedIndustry(ind)}
        />
      )}

      {view === "stocks" && (
        <IndustryStockExplorerView
          stocks={stocks}
          industries={industries}
          sectors={sectors}
          onSelectStock={(st) => setSelectedStock(st)}
        />
      )}

      {/* Industry Detail Drawer */}
      {selectedIndustry && (
        <IndustryDetailDrawer
          industry={selectedIndustry}
          allStocks={stocks}
          asOf={asOf}
          onClose={() => setSelectedIndustry(null)}
          onSelectStock={(st) => setSelectedStock(st)}
        />
      )}

      {/* Stock Detail Panel (Chart + Patterns) */}
      {selectedStock && (
        <StockDetailPanel
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
          onShowSector={(secName) => {
            setSectorFilter(secName);
            setSelectedStock(null);
          }}
        />
      )}

      {/* How Ranks Work Popover / Modal */}
      {showRankHelp && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface border border-border rounded-xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-bold text-text flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-accent" />
                How Ranks Work
              </h3>
              <button
                onClick={() => setShowRankHelp(false)}
                className="p-1 rounded text-text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-text-muted space-y-2.5 leading-relaxed font-sans">
              <p>
                <strong>Eligibility:</strong> Industries with at least <strong>5 liquid stocks</strong> on each trade date are ranked. Smaller industries (&lt;5 stocks) remain unranked to prevent statistical skew from single-stock moves.
              </p>
              <div className="p-3 bg-surface-subtle rounded-lg border border-border font-mono text-[11px] text-text space-y-1">
                <div className="font-bold text-accent">Formula (equal-weighted components):</div>
                <div>trend = mean(pct_rank(median_1m), pct_rank(median_3m), pct_rank(median_6m))</div>
                <div>breadth = mean(pct_rank(pct_above_50), pct_rank(pct_above_200))</div>
                <div>leaders = pct_rank(pct_leaders)</div>
                <div className="text-text font-bold pt-1">final = (trend + breadth + leaders) / 3</div>
              </div>
              <p>
                <strong>Rank assignment:</strong> 1..N assigned by <code>final</code> descending. Ties broken by stock count descending, then industry name ascending.
              </p>
              <p>
                <strong>Rank Change:</strong> Computed as <code>rank_5_sessions_ago − current_rank</code> (positive = moved up).
              </p>
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                onClick={() => setShowRankHelp(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IndustryRotationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-accent" />
          <span className="text-sm text-text-muted">Loading Industries...</span>
        </div>
      }
    >
      <IndustryRotationContent />
    </Suspense>
  );
}
