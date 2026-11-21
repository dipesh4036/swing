"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  RefreshCw,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Layers,
  Info,
} from "lucide-react";
import SectorScatterPlot from "@/components/sectors/SectorScatterPlot";

const SectorRSChart = dynamic(
  () => import("@/components/sectors/SectorRSChart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-48 bg-surface/50 text-text-secondary text-xs">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2" />
        <span>Loading Relative Strength chart...</span>
      </div>
    ),
  }
);

function getQuadrantBadge(quadrant) {
  if (!quadrant) {
    return (
      <span className="text-[11px] text-text-muted font-mono">—</span>
    );
  }
  const styles = {
    leading: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    improving: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    weakening: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    lagging: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
        styles[quadrant] || "bg-bg-secondary text-text-secondary border-border"
      }`}
    >
      {quadrant}
    </span>
  );
}

function formatPct(val) {
  if (val === null || val === undefined) return "—";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
}

function formatBreadth(val, isInsufficient = false) {
  if (isInsufficient || val === null || val === undefined) {
    return (
      <span className="text-text-muted cursor-help" title="Insufficient constituents (< 8 stocks)">
        —
      </span>
    );
  }
  return `${val.toFixed(1)}%`;
}

export default function SectorRotationPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSectorKey, setSelectedSectorKey] = useState(null);

  // Sorting state
  const [sortCol, setSortCol] = useState("rs_1m");
  const [sortDir, setSortDir] = useState("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal/sectors");
      if (!res.ok) {
        throw new Error(`Failed to fetch sector rotation data (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      if (json.sectors && json.sectors.length > 0 && !selectedSectorKey) {
        setSelectedSectorKey(json.sectors[0].key);
      }
    } catch (err) {
      console.error("Sector rotation fetch error:", err);
      setError(err.message || "Failed to load sector data");
    } finally {
      setLoading(false);
    }
  }, [selectedSectorKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sort sectors
  const sortedSectors = useMemo(() => {
    if (!data?.sectors) return [];
    const list = [...data.sectors];

    list.sort((a, b) => {
      let vA, vB;
      switch (sortCol) {
        case "rank":
          vA = a.rank; vB = b.rank; break;
        case "label":
          return sortDir === "asc"
            ? a.label.localeCompare(b.label)
            : b.label.localeCompare(a.label);
        case "quadrant":
          return sortDir === "asc"
            ? (a.quadrant || "").localeCompare(b.quadrant || "")
            : (b.quadrant || "").localeCompare(a.quadrant || "");
        case "ret_1w":
          vA = a.ret_1w; vB = b.ret_1w; break;
        case "ret_1m":
          vA = a.ret_1m; vB = b.ret_1m; break;
        case "ret_3m":
          vA = a.ret_3m; vB = b.ret_3m; break;
        case "rs_1m":
          vA = a.rs_1m; vB = b.rs_1m; break;
        case "pct_above_50dma":
          vA = a.pct_above_50dma; vB = b.pct_above_50dma; break;
        case "pct_above_200dma":
          vA = a.pct_above_200dma; vB = b.pct_above_200dma; break;
        case "pct_above_20ema":
          vA = a.pct_above_20ema; vB = b.pct_above_20ema; break;
        case "advances":
          vA = a.advances; vB = b.advances; break;
        case "screener_hits":
          vA = a.screener_hits?.total || 0;
          vB = b.screener_hits?.total || 0;
          break;
        default:
          vA = a.rs_1m; vB = b.rs_1m; break;
      }

      if (vA === null || vA === undefined) return 1;
      if (vB === null || vB === undefined) return -1;

      return sortDir === "asc" ? vA - vB : vB - vA;
    });

    return list;
  }, [data?.sectors, sortCol, sortDir]);

  const selectedSector = useMemo(() => {
    if (!data?.sectors || data.sectors.length === 0) return null;
    return (
      data.sectors.find((s) => s.key === selectedSectorKey) ||
      data.sectors[0]
    );
  }, [data?.sectors, selectedSectorKey]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const isStale = Boolean(
    data?.asOf && data?.breadthAsOf && data.asOf !== data.breadthAsOf
  );

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto no-scrollbar">
      {/* ── Top Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-text">Sector Rotation</h1>
            {data?.asOf && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-bg-secondary border border-border text-text-secondary">
                as of {data.asOf}
              </span>
            )}
            {isStale && (
              <span
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 cursor-help"
                title={`Sector data (${data.asOf}) differs from Breadth tab (${data.breadthAsOf})`}
              >
                <AlertTriangle size={12} />
                <span>Sector As-Of Lag</span>
              </span>
            )}
          </div>
          <p className="text-xs text-text-secondary">Where is money moving?</p>
        </div>

        <div className="flex items-center gap-2">
          {data?.benchmark && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-text-secondary font-mono mr-2 px-2.5 py-1 rounded bg-bg-secondary border border-border">
              <span className="font-semibold text-text">Nifty 500:</span>
              <span className={data.benchmark.ret_1m >= 0 ? "text-emerald-500" : "text-rose-500"}>
                1M {formatPct(data.benchmark.ret_1m)}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="p-1.5 rounded-md border border-border text-text-secondary hover:text-text hover:bg-bg-hover transition-colors"
            title="Refresh sector rotation data"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="m-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchData}
            className="px-2 py-1 rounded bg-rose-500 text-white font-medium hover:bg-rose-600 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Main Workspace ────────────────────────────────────────── */}
      <div className="flex-1 p-4 flex flex-col gap-4">
        {/* Visual: RS Trend Rotation Map (Scatter Plot) */}
        <SectorScatterPlot
          sectors={data?.sectors || []}
          selectedSectorKey={selectedSector?.key}
          onSelectSector={(s) => setSelectedSectorKey(s.key)}
        />

        {/* Bottom Split: Table & Detail Panel */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-[460px]">
          {/* LEFT 2 COLS: Sector Ranking Table */}
          <div className="xl:col-span-2 bg-surface border border-border rounded-lg flex flex-col overflow-hidden">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="font-semibold text-sm text-text">Sector Breadth & Relative Strength</span>
              <span className="text-xs text-text-secondary">Click row to inspect</span>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-bg-secondary/50 border-b border-border text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                  <tr>
                    <th
                      className="py-2 px-2.5 cursor-pointer hover:text-text"
                      onClick={() => handleSort("rank")}
                    >
                      <div className="flex items-center gap-1">
                        # <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 cursor-pointer hover:text-text"
                      onClick={() => handleSort("label")}
                    >
                      <div className="flex items-center gap-1">
                        Sector <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2.5 cursor-pointer hover:text-text"
                      onClick={() => handleSort("quadrant")}
                    >
                      <div className="flex items-center gap-1">
                        RS Trend <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2.5 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("rs_1m")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        1M RS <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2.5 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("ret_1m")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        1M Ret <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("pct_above_50dma")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        &gt;50 DMA <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("pct_above_200dma")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        &gt;200 DMA <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("pct_above_20ema")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        &gt;20 EMA <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-2 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("advances")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        A/D <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th
                      className="py-2 px-3 text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("screener_hits")}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Hits <ArrowUpDown size={11} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {sortedSectors.map((s) => {
                    const isSelected = selectedSector?.key === s.key;
                    return (
                      <tr
                        key={s.key}
                        onClick={() => setSelectedSectorKey(s.key)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/10 font-medium"
                            : "hover:bg-bg-hover"
                        }`}
                      >
                        <td className="py-2 px-2.5 font-mono text-text-muted">{s.rank}</td>
                        <td className="py-2 px-3 font-semibold text-text whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{s.label}</span>
                            {s.price_source === "equal_weight" && (
                              <span
                                className="text-[9px] font-bold px-1 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-help"
                                title="Equal-weight of constituents, not the official NSE index"
                              >
                                EW
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {getQuadrantBadge(s.quadrant)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-semibold whitespace-nowrap">
                          <span
                            className={
                              s.rs_1m > 0
                                ? "text-emerald-500"
                                : s.rs_1m < 0
                                ? "text-rose-500"
                                : "text-text"
                            }
                          >
                            {formatPct(s.rs_1m)}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono whitespace-nowrap">
                          <span
                            className={
                              s.ret_1m > 0
                                ? "text-emerald-500"
                                : s.ret_1m < 0
                                ? "text-rose-500"
                                : "text-text"
                            }
                          >
                            {formatPct(s.ret_1m)}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono whitespace-nowrap">
                          {formatBreadth(s.pct_above_50dma, s.insufficient_data)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono whitespace-nowrap">
                          {formatBreadth(s.pct_above_200dma, s.insufficient_data)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono whitespace-nowrap">
                          {formatBreadth(s.pct_above_20ema, s.insufficient_data)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono whitespace-nowrap text-text-secondary">
                          <span className="text-emerald-500">{s.advances}</span>
                          <span className="text-text-muted">/</span>
                          <span className="text-rose-500">{s.declines}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] ${
                              s.screener_hits?.total > 0
                                ? "bg-primary-subtle text-primary"
                                : "text-text-muted"
                            }`}
                          >
                            {s.screener_hits?.total || 0}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT 1 COL: Detail Panel */}
          <div className="bg-surface border border-border rounded-lg flex flex-col p-4">
            {selectedSector ? (
              <div className="flex flex-col h-full space-y-4">
                {/* Sector Header */}
                <div className="flex items-start justify-between pb-3 border-b border-border">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-text">{selectedSector.label}</h2>
                      {selectedSector.price_source === "equal_weight" && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                          title="Equal-weight of constituents, not the official NSE index"
                        >
                          EW
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Index: <span className="font-mono text-text">{selectedSector.index_name}</span>
                    </p>
                    <p className="text-xs text-text-secondary">
                      Universe: <span className="font-semibold text-text">{selectedSector.n_stocks} mapped stocks</span>
                      {selectedSector.insufficient_data && (
                        <span className="text-amber-600 dark:text-amber-400 ml-1 font-medium">
                          (insufficient history for breadth percentages)
                        </span>
                      )}
                    </p>
                  </div>

                  <Link
                    href={`/screener?sector=${selectedSector.key}`}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary text-text-inverse text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
                  >
                    <Layers size={13} />
                    <span>View in Screener</span>
                    <ExternalLink size={11} className="ml-0.5" />
                  </Link>
                </div>

                {/* Returns Overview */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-bg-secondary border border-border">
                    <div className="text-[10px] text-text-secondary uppercase">1W</div>
                    <div className={`font-mono font-semibold text-xs mt-0.5 ${selectedSector.ret_1w >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {formatPct(selectedSector.ret_1w)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-bg-secondary border border-border">
                    <div className="text-[10px] text-text-secondary uppercase">1M</div>
                    <div className={`font-mono font-semibold text-xs mt-0.5 ${selectedSector.ret_1m >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {formatPct(selectedSector.ret_1m)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-bg-secondary border border-border">
                    <div className="text-[10px] text-text-secondary uppercase">3M</div>
                    <div className={`font-mono font-semibold text-xs mt-0.5 ${selectedSector.ret_3m >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {formatPct(selectedSector.ret_3m)}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-bg-secondary border border-border">
                    <div className="text-[10px] text-text-secondary uppercase">6M</div>
                    <div className={`font-mono font-semibold text-xs mt-0.5 ${selectedSector.ret_6m >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {formatPct(selectedSector.ret_6m)}
                    </div>
                  </div>
                </div>

                {/* RS Chart */}
                <div className="flex-1 min-h-[220px] bg-bg-secondary/40 border border-border rounded-md overflow-hidden">
                  <SectorRSChart
                    rsSeries={selectedSector.rs_series || []}
                    sectorName={selectedSector.label}
                    quadrant={selectedSector.quadrant}
                  />
                </div>

                {/* Screener Breakdown */}
                <div className="pt-2 border-t border-border">
                  <div className="text-xs font-semibold text-text mb-1.5 flex items-center justify-between">
                    <span>Screener Candidates Breakdown</span>
                    <span className="text-[11px] font-mono text-text-secondary">
                      Total: {selectedSector.screener_hits?.total || 0}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="flex justify-between p-1.5 rounded bg-bg-secondary border border-border/50">
                      <span className="text-text-secondary">Stage 2 Breakout:</span>
                      <span className="font-mono font-bold text-text">
                        {selectedSector.screener_hits?.stage2_breakout || 0}
                      </span>
                    </div>
                    <div className="flex justify-between p-1.5 rounded bg-bg-secondary border border-border/50">
                      <span className="text-text-secondary">VCP:</span>
                      <span className="font-mono font-bold text-text">
                        {selectedSector.screener_hits?.vcp || 0}
                      </span>
                    </div>
                    <div className="flex justify-between p-1.5 rounded bg-bg-secondary border border-border/50">
                      <span className="text-text-secondary">Near Pivot:</span>
                      <span className="font-mono font-bold text-text">
                        {selectedSector.screener_hits?.near_pivot || 0}
                      </span>
                    </div>
                    <div className="flex justify-between p-1.5 rounded bg-bg-secondary border border-border/50">
                      <span className="text-text-secondary">IPO Base:</span>
                      <span className="font-mono font-bold text-text">
                        {selectedSector.screener_hits?.ipo_base || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-text-secondary">
                Select a sector to inspect details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
