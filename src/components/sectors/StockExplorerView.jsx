"use client";

import React, { useState, useMemo } from "react";
import { Search, Filter, Star, EyeOff, ArrowUp, ArrowDown } from "lucide-react";

/**
 * StockExplorerView: "Find the best stock in the best sector" table (T10.5)
 */
export function StockExplorerView({
  stocks = [],
  sectors = [],
  selectedSector = "all",
  onSectorChange,
  onSelectStock,
  selectedStockToken = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [leadersOnly, setLeadersOnly] = useState(false);
  const [screenerOnly, setScreenerOnly] = useState(false);
  const [hideIlliquid, setHideIlliquid] = useState(true);
  const [sortField, setSortField] = useState("rs_rank");
  const [sortDir, setSortDir] = useState("desc");

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  // Filter stocks
  const filteredStocks = useMemo(() => {
    return stocks.filter((s) => {
      if (selectedSector !== "all" && s.sector !== selectedSector) {
        return false;
      }
      if (leadersOnly && !s.leader) {
        return false;
      }
      if (screenerOnly && (!s.screeners || s.screeners.length === 0)) {
        return false;
      }
      if (hideIlliquid && !s.in_universe) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const sym = (s.symbol || "").toLowerCase();
        const nm = (s.name || "").toLowerCase();
        if (!sym.includes(q) && !nm.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [stocks, selectedSector, leadersOnly, screenerOnly, hideIlliquid, searchQuery]);

  // Sort stocks
  const sortedStocks = useMemo(() => {
    return [...filteredStocks].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "string") {
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === "asc" ? valA - valB : valB - valA;
    });
  }, [filteredStocks, sortField, sortDir]);

  return (
    <div className="w-full bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      {/* Controls Bar */}
      <div className="p-3 border-b border-border bg-bg-secondary/40 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left: Search & Filter Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol or name..."
              className="pl-8 pr-2.5 py-1 text-xs bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-primary w-44 sm:w-56"
            />
          </div>

          {/* Sector Select Dropdown */}
          <select
            value={selectedSector}
            onChange={(e) => onSectorChange && onSectorChange(e.target.value)}
            className="bg-surface border border-border rounded-md text-xs py-1 px-2.5 text-text focus:outline-none focus:border-primary"
          >
            <option value="all">All Sectors ({stocks.length})</option>
            {sectors.map((sec) => (
              <option key={sec.key} value={sec.key}>
                {sec.label} ({sec.n_mapped || 0})
              </option>
            ))}
          </select>

          {/* Leaders Only Toggle */}
          <button
            type="button"
            onClick={() => setLeadersOnly(!leadersOnly)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium transition-colors ${
              leadersOnly
                ? "bg-amber-100 dark:bg-amber-950/60 border-amber-400 text-amber-800 dark:text-amber-300"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
            title="RS Rank >= 70, above 50 & 200 DMA, within 15% of 52w High"
          >
            <Star size={12} className={leadersOnly ? "fill-amber-400 text-amber-500" : ""} />
            <span>Leaders only</span>
          </button>

          {/* Screener Hits Only Toggle */}
          <button
            type="button"
            onClick={() => setScreenerOnly(!screenerOnly)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium transition-colors ${
              screenerOnly
                ? "bg-primary-subtle border-accent-border text-primary font-semibold"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
          >
            <Filter size={12} />
            <span>Screener setups</span>
          </button>

          {/* Hide Illiquid Toggle */}
          <button
            type="button"
            onClick={() => setHideIlliquid(!hideIlliquid)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium transition-colors ${
              hideIlliquid
                ? "bg-bg-secondary border-border-strong text-text font-medium"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
            title="Filter out stocks outside liquid universe (Close < ₹20 or Vol < 25k)"
          >
            <EyeOff size={12} />
            <span>Hide illiquid</span>
          </button>
        </div>

        {/* Right: Row Count Line */}
        <div className="text-[11px] font-mono text-text-muted">
          Showing <strong>{sortedStocks.length}</strong> of {stocks.length} mapped stocks
        </div>
      </div>

      {/* Stock Table */}
      <div className="overflow-x-auto no-scrollbar max-h-[640px]">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/70 text-text-secondary text-[11px] select-none sticky top-0 z-10">
              <th
                onClick={() => handleSort("symbol")}
                className="py-2.5 px-3 text-left font-semibold cursor-pointer hover:text-text"
              >
                Symbol
              </th>
              <th
                onClick={() => handleSort("sector")}
                className="py-2.5 px-3 text-left font-semibold cursor-pointer hover:text-text"
              >
                Sector
              </th>
              <th
                onClick={() => handleSort("close")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                Close
              </th>
              <th
                onClick={() => handleSort("ret_1d")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                1D
              </th>
              <th
                onClick={() => handleSort("ret_1w")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                1W
              </th>
              <th
                onClick={() => handleSort("ret_1m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                1M
              </th>
              <th
                onClick={() => handleSort("ret_3m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                3M
              </th>
              <th
                onClick={() => handleSort("pct_from_52w_high")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                52W H%
              </th>
              <th className="py-2.5 px-3 text-center font-semibold">50 DMA</th>
              <th className="py-2.5 px-3 text-center font-semibold">200 DMA</th>
              <th
                onClick={() => handleSort("stage")}
                className="py-2.5 px-3 text-center font-semibold cursor-pointer hover:text-text"
              >
                Stage
              </th>
              <th
                onClick={() => handleSort("rs_rank")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                RS Rank
              </th>
              <th
                onClick={() => handleSort("sector_rank_1m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                Sec Rank
              </th>
              <th className="py-2.5 px-3 text-left font-semibold">Screeners</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedStocks.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-8 text-center text-text-muted">
                  No stocks match the selected criteria.
                </td>
              </tr>
            ) : (
              sortedStocks.map((st) => {
                const isSelected = selectedStockToken === st.token;
                return (
                  <tr
                    key={st.token}
                    onClick={() => onSelectStock && onSelectStock(st)}
                    className={`cursor-pointer transition-colors hover:bg-bg-hover h-9 ${
                      isSelected ? "bg-primary/5 font-medium" : ""
                    } ${!st.in_universe ? "opacity-50" : ""}`}
                  >
                    {/* Symbol + Leader star */}
                    <td className="py-1.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-text">{st.symbol}</span>
                        {st.leader && (
                          <span
                            className="text-amber-500 font-bold text-xs"
                            title="Sector Leader (RS >= 70, > 50 & 200 DMA, near 52w high)"
                          >
                            ★
                          </span>
                        )}
                        {!st.in_universe && (
                          <span className="text-[9px] text-text-muted italic">(illiquid)</span>
                        )}
                      </div>
                    </td>

                    {/* Sector */}
                    <td className="py-1.5 px-3 text-text-secondary truncate max-w-[120px]">
                      {sectors.find((sec) => sec.key === st.sector)?.label || st.sector}
                    </td>

                    {/* Close */}
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-text">
                      ₹{st.close ?? "—"}
                    </td>

                    {/* 1D */}
                    <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${st.ret_1d >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {st.ret_1d != null ? `${st.ret_1d >= 0 ? "+" : ""}${st.ret_1d}%` : "—"}
                    </td>

                    {/* 1W */}
                    <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${st.ret_1w >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {st.ret_1w != null ? `${st.ret_1w >= 0 ? "+" : ""}${st.ret_1w}%` : "—"}
                    </td>

                    {/* 1M */}
                    <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${st.ret_1m >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {st.ret_1m != null ? `${st.ret_1m >= 0 ? "+" : ""}${st.ret_1m}%` : "—"}
                    </td>

                    {/* 3M */}
                    <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${st.ret_3m >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {st.ret_3m != null ? `${st.ret_3m >= 0 ? "+" : ""}${st.ret_3m}%` : "—"}
                    </td>

                    {/* 52W High % */}
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-text-secondary">
                      {st.pct_from_52w_high != null ? `${st.pct_from_52w_high}%` : "—"}
                    </td>

                    {/* vs 50 DMA */}
                    <td className="py-1.5 px-3 text-center font-mono text-[10px]">
                      {st.above_50dma === true ? (
                        <span className="text-bullish font-bold">▲ Above</span>
                      ) : st.above_50dma === false ? (
                        <span className="text-bearish">▼ Below</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>

                    {/* vs 200 DMA */}
                    <td className="py-1.5 px-3 text-center font-mono text-[10px]">
                      {st.above_200dma === true ? (
                        <span className="text-bullish font-bold">▲ Above</span>
                      ) : st.above_200dma === false ? (
                        <span className="text-bearish">▼ Below</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>

                    {/* Stage */}
                    <td className="py-1.5 px-3 text-center font-mono">
                      {st.stage ? (
                        <span className="px-1.5 py-0.2 rounded bg-bg-secondary text-text font-semibold">
                          S{st.stage}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>

                    {/* RS Rank */}
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums font-semibold">
                      {st.rs_rank != null ? (
                        <span className={st.rs_rank >= 70 ? "text-primary" : "text-text"}>
                          {st.rs_rank}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>

                    {/* Sector Rank 1M */}
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-text-muted">
                      {st.sector_rank_1m != null ? `#${st.sector_rank_1m}` : "—"}
                    </td>

                    {/* Screeners */}
                    <td className="py-1.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {st.screeners && st.screeners.length > 0 ? (
                          st.screeners.map((scr) => (
                            <span
                              key={scr}
                              className="px-1.5 py-0.2 rounded text-[9px] bg-primary/10 text-primary font-mono"
                            >
                              {scr.replace("_", " ")}
                            </span>
                          ))
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default StockExplorerView;
