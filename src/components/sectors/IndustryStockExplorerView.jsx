"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Filter,
  Award,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";

function formatMcap(val) {
  if (val == null || isNaN(val)) return "—";
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L Cr`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")} Cr`;
}

export default function IndustryStockExplorerView({
  stocks = [],
  industries = [],
  sectors = [],
  onSelectStock,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("all");
  const [selectedSector, setSelectedSector] = useState("all");
  const [leadersOnly, setLeadersOnly] = useState(false);
  const [selectedScreener, setSelectedScreener] = useState("all");
  const [minMcap, setMinMcap] = useState("");

  const [sortCol, setSortCol] = useState("mcap_cr");
  const [sortAsc, setSortAsc] = useState(false);

  // Distinct industries & sectors
  const distinctIndustries = useMemo(() => {
    const set = new Set();
    stocks.forEach((s) => {
      if (s.basic_industry) set.add(s.basic_industry);
    });
    return Array.from(set).sort();
  }, [stocks]);

  const distinctSectors = useMemo(() => {
    const set = new Set();
    stocks.forEach((s) => {
      if (s.sector) set.add(s.sector);
    });
    return Array.from(set).sort();
  }, [stocks]);

  const screenerOptions = [
    { key: "all", label: "All Screeners" },
    { key: "stage2", label: "Stage 2 Breakout" },
    { key: "vcp", label: "VCP" },
    { key: "minervini", label: "Minervini Trend" },
    { key: "pocket_pivot", label: "Pocket Pivot" },
  ];

  // Filtered & sorted stocks
  const filteredStocks = useMemo(() => {
    return stocks.filter((s) => {
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchSym = s.symbol?.toLowerCase().includes(q);
        const matchName = s.name?.toLowerCase().includes(q);
        if (!matchSym && !matchName) return false;
      }
      if (selectedIndustry !== "all" && s.basic_industry !== selectedIndustry) {
        return false;
      }
      if (selectedSector !== "all" && s.sector !== selectedSector) {
        return false;
      }
      if (leadersOnly && !s.is_leader) {
        return false;
      }
      if (selectedScreener !== "all") {
        if (!s.screeners || !s.screeners.includes(selectedScreener)) {
          return false;
        }
      }
      if (minMcap && !isNaN(Number(minMcap))) {
        if ((s.mcap_cr || 0) < Number(minMcap)) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => {
      let va = a[sortCol];
      let vb = b[sortCol];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortAsc ? va - vb : vb - va;
    });
  }, [
    stocks,
    searchTerm,
    selectedIndustry,
    selectedSector,
    leadersOnly,
    selectedScreener,
    minMcap,
    sortCol,
    sortAsc,
  ]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(["symbol", "name", "basic_industry", "sector"].includes(col));
    }
  };

  const getSortIcon = (col) => {
    if (sortCol !== col) {
      return <ArrowUpDown className="w-3 h-3 text-text-muted/40 ml-1 inline" />;
    }
    return sortAsc ? (
      <ChevronUp className="w-3.5 h-3.5 text-accent ml-1 inline" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-accent ml-1 inline" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="p-4 bg-surface rounded-xl border border-border space-y-3 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {/* Search */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search symbol or name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Sector Select */}
          <select
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All Sectors</option>
            {distinctSectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>

          {/* Industry Select */}
          <select
            value={selectedIndustry}
            onChange={(e) => setSelectedIndustry(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All Industries</option>
            {distinctIndustries.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>

          {/* Screener Select */}
          <select
            value={selectedScreener}
            onChange={(e) => setSelectedScreener(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text focus:outline-none focus:border-accent"
          >
            {screenerOptions.map((sc) => (
              <option key={sc.key} value={sc.key}>
                {sc.label}
              </option>
            ))}
          </select>

          {/* Min Market Cap */}
          <input
            type="number"
            value={minMcap}
            onChange={(e) => setMinMcap(e.target.value)}
            placeholder="Min MCAP (₹ Cr)"
            className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Bottom row: Leaders toggle and counts */}
        <div className="flex items-center justify-between pt-1 border-t border-border text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none text-text">
            <input
              type="checkbox"
              checked={leadersOnly}
              onChange={(e) => setLeadersOnly(e.target.checked)}
              className="rounded border-border text-accent focus:ring-0"
            />
            <span className="font-semibold flex items-center gap-1 text-amber-500">
              <Award className="w-3.5 h-3.5" /> Leaders Only (RS &ge; 70 &amp; within 15% of 52W High)
            </span>
          </label>

          <span className="text-text-muted">
            Showing <strong className="text-text">{filteredStocks.length}</strong> of {stocks.length} liquid classified stocks
          </span>
        </div>
      </div>

      {/* Stocks Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-surface-subtle text-text-muted border-b border-border sticky top-0 z-10 select-none">
              <tr>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("symbol")}
                >
                  Symbol {getSortIcon("symbol")}
                </th>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("basic_industry")}
                >
                  Industry {getSortIcon("basic_industry")}
                </th>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("sector")}
                >
                  Sector {getSortIcon("sector")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("close")}
                >
                  Price (₹) {getSortIcon("close")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("ret_1d")}
                >
                  1D {getSortIcon("ret_1d")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("ret_1w")}
                >
                  1W {getSortIcon("ret_1w")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("ret_1m")}
                >
                  1M {getSortIcon("ret_1m")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("ret_3m")}
                >
                  3M {getSortIcon("ret_3m")}
                </th>
                <th
                  className="p-3 font-semibold text-center cursor-pointer hover:text-text"
                  onClick={() => handleSort("above_50dma")}
                >
                  50D {getSortIcon("above_50dma")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("pct_from_52w_high")}
                >
                  52W H% {getSortIcon("pct_from_52w_high")}
                </th>
                <th
                  className="p-3 font-semibold text-center cursor-pointer hover:text-text"
                  onClick={() => handleSort("rs_rank")}
                >
                  RS Rank {getSortIcon("rs_rank")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("mcap_cr")}
                >
                  Market Cap {getSortIcon("mcap_cr")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredStocks.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-text-muted">
                    No classified stocks match the current filters.
                  </td>
                </tr>
              ) : (
                filteredStocks.map((st) => (
                  <tr
                    key={st.symbol}
                    onClick={() => onSelectStock && onSelectStock(st)}
                    className="hover:bg-surface-subtle cursor-pointer transition-colors"
                  >
                    <td className="p-3 font-medium text-text">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold">{st.symbol}</span>
                        {st.is_leader && (
                          <span
                            title="Leader: RS Rank >= 70 & within 15% of 52W High"
                            className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30"
                          >
                            <Award className="w-2.5 h-2.5 mr-0.5" /> Leader
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted truncate max-w-[130px]">
                        {st.name}
                      </div>
                    </td>
                    <td className="p-3 text-text font-medium">{st.basic_industry}</td>
                    <td className="p-3 text-text-muted">{st.sector}</td>
                    <td className="p-3 text-right font-mono font-medium text-text">
                      {st.close != null ? `₹${st.close.toFixed(2)}` : "—"}
                    </td>
                    <td
                      className={`p-3 text-right font-mono font-medium ${
                        (st.ret_1d ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {st.ret_1d != null ? `${st.ret_1d >= 0 ? "+" : ""}${st.ret_1d.toFixed(2)}%` : "—"}
                    </td>
                    <td
                      className={`p-3 text-right font-mono font-medium ${
                        (st.ret_1w ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {st.ret_1w != null ? `${st.ret_1w >= 0 ? "+" : ""}${st.ret_1w.toFixed(2)}%` : "—"}
                    </td>
                    <td
                      className={`p-3 text-right font-mono font-medium ${
                        (st.ret_1m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {st.ret_1m != null ? `${st.ret_1m >= 0 ? "+" : ""}${st.ret_1m.toFixed(2)}%` : "—"}
                    </td>
                    <td
                      className={`p-3 text-right font-mono font-medium ${
                        (st.ret_3m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {st.ret_3m != null ? `${st.ret_3m >= 0 ? "+" : ""}${st.ret_3m.toFixed(2)}%` : "—"}
                    </td>
                    <td className="p-3 text-center">
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
                    <td className="p-3 text-right font-mono text-text-muted">
                      {st.pct_from_52w_high != null ? `${st.pct_from_52w_high}%` : "—"}
                    </td>
                    <td className="p-3 text-center">
                      {st.rs_rank != null ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            st.rs_rank >= 70
                              ? "bg-emerald-500/10 text-emerald-500"
                              : st.rs_rank <= 30
                              ? "bg-rose-500/10 text-rose-500"
                              : "bg-surface-subtle text-text-muted"
                          }`}
                        >
                          {st.rs_rank}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-right font-mono font-medium text-text">
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
  );
}
