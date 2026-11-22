"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  computeSquarifiedTreemap,
  getMetricColor,
  getMetricTextColor,
} from "@/lib/treemap";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

/**
 * Sector Treemap with Squarified layout and Mobile Accordion (T10.3)
 */
export function SectorTreeMap({
  sectors = [],
  stocks = [],
  metric = "1m",
  onSelectStock,
  onSelectSector,
  isDark = false,
}) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 900, height: 600 });
  const [expandedSectors, setExpandedSectors] = useState({});
  const [hoveredStock, setHoveredStock] = useState(null);

  // Resize observer to update treemap dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          const w = Math.floor(entry.contentRect.width);
          const h = Math.max(450, Math.min(800, Math.floor(w * 0.65)));
          setDimensions({ width: w, height: h });
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Map stocks by sector
  const { stocksBySector, stocksWithoutSize } = useMemo(() => {
    const bySec = {};
    const noSize = {};
    for (const st of stocks) {
      if (!bySec[st.sector]) bySec[st.sector] = [];
      if (!noSize[st.sector]) noSize[st.sector] = 0;

      if (typeof st.avg_traded_value === "number" && st.avg_traded_value > 0) {
        bySec[st.sector].push(st);
      } else {
        noSize[st.sector]++;
      }
    }
    return { stocksBySector: bySec, stocksWithoutSize: noSize };
  }, [stocks]);

  // Compute sector-level weights for the macro treemap grid
  const sectorGroups = useMemo(() => {
    return sectors
      .map((sec) => {
        const secStocks = stocksBySector[sec.key] || [];
        const totalWeight = secStocks.reduce((sum, s) => sum + (s.avg_traded_value || 0), 0);
        return {
          ...sec,
          weight: Math.max(1, totalWeight),
          stocks: secStocks,
          noSizeCount: stocksWithoutSize[sec.key] || 0,
        };
      })
      .filter((g) => g.stocks.length > 0 || g.n_mapped > 0);
  }, [sectors, stocksBySector, stocksWithoutSize]);

  // Macro layout: calculate bounding boxes for each sector
  const sectorLayouts = useMemo(() => {
    if (dimensions.width < 500) return []; // mobile width uses accordion
    return computeSquarifiedTreemap(
      sectorGroups,
      0,
      0,
      dimensions.width,
      dimensions.height
    );
  }, [sectorGroups, dimensions]);

  // Micro layout: calculate stock cells inside each sector bounding box
  const renderedSectorBoxes = useMemo(() => {
    return sectorLayouts.map((sBox) => {
      const headerHeight = 24;
      const innerW = Math.max(0, sBox.width - 4);
      const innerH = Math.max(0, sBox.height - headerHeight - 4);

      const stockItems = sBox.stocks.map((st) => ({
        ...st,
        weight: st.avg_traded_value || 1,
      }));

      const stockLayout = computeSquarifiedTreemap(
        stockItems,
        sBox.x + 2,
        sBox.y + headerHeight + 2,
        innerW,
        innerH
      );

      return {
        ...sBox,
        innerStocks: stockLayout,
      };
    });
  }, [sectorLayouts]);

  const toggleSectorExpand = (key) => {
    setExpandedSectors((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const metricKey = `ret_${metric}`;

  // Mobile Accordion View for small screens (<640px)
  return (
    <div className="w-full flex flex-col bg-surface rounded-lg border border-border overflow-hidden">
      {/* Desktop / Tablet Treemap Area */}
      <div className="hidden sm:block w-full p-2 relative" ref={containerRef}>
        <div
          className="relative w-full overflow-hidden bg-bg-secondary/40 rounded border border-border"
          style={{ height: `${dimensions.height}px` }}
        >
          {renderedSectorBoxes.map((sBox) => {
            const rsLabel = sBox.rs_1m != null ? `${sBox.rs_1m >= 0 ? "+" : ""}${sBox.rs_1m}%` : "—";
            return (
              <div
                key={sBox.key}
                className="absolute border border-border bg-surface flex flex-col overflow-hidden"
                style={{
                  left: `${sBox.x}px`,
                  top: `${sBox.y}px`,
                  width: `${sBox.width}px`,
                  height: `${sBox.height}px`,
                }}
              >
                {/* Sector Header Strip */}
                <div
                  onClick={() => onSelectSector && onSelectSector(sBox.key)}
                  className="h-6 px-1.5 bg-bg-secondary/80 border-b border-border flex items-center justify-between text-[10px] font-semibold text-text cursor-pointer hover:bg-bg-hover transition-colors truncate"
                  title={`${sBox.label} · 1M RS: ${rsLabel} · ${sBox.stocks.length} stocks. Click to filter Stocks view.`}
                >
                  <span className="truncate">{sBox.short || sBox.label}</span>
                  <span className="font-mono text-[9px] text-text-muted shrink-0 ml-1">
                    RS {rsLabel} ({sBox.stocks.length})
                  </span>
                </div>

                {/* Stock Cells Area */}
                <div className="relative flex-1 w-full h-full overflow-hidden">
                  {sBox.innerStocks.map((cell) => {
                    const retVal = cell[metricKey];
                    const bgCol = getMetricColor(retVal, metric, isDark);
                    const txtCol = getMetricTextColor(retVal, metric, isDark);
                    const isLeader = cell.leader;
                    const isDimmed = !cell.in_universe;

                    const showSymbol = cell.width >= 36 && cell.height >= 18;
                    const showValue = cell.width >= 48 && cell.height >= 28;

                    return (
                      <div
                        key={cell.token}
                        onClick={() => onSelectStock && onSelectStock(cell)}
                        onMouseEnter={() => setHoveredStock(cell)}
                        onMouseLeave={() => setHoveredStock(null)}
                        className={`absolute flex flex-col items-center justify-center cursor-pointer transition-none select-none overflow-hidden ${
                          isLeader ? "border border-amber-400 dark:border-amber-300 z-10" : "border border-border/40"
                        } ${isDimmed ? "opacity-45" : ""}`}
                        style={{
                          left: `${cell.x - sBox.x - 2}px`,
                          top: `${cell.y - sBox.y - 26}px`,
                          width: `${cell.width}px`,
                          height: `${cell.height}px`,
                          backgroundColor: bgCol,
                          color: txtCol,
                        }}
                        title={`${cell.symbol} (${cell.name || cell.sector})\nClose: ₹${cell.close || "—"}\nReturn (${metric.toUpperCase()}): ${retVal != null ? retVal + "%" : "—"}\nRS Rank: ${cell.rs_rank ?? "—"}\nFrom 52w High: ${cell.pct_from_52w_high != null ? cell.pct_from_52w_high + "%" : "—"}\nStage: ${cell.stage ?? "—"}${isLeader ? "\n★ Sector Leader" : ""}${!cell.in_universe ? "\n(Illiquid: outside liquid universe)" : ""}`}
                      >
                        {showSymbol && (
                          <span className="text-[10px] font-bold leading-tight truncate px-0.5 pointer-events-none">
                            {cell.symbol}
                          </span>
                        )}
                        {showValue && retVal != null && (
                          <span className="text-[9px] font-mono leading-none pointer-events-none">
                            {retVal >= 0 ? "+" : ""}{retVal}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hovered Stock Quick Tooltip Bar */}
        {hoveredStock && (
          <div className="mt-2 px-3 py-1.5 bg-bg-secondary rounded border border-border text-xs flex flex-wrap items-center justify-between gap-3 text-text">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm">{hoveredStock.symbol}</span>
              <span className="text-text-muted text-[11px] truncate max-w-[200px]">{hoveredStock.name}</span>
              {hoveredStock.leader && (
                <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300">
                  Leader
                </span>
              )}
              {!hoveredStock.in_universe && (
                <span className="text-[10px] text-text-muted italic">(illiquid)</span>
              )}
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span>Close: <strong>₹{hoveredStock.close ?? "—"}</strong></span>
              <span>1D: <strong className={hoveredStock.ret_1d >= 0 ? "text-bullish" : "text-bearish"}>{hoveredStock.ret_1d != null ? `${hoveredStock.ret_1d}%` : "—"}</strong></span>
              <span>1W: <strong className={hoveredStock.ret_1w >= 0 ? "text-bullish" : "text-bearish"}>{hoveredStock.ret_1w != null ? `${hoveredStock.ret_1w}%` : "—"}</strong></span>
              <span>1M: <strong className={hoveredStock.ret_1m >= 0 ? "text-bullish" : "text-bearish"}>{hoveredStock.ret_1m != null ? `${hoveredStock.ret_1m}%` : "—"}</strong></span>
              <span>RS Rank: <strong>{hoveredStock.rs_rank ?? "—"}</strong></span>
              <span>From 52w High: <strong>{hoveredStock.pct_from_52w_high != null ? `${hoveredStock.pct_from_52w_high}%` : "—"}</strong></span>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Accordion List (rendered on narrow width <640px) */}
      <div className="sm:hidden flex flex-col divide-y divide-border">
        {sectors.map((sec) => {
          const secStocks = stocksBySector[sec.key] || [];
          const isExpanded = Boolean(expandedSectors[sec.key]);
          const rsVal = sec.rs_1m != null ? `${sec.rs_1m >= 0 ? "+" : ""}${sec.rs_1m}%` : "—";

          return (
            <div key={sec.key} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggleSectorExpand(sec.key)}
                className="w-full px-3 py-2.5 bg-surface hover:bg-bg-hover flex items-center justify-between text-left transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isExpanded ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
                  <span className="text-xs font-semibold text-text truncate">{sec.label}</span>
                  <span className="text-[10px] text-text-muted font-mono">({secStocks.length})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                  <span className="text-text-muted">RS {rsVal}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 py-2 bg-bg-secondary/30 grid grid-cols-2 gap-2 border-t border-border">
                  {secStocks.map((st) => {
                    const retVal = st[metricKey];
                    const bgCol = getMetricColor(retVal, metric, isDark);
                    const txtCol = getMetricTextColor(retVal, metric, isDark);
                    return (
                      <div
                        key={st.token}
                        onClick={() => onSelectStock && onSelectStock(st)}
                        className={`p-2 rounded border border-border flex flex-col justify-between cursor-pointer ${
                          st.leader ? "ring-1 ring-amber-400" : ""
                        } ${!st.in_universe ? "opacity-50" : ""}`}
                        style={{ backgroundColor: bgCol, color: txtCol }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{st.symbol}</span>
                          {st.leader && <span className="text-[9px] font-bold">★</span>}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] font-mono">
                          <span>₹{st.close ?? "—"}</span>
                          <span>{retVal != null ? `${retVal >= 0 ? "+" : ""}${retVal}%` : "—"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SectorTreeMap;
