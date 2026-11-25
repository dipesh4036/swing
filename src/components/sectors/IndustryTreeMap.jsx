"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  Maximize2,
  TrendingUp,
  TrendingDown,
  Info,
  Layers,
  ArrowLeft,
} from "lucide-react";
import {
  computeSquarifiedTreemap,
  getMetricColor,
  getMetricTextColor,
} from "@/lib/treemap";

function formatMcap(val) {
  if (val == null || isNaN(val)) return "—";
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L Cr`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")} Cr`;
}

export default function IndustryTreeMap({
  sectors = [],
  industries = [],
  stocks = [],
  metric = "1m",
  onMetricChange,
  onSelectIndustry,
  onSelectStock,
}) {
  const [zoomLevel, setZoomLevel] = useState("all"); // 'all' | 'sector' | 'industry'
  const [activeSector, setActiveSector] = useState(null);
  const [activeIndustry, setActiveIndustry] = useState(null);

  const metricOptions = [
    { key: "1d", label: "1D" },
    { key: "1w", label: "1W" },
    { key: "1m", label: "1M" },
    { key: "3m", label: "3M" },
    { key: "50dma", label: "% > 50 DMA" },
  ];

  const getMetricValue = useCallback((item, m) => {
    if (m === "1d") return item.median_1d ?? item.ret_1d;
    if (m === "1w") return item.median_1w ?? item.ret_1w;
    if (m === "1m") return item.median_1m ?? item.ret_1m;
    if (m === "3m") return item.median_3m ?? item.ret_3m;
    if (m === "50dma") {
      if (item.pct_above_50 != null) return item.pct_above_50 - 50.0; // center at 50%
      if (item.above_50dma != null) return item.above_50dma ? 20.0 : -20.0;
    }
    return 0;
  }, []);

  const formatDisplayMetric = useCallback((item, m) => {
    if (m === "50dma") {
      if (item.pct_above_50 != null) return `${item.pct_above_50}% > 50D`;
      if (item.above_50dma != null) return item.above_50dma ? "> 50 DMA" : "< 50 DMA";
      return "—";
    }
    const val = getMetricValue(item, m);
    if (val == null || isNaN(val)) return "—";
    return `${val >= 0 ? "+" : ""}${Number(val).toFixed(2)}%`;
  }, [getMetricValue]);

  // Count stocks without market cap
  const unweightedStocksCount = useMemo(() => {
    return stocks.filter((s) => s.mcap_cr == null || s.mcap_cr <= 0).length;
  }, [stocks]);

  // View data: either sectors with industries, or zoomed industry with stocks
  const treemapItems = useMemo(() => {
    const W = 1000;
    const H = 600;

    if (zoomLevel === "industry" && activeIndustry) {
      // Zoomed into constituent stocks of activeIndustry
      const indStocks = stocks.filter(
        (s) => s.basic_industry === activeIndustry && (s.mcap_cr || 0) > 0
      );
      const items = indStocks.map((s) => ({
        id: s.symbol,
        label: s.symbol,
        sublabel: s.name,
        weight: s.mcap_cr || 1,
        value: getMetricValue(s, metric),
        displayVal: formatDisplayMetric(s, metric),
        mcap_cr: s.mcap_cr,
        raw: s,
        type: "stock",
      }));
      return computeSquarifiedTreemap(items, 0, 0, W, H);
    }

    if (zoomLevel === "sector" && activeSector) {
      // Zoomed into industries of activeSector
      const secInds = industries.filter(
        (i) => i.sector === activeSector && (i.mcap_cr || 0) > 0
      );
      const items = secInds.map((i) => ({
        id: i.basic_industry,
        label: i.basic_industry,
        sublabel: `${i.n_stocks} stocks`,
        weight: i.mcap_cr || 1,
        value: getMetricValue(i, metric),
        displayVal: formatDisplayMetric(i, metric),
        mcap_cr: i.mcap_cr,
        raw: i,
        type: "industry",
      }));
      return computeSquarifiedTreemap(items, 0, 0, W, H);
    }

    // Default: Top-level sectors containing nested industries
    // First, layout sectors
    const validSectors = sectors.filter((s) => (s.mcap_cr || 0) > 0);
    const sectorItems = validSectors.map((s) => ({
      id: s.name,
      name: s.name,
      weight: s.mcap_cr || 1,
      mcap_cr: s.mcap_cr,
    }));

    const sectorLayout = computeSquarifiedTreemap(sectorItems, 0, 0, W, H);

    // Inside each sector layout box, layout its industries
    let nestedResults = [];
    for (const secBox of sectorLayout) {
      const secInds = industries.filter(
        (i) => i.sector === secBox.name && (i.mcap_cr || 0) > 0
      );
      if (secInds.length === 0) continue;

      const innerPadding = 2;
      const headerH = Math.min(22, secBox.height * 0.25);
      const innerW = Math.max(10, secBox.width - innerPadding * 2);
      const innerH = Math.max(10, secBox.height - headerH - innerPadding * 2);

      const indItems = secInds.map((i) => ({
        id: i.basic_industry,
        label: i.basic_industry,
        sector: secBox.name,
        sublabel: `${i.n_stocks} stocks`,
        weight: i.mcap_cr || 1,
        value: getMetricValue(i, metric),
        displayVal: formatDisplayMetric(i, metric),
        mcap_cr: i.mcap_cr,
        raw: i,
        type: "industry",
      }));

      const indLayout = computeSquarifiedTreemap(
        indItems,
        secBox.x + innerPadding,
        secBox.y + headerH + innerPadding,
        innerW,
        innerH
      );

      nestedResults.push({
        sectorBox: secBox,
        children: indLayout,
      });
    }

    return nestedResults;
  }, [zoomLevel, activeSector, activeIndustry, sectors, industries, stocks, metric, formatDisplayMetric, getMetricValue]);

  const handleTileClick = (item) => {
    if (item.type === "stock") {
      if (onSelectStock) onSelectStock(item.raw);
    } else if (item.type === "industry") {
      // Zoom into industry stocks
      setActiveIndustry(item.id);
      setActiveSector(item.sector || item.raw?.sector);
      setZoomLevel("industry");
      if (onSelectIndustry) onSelectIndustry(item.raw);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-surface p-3 sm:p-4 rounded-xl border border-border">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <button
            onClick={() => {
              setZoomLevel("all");
              setActiveSector(null);
              setActiveIndustry(null);
            }}
            className={`px-2 py-1 rounded transition-colors ${
              zoomLevel === "all"
                ? "bg-accent/15 text-accent font-bold"
                : "text-text-muted hover:text-text hover:bg-surface-subtle"
            }`}
          >
            All Sectors
          </button>

          {activeSector && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <button
                onClick={() => {
                  setZoomLevel("sector");
                  setActiveIndustry(null);
                }}
                className={`px-2 py-1 rounded transition-colors ${
                  zoomLevel === "sector"
                    ? "bg-accent/15 text-accent font-bold"
                    : "text-text-muted hover:text-text hover:bg-surface-subtle"
                }`}
              >
                {activeSector}
              </button>
            </>
          )}

          {activeIndustry && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <span className="px-2 py-1 rounded bg-accent/15 text-accent font-bold truncate max-w-[180px]">
                {activeIndustry}
              </span>
            </>
          )}
        </div>

        {/* Metric Selector */}
        <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-lg border border-border">
          <span className="text-[11px] text-text-muted px-2 font-medium">Metric:</span>
          {metricOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onMetricChange && onMetricChange(opt.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                metric === opt.key
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Treemap Canvas */}
      <div className="relative w-full rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
        <svg
          viewBox="0 0 1000 600"
          className="w-full h-auto block select-none"
          style={{ minHeight: "380px", maxHeight: "650px" }}
        >
          {zoomLevel === "all" ? (
            // Nested Layout: Sector headers + Industry children
            Array.isArray(treemapItems) &&
            treemapItems.map((secGroup, idx) => {
              const { sectorBox, children } = secGroup;
              return (
                <g key={`sec-${sectorBox.name}-${idx}`}>
                  {/* Sector Header Area */}
                  <rect
                    x={sectorBox.x}
                    y={sectorBox.y}
                    width={sectorBox.width}
                    height={sectorBox.height}
                    fill="var(--surface-subtle, #18181B)"
                    stroke="var(--border, #27272A)"
                    strokeWidth={1.5}
                    rx={3}
                  />
                  {sectorBox.width >= 40 && sectorBox.height >= 20 && (
                    <text
                      x={sectorBox.x + 6}
                      y={sectorBox.y + 14}
                      fill="var(--text-muted, #A1A1AA)"
                      fontSize="10"
                      fontWeight="bold"
                      className="cursor-pointer"
                      onClick={() => {
                        setActiveSector(sectorBox.name);
                        setZoomLevel("sector");
                      }}
                    >
                      {sectorBox.name} ({formatMcap(sectorBox.mcap_cr)})
                    </text>
                  )}

                  {/* Industry Tiles inside Sector */}
                  {children.map((tile) => {
                    const color = getMetricColor(tile.value, metric, true);
                    const isSmall = tile.width < 50 || tile.height < 35;
                    return (
                      <g
                        key={tile.id}
                        onClick={() => handleTileClick(tile)}
                        className="cursor-pointer transition-opacity hover:opacity-90"
                      >
                        <rect
                          x={tile.x}
                          y={tile.y}
                          width={tile.width}
                          height={tile.height}
                          fill={color}
                          stroke="rgba(0,0,0,0.3)"
                          strokeWidth={1}
                          rx={2}
                        />
                        {!isSmall && (
                          <g pointerEvents="none">
                            <text
                              x={tile.x + tile.width / 2}
                              y={tile.y + tile.height / 2 - 2}
                              textAnchor="middle"
                              fill="#FFFFFF"
                              fontSize={Math.max(9, Math.min(13, tile.width / 10))}
                              fontWeight="bold"
                            >
                              {tile.label.length > tile.width / 7
                                ? `${tile.label.substring(0, Math.floor(tile.width / 7))}…`
                                : tile.label}
                            </text>
                            <text
                              x={tile.x + tile.width / 2}
                              y={tile.y + tile.height / 2 + 13}
                              textAnchor="middle"
                              fill="rgba(255,255,255,0.85)"
                              fontSize="10"
                              fontFamily="monospace"
                            >
                              {tile.displayVal}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })
          ) : (
            // Zoomed Layout (Sector or Industry)
            Array.isArray(treemapItems) &&
            treemapItems.map((tile) => {
              const color = getMetricColor(tile.value, metric, true);
              const isSmall = tile.width < 45 || tile.height < 30;
              return (
                <g
                  key={tile.id}
                  onClick={() => handleTileClick(tile)}
                  className="cursor-pointer transition-opacity hover:opacity-90"
                >
                  <rect
                    x={tile.x}
                    y={tile.y}
                    width={tile.width}
                    height={tile.height}
                    fill={color}
                    stroke="rgba(0,0,0,0.3)"
                    strokeWidth={1}
                    rx={2}
                  />
                  {!isSmall && (
                    <g pointerEvents="none">
                      <text
                        x={tile.x + tile.width / 2}
                        y={tile.y + tile.height / 2 - 4}
                        textAnchor="middle"
                        fill="#FFFFFF"
                        fontSize={Math.max(10, Math.min(15, tile.width / 8))}
                        fontWeight="bold"
                      >
                        {tile.label}
                      </text>
                      <text
                        x={tile.x + tile.width / 2}
                        y={tile.y + tile.height / 2 + 12}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.9)"
                        fontSize="11"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {tile.displayVal}
                      </text>
                      {tile.width > 80 && tile.height > 60 && (
                        <text
                          x={tile.x + tile.width / 2}
                          y={tile.y + tile.height / 2 + 25}
                          textAnchor="middle"
                          fill="rgba(255,255,255,0.7)"
                          fontSize="9"
                          fontFamily="monospace"
                        >
                          {formatMcap(tile.mcap_cr)}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })
          )}
        </svg>

        {/* Legend Footnote */}
        <div className="p-3 bg-surface-subtle border-t border-border flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-text-muted gap-2">
          <div className="flex items-center gap-3">
            <span className="font-medium text-text">Return Color Scale:</span>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-rose-600 inline-block" />
              <span>Negative</span>
              <span className="w-3 h-3 rounded bg-[#27272A] inline-block ml-2" />
              <span>Flat</span>
              <span className="w-3 h-3 rounded bg-emerald-600 inline-block ml-2" />
              <span>Positive</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <Info className="w-3.5 h-3.5 text-accent" />
            <span>
              Tile size = Market Cap · Stocks without market cap ({unweightedStocksCount}) omitted from sizing.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
