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
  List as ListIcon,
  HelpCircle,
} from "lucide-react";

import SectorTreeMap from "@/components/sectors/SectorTreeMap";
import SectorScatterPlot from "@/components/sectors/SectorScatterPlot";
import SectorTableView from "@/components/sectors/SectorTableView";
import StockExplorerView from "@/components/sectors/StockExplorerView";
import StockDetailPanel from "@/components/sectors/StockDetailPanel";

function SectorRotationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL query params (default: view=map, metric=1m)
  const initialView = ["map", "sectors", "stocks"].includes(searchParams.get("view"))
    ? searchParams.get("view")
    : "map";
  const initialMetric = ["1d", "1w", "1m", "3m"].includes(searchParams.get("metric"))
    ? searchParams.get("metric")
    : "1m";
  const initialSector = searchParams.get("sector") || "all";

  const [view, setView] = useState(initialView);
  const [metric, setMetric] = useState(initialMetric);
  const [sectorFilter, setSectorFilter] = useState(initialSector);
  const [selectedStock, setSelectedStock] = useState(null);

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
      const res = await fetch("/api/terminal/sectors");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load sector data`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to load sector rotation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sectors = data?.sectors || [];
  const stocks = data?.stocks || [];
  const coverage = data?.coverage || { n_mapped: 0, n_in_universe: 0, total_nifty500: null, uncovered: 0 };
  const asOf = data?.asOf;
  const breadthAsOf = data?.breadthAsOf;

  // Check if sector data lags behind market breadth
  const isLagging = asOf && breadthAsOf && asOf < breadthAsOf;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg overflow-y-auto no-scrollbar">
      {/* ── Top Header Strip ────────────────────────────────────────── */}
      <div className="p-4 border-b border-border bg-surface shrink-0 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-text">Sector Rotation</h1>
              {asOf && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-bg-secondary text-text-secondary border border-border">
                  As of {asOf}
                </span>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Where is money moving? Multi-timeframe sector leadership, breadth, and stock explorer.
            </p>
          </div>

          {/* Right Controls: Metric Picker, View Switcher, Refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Metric Window Switcher (1D, 1W, 1M, 3M) */}
            <div className="flex items-center rounded-md border border-border p-0.5 bg-bg-secondary text-xs font-semibold">
              {["1d", "1w", "1m", "3m"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleMetricChange(m)}
                  className={`px-2 py-1 rounded-[4px] uppercase font-mono transition-none ${
                    metric === m
                      ? "bg-primary text-text-inverse font-bold"
                      : "text-text-secondary hover:text-text"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* View Switcher (Map | Sectors | Stocks) */}
            <div className="flex items-center rounded-md border border-border p-0.5 bg-bg-secondary text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleViewChange("map")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] transition-none ${
                  view === "map"
                    ? "bg-primary text-text-inverse font-bold"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <MapIcon size={12} />
                <span>Map</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewChange("sectors")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] transition-none ${
                  view === "sectors"
                    ? "bg-primary text-text-inverse font-bold"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <TableIcon size={12} />
                <span>Sectors</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewChange("stocks")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] transition-none ${
                  view === "stocks"
                    ? "bg-primary text-text-inverse font-bold"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                <ListIcon size={12} />
                <span>Stocks</span>
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={fetchData}
              className="p-1.5 rounded-md border border-border text-text-secondary hover:text-text hover:bg-bg-hover transition-none"
              title="Refresh sector data"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Coverage honesty line (T7.3) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60 text-[11px] text-text-muted">
          <span>
            Sectors cover <strong>{coverage.n_mapped}</strong> stocks ({coverage.n_in_universe} tradable today) across all Nifty 500 members & sector indices.
          </span>
          <span className="font-mono text-[10px]">
            Index spot token: official · Groups without token: Equal-Weight (EW)
          </span>
        </div>

        {/* As-Of Lag Banner (T13.4) */}
        {isLagging && (
          <div className="px-3 py-1.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-medium flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Sector data is as of <strong>{asOf}</strong> while market breadth is as of <strong>{breadthAsOf}</strong>.
            </span>
          </div>
        )}
      </div>

      {/* ── Main Body Workspace ─────────────────────────────────────── */}
      <div className="flex-1 p-4 flex flex-col gap-4">
        {loading && !data ? (
          // Static Loading Skeleton (T10: no animate-pulse)
          <div className="w-full flex flex-col gap-3">
            <div className="h-64 bg-surface rounded-lg border border-border flex items-center justify-center text-xs text-text-muted">
              <span>Loading sector rotation analytics...</span>
            </div>
            <div className="h-48 bg-surface rounded-lg border border-border" />
          </div>
        ) : error ? (
          // Error Box with Retry
          <div className="p-6 bg-surface border border-rose-300 dark:border-rose-900 rounded-lg text-center flex flex-col items-center justify-center my-6">
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-400 mb-2">{error}</span>
            <button
              type="button"
              onClick={fetchData}
              className="px-3 py-1.5 bg-primary text-text-inverse rounded text-xs font-semibold hover:bg-primary-hover flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        ) : view === "map" ? (
          // ── MAP VIEW (T10.3) ───────────────────────────────────────
          <div className="flex flex-col gap-4">
            <SectorTreeMap
              sectors={sectors}
              stocks={stocks}
              metric={metric}
              onSelectStock={(st) => setSelectedStock(st)}
              onSelectSector={(secKey) => {
                setSectorFilter(secKey);
                handleViewChange("stocks");
              }}
            />
            <SectorScatterPlot
              sectors={sectors}
              selectedSectorKey={sectorFilter !== "all" ? sectorFilter : null}
              onSelectSector={(secKey) => {
                setSectorFilter(secKey);
                handleViewChange("stocks");
              }}
            />
          </div>
        ) : view === "sectors" ? (
          // ── SECTORS VIEW (T10.4) ───────────────────────────────────
          <SectorTableView
            sectors={sectors}
            selectedSectorKey={sectorFilter !== "all" ? sectorFilter : null}
            onSelectSector={(secKey) => {
              setSectorFilter(secKey);
              handleViewChange("stocks");
            }}
          />
        ) : (
          // ── STOCKS VIEW (T10.5) ───────────────────────────────────
          <StockExplorerView
            stocks={stocks}
            sectors={sectors}
            selectedSector={sectorFilter}
            onSectorChange={(s) => setSectorFilter(s)}
            onSelectStock={(st) => setSelectedStock(st)}
            selectedStockToken={selectedStock?.token}
          />
        )}
      </div>

      {/* ── Stock Detail Panel Drawer (T10.6) ────────────────────────── */}
      {selectedStock && (
        <StockDetailPanel
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
          onShowSector={(secKey) => {
            setSectorFilter(secKey);
            handleViewChange("stocks");
            setSelectedStock(null);
          }}
        />
      )}

      {/* Footer Attribution (T14.7) */}
      <footer className="px-4 py-3 border-t border-border bg-surface text-[11px] text-text-muted flex flex-wrap items-center justify-between gap-2 mt-auto">
        <span>Charts powered by Lightweight Charts™ (TradingView)</span>
        <span>For educational and research purposes only. Not investment advice.</span>
      </footer>
    </div>
  );
}

export default function SectorRotationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-bg text-text-secondary text-xs">
          <span>Loading sector rotation...</span>
        </div>
      }
    >
      <SectorRotationContent />
    </Suspense>
  );
}
