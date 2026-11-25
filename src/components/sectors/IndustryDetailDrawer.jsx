"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  TrendingUp,
  TrendingDown,
  Activity,
  Award,
  ChevronRight,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import SectorRSChart from "@/components/sectors/SectorRSChart";

function formatMcap(val) {
  if (val == null || isNaN(val)) return "—";
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L Cr`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")} Cr`;
}

export default function IndustryDetailDrawer({
  industry,
  allStocks = [],
  asOf,
  onClose,
  onSelectStock,
}) {
  const [rsData, setRsData] = useState(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [sortCol, setSortCol] = useState("mcap_cr");
  const [sortAsc, setSortAsc] = useState(false);

  // Fetch full RS series for this industry
  useEffect(() => {
    if (!industry?.basic_industry) return;
    let isCancelled = false;

    async function fetchRS() {
      setLoadingChart(true);
      try {
        const res = await fetch(
          `/api/terminal/industries?industry=${encodeURIComponent(industry.basic_industry)}`
        );
        if (res.ok) {
          const json = await res.json();
          if (!isCancelled) {
            setRsData(json.rs_series || []);
          }
        }
      } catch (err) {
        console.error("Failed to load industry RS series:", err);
      } finally {
        if (!isCancelled) setLoadingChart(false);
      }
    }

    fetchRS();
    return () => {
      isCancelled = true;
    };
  }, [industry?.basic_industry]);

  if (!industry) return null;

  // Filter stocks belonging to this basic_industry
  const constituentStocks = allStocks.filter(
    (s) => s.basic_industry === industry.basic_industry
  );

  const sortedStocks = [...constituentStocks].sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") {
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortAsc ? va - vb : vb - va;
  });

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  const getTagBadge = (tag) => {
    switch (tag) {
      case "Leading":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <TrendingUp className="w-3.5 h-3.5" /> Leading
          </span>
        );
      case "Weakening":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Activity className="w-3.5 h-3.5" /> Weakening
          </span>
        );
      case "Improving":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <ArrowUpRight className="w-3.5 h-3.5" /> Improving
          </span>
        );
      case "Lagging":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <TrendingDown className="w-3.5 h-3.5" /> Lagging
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex justify-end">
      <div
        className="w-full max-w-4xl bg-surface border-l border-border h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-border flex items-start justify-between bg-surface-subtle">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
                {industry.sector}
              </span>
              {getTagBadge(industry.tag)}
              {industry.rank ? (
                <span className="text-xs font-bold text-accent px-2 py-0.5 rounded bg-accent/10 border border-accent/20">
                  Rank #{industry.rank}
                </span>
              ) : (
                <span className="text-xs text-text-muted px-2 py-0.5 rounded bg-surface border border-border">
                  Unranked (&lt;5 stocks)
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-text">
              {industry.basic_industry}
            </h2>
            <p className="text-xs text-text-muted mt-1">
              {constituentStocks.length} liquid stocks · Total Market Cap:{" "}
              {formatMcap(industry.mcap_cr)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface border border-transparent hover:border-border transition-colors"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Summary Facts Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-surface-subtle rounded-lg border border-border">
              <span className="text-xs text-text-muted">Median 1M Return</span>
              <p
                className={`text-base font-bold mt-0.5 ${
                  (industry.median_1m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                }`}
              >
                {industry.median_1m != null ? `${industry.median_1m >= 0 ? "+" : ""}${industry.median_1m}%` : "—"}
              </p>
            </div>
            <div className="p-3 bg-surface-subtle rounded-lg border border-border">
              <span className="text-xs text-text-muted">Median 3M Return</span>
              <p
                className={`text-base font-bold mt-0.5 ${
                  (industry.median_3m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                }`}
              >
                {industry.median_3m != null ? `${industry.median_3m >= 0 ? "+" : ""}${industry.median_3m}%` : "—"}
              </p>
            </div>
            <div className="p-3 bg-surface-subtle rounded-lg border border-border">
              <span className="text-xs text-text-muted">&gt; 50 DMA</span>
              <p className="text-base font-bold text-text mt-0.5">
                {industry.pct_above_50 != null ? `${industry.pct_above_50}%` : "—"}
              </p>
            </div>
            <div className="p-3 bg-surface-subtle rounded-lg border border-border">
              <span className="text-xs text-text-muted">20D High / Low</span>
              <p className="text-base font-bold text-text mt-0.5">
                <span className="text-emerald-500">{industry.n_20d_high}</span> /{" "}
                <span className="text-rose-500">{industry.n_20d_low}</span>
              </p>
            </div>
          </div>

          {/* Equal Weight vs Nifty 500 RS Chart */}
          <div className="p-4 bg-surface-subtle rounded-xl border border-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Equal-Weight vs NIFTY 500 RS Series
                </h3>
                <p className="text-xs text-text-muted">
                  Rebased to 100.0 · Uses today&apos;s constituents
                </p>
              </div>
            </div>
            <div className="h-60 w-full">
              {loadingChart ? (
                <div className="h-full flex items-center justify-center text-xs text-text-muted">
                  Loading RS chart...
                </div>
              ) : rsData && rsData.length > 0 ? (
                <SectorRSChart data={rsData} />
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-text-muted">
                  Insufficient candle history for equal-weight RS series.
                </div>
              )}
            </div>
          </div>

          {/* Constituent Stocks Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Layers className="w-4 h-4 text-accent" />
                Industry Constituent Stocks ({constituentStocks.length})
              </h3>
              <span className="text-xs text-text-muted">Click row for chart & patterns</span>
            </div>

            <div className="overflow-x-auto border border-border rounded-lg bg-surface">
              <table className="w-full text-xs text-left">
                <thead className="bg-surface-subtle text-text-muted border-b border-border select-none">
                  <tr>
                    <th
                      className="p-2.5 font-medium cursor-pointer hover:text-text"
                      onClick={() => handleSort("symbol")}
                    >
                      Symbol
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("close")}
                    >
                      Price (₹)
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("ret_1d")}
                    >
                      1D
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("ret_1w")}
                    >
                      1W
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("ret_1m")}
                    >
                      1M
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("ret_3m")}
                    >
                      3M
                    </th>
                    <th
                      className="p-2.5 font-medium text-center cursor-pointer hover:text-text"
                      onClick={() => handleSort("above_50dma")}
                    >
                      50D
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("pct_from_52w_high")}
                    >
                      52W H%
                    </th>
                    <th
                      className="p-2.5 font-medium text-center cursor-pointer hover:text-text"
                      onClick={() => handleSort("rs_rank")}
                    >
                      RS
                    </th>
                    <th
                      className="p-2.5 font-medium text-right cursor-pointer hover:text-text"
                      onClick={() => handleSort("mcap_cr")}
                    >
                      Market Cap
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedStocks.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-text-muted">
                        No classified stocks found in this industry.
                      </td>
                    </tr>
                  ) : (
                    sortedStocks.map((st) => (
                      <tr
                        key={st.symbol}
                        onClick={() => onSelectStock && onSelectStock(st)}
                        className="hover:bg-surface-subtle cursor-pointer transition-colors"
                      >
                        <td className="p-2.5 font-medium text-text">
                          <div className="flex items-center gap-1.5">
                            <span>{st.symbol}</span>
                            {st.is_leader && (
                              <span
                                title="Leader: RS Rank >= 70 & within 15% of 52W High"
                                className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30"
                              >
                                <Award className="w-2.5 h-2.5 mr-0.5" /> Leader
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-text-muted truncate max-w-[120px]">
                            {st.name}
                          </div>
                        </td>
                        <td className="p-2.5 text-right text-text font-mono">
                          {st.close != null ? `₹${st.close.toFixed(2)}` : "—"}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-medium ${
                            (st.ret_1d ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {st.ret_1d != null ? `${st.ret_1d >= 0 ? "+" : ""}${st.ret_1d.toFixed(2)}%` : "—"}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-medium ${
                            (st.ret_1w ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {st.ret_1w != null ? `${st.ret_1w >= 0 ? "+" : ""}${st.ret_1w.toFixed(2)}%` : "—"}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-medium ${
                            (st.ret_1m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {st.ret_1m != null ? `${st.ret_1m >= 0 ? "+" : ""}${st.ret_1m.toFixed(2)}%` : "—"}
                        </td>
                        <td
                          className={`p-2.5 text-right font-mono font-medium ${
                            (st.ret_3m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {st.ret_3m != null ? `${st.ret_3m >= 0 ? "+" : ""}${st.ret_3m.toFixed(2)}%` : "—"}
                        </td>
                        <td className="p-2.5 text-center">
                          {st.above_50dma != null ? (
                            st.above_50dma ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 inline" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500 inline" />
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2.5 text-right font-mono text-text-muted">
                          {st.pct_from_52w_high != null ? `${st.pct_from_52w_high}%` : "—"}
                        </td>
                        <td className="p-2.5 text-center">
                          {st.rs_rank != null ? (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                st.rs_rank >= 70
                                  ? "bg-emerald-500/10 text-emerald-500"
                                  : st.rs_rank <= 30
                                  ? "bg-rose-500/10 text-rose-500"
                                  : "bg-surface text-text-muted"
                              }`}
                            >
                              {st.rs_rank}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2.5 text-right font-mono text-text">
                          {formatMcap(st.mcap_cr)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
