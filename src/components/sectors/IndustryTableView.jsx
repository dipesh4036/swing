"use client";

import React, { useState, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Building2,
  Sparkles,
  Info,
} from "lucide-react";

function formatMcap(val) {
  if (val == null || isNaN(val)) return "—";
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L Cr`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")} Cr`;
}

export default function IndustryTableView({
  industries = [],
  sectors = [],
  selectedSector = "all",
  onSectorChange,
  onSelectIndustry,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [quadrantFilter, setQuadrantFilter] = useState("all");
  const [showSmall, setShowSmall] = useState(false);
  const [sortCol, setSortCol] = useState("rank");
  const [sortAsc, setSortAsc] = useState(true);

  // Quadrant chips options
  const quadrantOptions = [
    { key: "all", label: "All Quadrants" },
    { key: "leading", label: "Leading" },
    { key: "weakening", label: "Weakening" },
    { key: "improving", label: "Improving" },
    { key: "lagging", label: "Lagging" },
  ];

  // Distinct sectors from data
  const sectorList = useMemo(() => {
    const set = new Set();
    industries.forEach((ind) => {
      if (ind.sector) set.add(ind.sector);
    });
    return Array.from(set).sort();
  }, [industries]);

  // Filtered lists: ranked (>=5 stocks) vs small (<5 stocks)
  const { rankedList, smallList } = useMemo(() => {
    let list = industries.filter((ind) => {
      // Sector filter
      if (selectedSector !== "all" && ind.sector !== selectedSector) {
        return false;
      }
      // Quadrant filter
      if (quadrantFilter !== "all" && ind.quadrant !== quadrantFilter) {
        return false;
      }
      // Search term
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchInd = ind.basic_industry?.toLowerCase().includes(q);
        const matchSec = ind.sector?.toLowerCase().includes(q);
        if (!matchInd && !matchSec) return false;
      }
      return true;
    });

    const ranked = list.filter((ind) => ind.n_stocks >= 5);
    const small = list.filter((ind) => ind.n_stocks < 5);

    const sortFn = (a, b) => {
      let va = a[sortCol];
      let vb = b[sortCol];

      if (va == null) return 1;
      if (vb == null) return -1;

      if (typeof va === "string") {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortAsc ? va - vb : vb - va;
    };

    ranked.sort(sortFn);
    small.sort(sortFn);

    return { rankedList: ranked, smallList: small };
  }, [industries, selectedSector, quadrantFilter, searchTerm, sortCol, sortAsc]);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      // Default asc for rank and name, desc for returns/mcap
      setSortAsc(["rank", "basic_industry", "sector"].includes(col));
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

  const getTagBadge = (tag) => {
    switch (tag) {
      case "Leading":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <TrendingUp className="w-3 h-3" /> Leading
          </span>
        );
      case "Weakening":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Activity className="w-3 h-3" /> Weakening
          </span>
        );
      case "Improving":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <ArrowUpRight className="w-3 h-3" /> Improving
          </span>
        );
      case "Lagging":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <TrendingDown className="w-3 h-3" /> Lagging
          </span>
        );
    }
  };

  const renderRankChange = (change) => {
    if (change == null) return null;
    if (change > 0) {
      return (
        <span className="text-[11px] font-bold text-emerald-500 ml-1" title={`Moved up ${change} ranks in 5 sessions`}>
          ▲{change}
        </span>
      );
    }
    if (change < 0) {
      return (
        <span className="text-[11px] font-bold text-rose-500 ml-1" title={`Moved down ${Math.abs(change)} ranks in 5 sessions`}>
          ▼{Math.abs(change)}
        </span>
      );
    }
    return <span className="text-[11px] text-text-muted ml-1">—</span>;
  };

  const renderRow = (ind, isSmall = false) => (
    <tr
      key={ind.basic_industry}
      onClick={() => onSelectIndustry && onSelectIndustry(ind)}
      className="hover:bg-surface-subtle cursor-pointer transition-colors"
    >
      {/* Rank */}
      <td className="p-3 font-mono font-medium text-text whitespace-nowrap">
        {ind.rank != null ? (
          <div className="flex items-center">
            <span className="w-6 text-right font-bold text-accent">#{ind.rank}</span>
            {renderRankChange(ind.rank_change)}
          </div>
        ) : (
          <span className="text-text-muted text-xs">—</span>
        )}
      </td>

      {/* Industry */}
      <td className="p-3 font-semibold text-text">
        <div className="flex items-center gap-2">
          <span className="hover:text-accent transition-colors">
            {ind.basic_industry}
          </span>
          {isSmall && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-surface-subtle border border-border">
              &lt;5 stocks
            </span>
          )}
        </div>
      </td>

      {/* Tag */}
      <td className="p-3 whitespace-nowrap">{getTagBadge(ind.tag)}</td>

      {/* Sector */}
      <td className="p-3 text-text-muted text-xs whitespace-nowrap">{ind.sector}</td>

      {/* Medians */}
      <td
        className={`p-3 text-right font-mono font-medium ${
          (ind.median_1d ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
        }`}
      >
        {ind.median_1d != null ? `${ind.median_1d >= 0 ? "+" : ""}${ind.median_1d.toFixed(2)}%` : "—"}
      </td>
      <td
        className={`p-3 text-right font-mono font-medium ${
          (ind.median_1w ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
        }`}
      >
        {ind.median_1w != null ? `${ind.median_1w >= 0 ? "+" : ""}${ind.median_1w.toFixed(2)}%` : "—"}
      </td>
      <td
        className={`p-3 text-right font-mono font-medium ${
          (ind.median_1m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
        }`}
      >
        {ind.median_1m != null ? `${ind.median_1m >= 0 ? "+" : ""}${ind.median_1m.toFixed(2)}%` : "—"}
      </td>
      <td
        className={`p-3 text-right font-mono font-medium ${
          (ind.median_3m ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
        }`}
      >
        {ind.median_3m != null ? `${ind.median_3m >= 0 ? "+" : ""}${ind.median_3m.toFixed(2)}%` : "—"}
      </td>

      {/* > 50 DMA */}
      <td className="p-3 text-right font-mono text-text">
        {ind.pct_above_50 != null ? `${ind.pct_above_50}%` : "—"}
      </td>

      {/* 20D High / Low */}
      <td className="p-3 text-center font-mono whitespace-nowrap">
        <span className="text-emerald-500 font-medium">{ind.n_20d_high}</span>
        <span className="text-text-muted mx-1">/</span>
        <span className="text-rose-500 font-medium">{ind.n_20d_low}</span>
      </td>

      {/* Stocks Count */}
      <td className="p-3 text-center font-mono text-text">{ind.n_stocks}</td>

      {/* Market Cap */}
      <td className="p-3 text-right font-mono text-text font-medium whitespace-nowrap">
        {formatMcap(ind.mcap_cr)}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Filter and Control Bar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-surface p-3 sm:p-4 rounded-xl border border-border">
        {/* Left: Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search industries or sectors..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-surface-subtle border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Right: Quadrant Filters & Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quadrant filter chips */}
          <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-lg border border-border">
            {quadrantOptions.map((q) => (
              <button
                key={q.key}
                onClick={() => setQuadrantFilter(q.key)}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  quadrantFilter === q.key
                    ? "bg-accent text-white shadow-sm"
                    : "text-text-muted hover:text-text"
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* Small industries toggle */}
          <label className="flex items-center gap-2 text-xs text-text-muted hover:text-text cursor-pointer select-none px-2 py-1.5 rounded-lg border border-border bg-surface-subtle">
            <input
              type="checkbox"
              checked={showSmall}
              onChange={(e) => setShowSmall(e.target.checked)}
              className="rounded border-border text-accent focus:ring-0"
            />
            <span>Show small industries (&lt;5 stocks)</span>
          </label>
        </div>
      </div>

      {/* Sector Chip Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        <button
          onClick={() => onSectorChange && onSectorChange("all")}
          className={`px-3 py-1 rounded-full whitespace-nowrap transition-colors border ${
            selectedSector === "all"
              ? "bg-accent/15 border-accent text-accent font-semibold"
              : "bg-surface border-border text-text-muted hover:text-text"
          }`}
        >
          All Sectors ({industries.length})
        </button>
        {sectorList.map((sec) => (
          <button
            key={sec}
            onClick={() => onSectorChange && onSectorChange(sec)}
            className={`px-3 py-1 rounded-full whitespace-nowrap transition-colors border ${
              selectedSector === sec
                ? "bg-accent/15 border-accent text-accent font-semibold"
                : "bg-surface border-border text-text-muted hover:text-text"
            }`}
          >
            {sec}
          </button>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-surface-subtle text-text-muted border-b border-border sticky top-0 z-10 select-none">
              <tr>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("rank")}
                >
                  Rank {getSortIcon("rank")}
                </th>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("basic_industry")}
                >
                  Industry {getSortIcon("basic_industry")}
                </th>
                <th className="p-3 font-semibold">Tag</th>
                <th
                  className="p-3 font-semibold cursor-pointer hover:text-text"
                  onClick={() => handleSort("sector")}
                >
                  Sector {getSortIcon("sector")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("median_1d")}
                >
                  1D Median {getSortIcon("median_1d")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("median_1w")}
                >
                  1W Median {getSortIcon("median_1w")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("median_1m")}
                >
                  1M Median {getSortIcon("median_1m")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("median_3m")}
                >
                  3M Median {getSortIcon("median_3m")}
                </th>
                <th
                  className="p-3 font-semibold text-right cursor-pointer hover:text-text"
                  onClick={() => handleSort("pct_above_50")}
                >
                  &gt; 50 DMA {getSortIcon("pct_above_50")}
                </th>
                <th
                  className="p-3 font-semibold text-center cursor-pointer hover:text-text"
                  onClick={() => handleSort("n_20d_high")}
                >
                  20D H/L {getSortIcon("n_20d_high")}
                </th>
                <th
                  className="p-3 font-semibold text-center cursor-pointer hover:text-text"
                  onClick={() => handleSort("n_stocks")}
                >
                  Stocks {getSortIcon("n_stocks")}
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
              {rankedList.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-text-muted">
                    No ranked industries match the current filters.
                  </td>
                </tr>
              ) : (
                rankedList.map((ind) => renderRow(ind, false))
              )}

              {/* Small industries block */}
              {showSmall && smallList.length > 0 && (
                <>
                  <tr className="bg-surface-subtle/80">
                    <td
                      colSpan={12}
                      className="p-3 font-bold text-text-muted border-t-2 border-border text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-accent" />
                        Small Industries (&lt;5 stocks, unranked) — {smallList.length} industries
                      </div>
                    </td>
                  </tr>
                  {smallList.map((ind) => renderRow(ind, true))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card List View */}
      <div className="md:hidden space-y-3">
        {rankedList.length === 0 ? (
          <div className="p-6 text-center text-text-muted bg-surface rounded-xl border border-border">
            No ranked industries match the current filters.
          </div>
        ) : (
          rankedList.map((ind) => (
            <div
              key={ind.basic_industry}
              onClick={() => onSelectIndustry && onSelectIndustry(ind)}
              className="p-4 bg-surface rounded-xl border border-border space-y-2.5 active:bg-surface-subtle transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {ind.rank != null ? (
                      <span className="text-xs font-bold text-accent px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20">
                        #{ind.rank}
                      </span>
                    ) : (
                      <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-surface-subtle border border-border">
                        Unranked
                      </span>
                    )}
                    {renderRankChange(ind.rank_change)}
                    <span className="text-[11px] text-text-muted">{ind.sector}</span>
                  </div>
                  <h4 className="text-sm font-bold text-text">{ind.basic_industry}</h4>
                </div>
                {getTagBadge(ind.tag)}
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border text-center text-xs font-mono">
                <div>
                  <span className="text-[10px] text-text-muted block">1D</span>
                  <span className={(ind.median_1d ?? 0) >= 0 ? "text-emerald-500 font-semibold" : "text-rose-500 font-semibold"}>
                    {ind.median_1d != null ? `${ind.median_1d >= 0 ? "+" : ""}${ind.median_1d}%` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted block">1M</span>
                  <span className={(ind.median_1m ?? 0) >= 0 ? "text-emerald-500 font-semibold" : "text-rose-500 font-semibold"}>
                    {ind.median_1m != null ? `${ind.median_1m >= 0 ? "+" : ""}${ind.median_1m}%` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted block">&gt;50D</span>
                  <span className="text-text font-semibold">
                    {ind.pct_above_50 != null ? `${ind.pct_above_50}%` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted block">20D H/L</span>
                  <span className="text-text font-semibold">
                    {ind.n_20d_high}/{ind.n_20d_low}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-text-muted pt-1">
                <span>{ind.n_stocks} liquid stocks</span>
                <span>{formatMcap(ind.mcap_cr)}</span>
              </div>
            </div>
          ))
        )}

        {showSmall && smallList.length > 0 && (
          <div className="pt-4 space-y-3">
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider px-1">
              Small Industries (&lt;5 stocks, unranked)
            </h4>
            {smallList.map((ind) => (
              <div
                key={ind.basic_industry}
                onClick={() => onSelectIndustry && onSelectIndustry(ind)}
                className="p-3 bg-surface rounded-xl border border-border space-y-2 opacity-85"
              >
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-text">{ind.basic_industry}</h5>
                  {getTagBadge(ind.tag)}
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{ind.sector} · {ind.n_stocks} stocks</span>
                  <span>{formatMcap(ind.mcap_cr)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
