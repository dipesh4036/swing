"use client";

import React, { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

/**
 * SectorTableView: Dense sortable table with inline SVG RS sparklines (T10.4)
 */
export function SectorTableView({
  sectors = [],
  selectedSectorKey = null,
  onSelectSector,
}) {
  const [sortField, setSortField] = useState("rs_1m");
  const [sortDir, setSortDir] = useState("desc");

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedSectors = useMemo(() => {
    return [...sectors].sort((a, b) => {
      // Insufficient constituents always sort last
      if (a.insufficient_data && !b.insufficient_data) return 1;
      if (!a.insufficient_data && b.insufficient_data) return -1;

      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "string") {
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === "asc" ? valA - valB : valB - valA;
    });
  }, [sectors, sortField, sortDir]);

  const getQuadrantBadge = (q) => {
    if (!q) return <span className="text-text-muted">—</span>;
    const lower = q.toLowerCase();
    const style = {
      leading: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
      improving: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800",
      weakening: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800",
      lagging: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800",
    }[lower] || "bg-bg-secondary text-text-secondary border-border";

    return (
      <span className={`inline-flex px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase border ${style}`}>
        {q}
      </span>
    );
  };

  return (
    <div className="w-full bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/60 text-text-secondary text-[11px] select-none sticky top-0 z-10">
              <th className="py-2.5 px-3 text-left font-semibold w-10">#</th>
              <th
                onClick={() => handleSort("label")}
                className="py-2.5 px-3 text-left font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center gap-1">
                  <span>Sector</span>
                  {sortField === "label" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th className="py-2.5 px-3 text-left font-semibold">Trend</th>
              <th
                onClick={() => handleSort("rs_1m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>1M RS</span>
                  {sortField === "rs_1m" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th
                onClick={() => handleSort("rs_3m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>3M RS</span>
                  {sortField === "rs_3m" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th
                onClick={() => handleSort("ret_1m")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>1M Ret</span>
                  {sortField === "ret_1m" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th
                onClick={() => handleSort("pct_above_50dma")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>&gt; 50 DMA</span>
                  {sortField === "pct_above_50dma" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th
                onClick={() => handleSort("pct_above_200dma")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>&gt; 200 DMA</span>
                  {sortField === "pct_above_200dma" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th className="py-2.5 px-3 text-right font-semibold">52W H/L</th>
              <th
                onClick={() => handleSort("leaders_count")}
                className="py-2.5 px-3 text-right font-semibold cursor-pointer hover:text-text"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Leaders</span>
                  {sortField === "leaders_count" && (sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                </div>
              </th>
              <th className="py-2.5 px-3 text-center font-semibold">RS Sparkline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedSectors.map((sec, idx) => {
              const isSelected = selectedSectorKey === sec.key;
              const isEW = sec.price_source === "equal_weight";

              // Sparkline path generator
              const sparklinePoints = (sec.rs_series || []).slice(-40);
              let sparkSvg = null;
              if (sparklinePoints.length >= 2) {
                const values = sparklinePoints.map((p) => p.value);
                const minV = Math.min(...values);
                const maxV = Math.max(...values);
                const range = maxV - minV || 1;
                const svgW = 75;
                const svgH = 20;

                const pointsStr = values
                  .map((v, i) => {
                    const px = (i / (values.length - 1)) * svgW;
                    const py = svgH - ((v - minV) / range) * (svgH - 4) - 2;
                    return `${px.toFixed(1)},${py.toFixed(1)}`;
                  })
                  .join(" ");

                const isUp = values[values.length - 1] >= values[0];
                const strokeColor = isUp ? "#10B981" : "#F43F5E";

                sparkSvg = (
                  <svg width={svgW} height={svgH} className="inline-block overflow-visible">
                    <polyline
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="1.2"
                      points={pointsStr}
                    />
                  </svg>
                );
              }

              return (
                <tr
                  key={sec.key}
                  onClick={() => onSelectSector && onSelectSector(sec.key)}
                  className={`cursor-pointer transition-colors hover:bg-bg-hover ${
                    isSelected ? "bg-primary/5 font-medium" : ""
                  } ${sec.insufficient_data ? "opacity-60" : ""}`}
                >
                  <td className="py-2.5 px-3 text-text-muted font-mono">{idx + 1}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-text">{sec.label}</span>
                      {isEW && (
                        <span
                          className="px-1 py-0.2 rounded text-[9px] bg-bg-secondary text-text-muted border border-border font-mono"
                          title="Equal-weight index of constituents"
                        >
                          EW
                        </span>
                      )}
                      {sec.stale && (
                        <span
                          className="px-1 py-0.2 rounded text-[9px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 font-mono"
                          title="Data lagged behind asOf date"
                        >
                          Stale
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">{getQuadrantBadge(sec.quadrant)}</td>
                  <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${sec.rs_1m >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {sec.rs_1m != null ? `${sec.rs_1m >= 0 ? "+" : ""}${sec.rs_1m}%` : "—"}
                  </td>
                  <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${sec.rs_3m >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {sec.rs_3m != null ? `${sec.rs_3m >= 0 ? "+" : ""}${sec.rs_3m}%` : "—"}
                  </td>
                  <td className={`py-2.5 px-3 text-right font-mono tabular-nums ${sec.ret_1m >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {sec.ret_1m != null ? `${sec.ret_1m >= 0 ? "+" : ""}${sec.ret_1m}%` : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {sec.pct_above_50dma != null ? `${sec.pct_above_50dma}%` : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {sec.pct_above_200dma != null ? `${sec.pct_above_200dma}%` : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-text-secondary">
                    <span className="text-bullish">{sec.new_52w_highs || 0}</span>
                    <span className="mx-0.5">/</span>
                    <span className="text-bearish">{sec.new_52w_lows || 0}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {sec.leaders_count ? (
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {sec.leaders_count}
                      </span>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">{sparkSvg || <span className="text-text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SectorTableView;
