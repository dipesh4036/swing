"use client";

import React, { useState, useMemo } from "react";
import { Info, HelpCircle } from "lucide-react";

function formatMcap(val) {
  if (val == null || isNaN(val)) return "—";
  if (val >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L Cr`;
  }
  return `₹${Math.round(val).toLocaleString("en-IN")} Cr`;
}

export default function IndustryScatterPlot({
  industries = [],
  selectedSector = "all",
  onSectorChange,
  onSelectIndustry,
}) {
  const [hoveredIndustry, setHoveredIndustry] = useState(null);

  // Filter plottable industries
  const plottable = useMemo(() => {
    return industries.filter((ind) => {
      if (ind.rs_x == null || ind.rs_y == null || !ind.quadrant) return false;
      if (selectedSector !== "all" && ind.sector !== selectedSector) return false;
      return true;
    });
  }, [industries, selectedSector]);

  // Distinct sectors
  const sectorList = useMemo(() => {
    const set = new Set();
    industries.forEach((i) => {
      if (i.sector) set.add(i.sector);
    });
    return Array.from(set).sort();
  }, [industries]);

  // Bound calculations
  const { boundX, boundY } = useMemo(() => {
    let maxX = 4.0;
    let maxY = 4.0;
    for (const ind of plottable) {
      if (Math.abs(ind.rs_x) > maxX) maxX = Math.abs(ind.rs_x);
      if (Math.abs(ind.rs_y) > maxY) maxY = Math.abs(ind.rs_y);
    }
    const maxVal = Math.max(maxX, maxY) * 1.25;
    const bound = Math.max(5.0, Math.ceil(maxVal * 2) / 2);
    return { boundX: bound, boundY: bound };
  }, [plottable]);

  const width = 800;
  const height = 480;
  const paddingX = 50;
  const paddingY = 40;
  const plotW = width - paddingX * 2;
  const plotH = height - paddingY * 2;
  const originX = paddingX + plotW / 2;
  const originY = paddingY + plotH / 2;

  const scaleX = (val) => originX + (val / boundX) * (plotW / 2);
  const scaleY = (val) => originY - (val / boundY) * (plotH / 2);

  // Identify top 12 ranked industries for label visibility
  const top12Set = useMemo(() => {
    const ranked = [...plottable]
      .filter((i) => i.rank != null)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 12);
    return new Set(ranked.map((i) => i.basic_industry));
  }, [plottable]);

  const getQuadrantColor = (quad) => {
    switch (quad) {
      case "leading":
        return "#10B981"; // emerald
      case "weakening":
        return "#F59E0B"; // amber
      case "improving":
        return "#3B82F6"; // blue
      case "lagging":
      default:
        return "#EF4444"; // rose
    }
  };

  return (
    <div className="space-y-4">
      {/* Control bar: Sector filter & explanation */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-surface p-3 sm:p-4 rounded-xl border border-border">
        {/* Sector Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          <button
            onClick={() => onSectorChange && onSectorChange("all")}
            className={`px-3 py-1 rounded-full whitespace-nowrap transition-colors border ${
              selectedSector === "all"
                ? "bg-accent/15 border-accent text-accent font-semibold"
                : "bg-surface-subtle border-border text-text-muted hover:text-text"
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
                  : "bg-surface-subtle border-border text-text-muted hover:text-text"
              }`}
            >
              {sec}
            </button>
          ))}
        </div>

        <div className="text-xs text-text-muted flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-accent" />
          <span>Top 12 ranked industries labeled · Hover dot for full details</span>
        </div>
      </div>

      {/* SVG Scatter Plot Canvas */}
      <div className="relative w-full rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto block select-none"
          style={{ minHeight: "420px", maxHeight: "650px" }}
        >
          {/* Quadrant Background Zones */}
          {/* Top-Right: Leading */}
          <rect
            x={originX}
            y={paddingY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#10B981"
            fillOpacity={0.03}
          />
          {/* Bottom-Right: Weakening */}
          <rect
            x={originX}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#F59E0B"
            fillOpacity={0.03}
          />
          {/* Top-Left: Improving */}
          <rect
            x={paddingX}
            y={paddingY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#3B82F6"
            fillOpacity={0.03}
          />
          {/* Bottom-Left: Lagging */}
          <rect
            x={paddingX}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#EF4444"
            fillOpacity={0.03}
          />

          {/* Watermark Labels in Corners */}
          <text
            x={width - paddingX - 12}
            y={paddingY + 22}
            textAnchor="end"
            fontSize="12"
            fontWeight="bold"
            fill="#10B981"
            fillOpacity={0.35}
          >
            LEADING (RS High & Accelerating)
          </text>
          <text
            x={width - paddingX - 12}
            y={height - paddingY - 12}
            textAnchor="end"
            fontSize="12"
            fontWeight="bold"
            fill="#F59E0B"
            fillOpacity={0.35}
          >
            WEAKENING (RS High & Decelerating)
          </text>
          <text
            x={paddingX + 12}
            y={paddingY + 22}
            textAnchor="start"
            fontSize="12"
            fontWeight="bold"
            fill="#3B82F6"
            fillOpacity={0.35}
          >
            IMPROVING (RS Low & Accelerating)
          </text>
          <text
            x={paddingX + 12}
            y={height - paddingY - 12}
            textAnchor="start"
            fontSize="12"
            fontWeight="bold"
            fill="#EF4444"
            fillOpacity={0.35}
          >
            LAGGING (RS Low & Decelerating)
          </text>

          {/* Center Cross Axes */}
          <line
            x1={paddingX}
            y1={originY}
            x2={width - paddingX}
            y2={originY}
            stroke="var(--border, #3F3F46)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          <line
            x1={originX}
            y1={paddingY}
            x2={originX}
            y2={height - paddingY}
            stroke="var(--border, #3F3F46)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />

          {/* Axis Labels */}
          <text
            x={width - paddingX}
            y={originY - 8}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-muted, #A1A1AA)"
            fontWeight="bold"
          >
            RS MOMENTUM (X) →
          </text>
          <text
            x={originX + 8}
            y={paddingY + 12}
            textAnchor="start"
            fontSize="10"
            fill="var(--text-muted, #A1A1AA)"
            fontWeight="bold"
          >
            ↑ RS RATIO (Y)
          </text>

          {/* Industry Data Points */}
          {plottable.map((ind) => {
            const cx = scaleX(ind.rs_x);
            const cy = scaleY(ind.rs_y);
            const color = getQuadrantColor(ind.quadrant);
            const isTop12 = top12Set.has(ind.basic_industry);
            const isHovered = hoveredIndustry?.basic_industry === ind.basic_industry;

            return (
              <g
                key={ind.basic_industry}
                onClick={() => onSelectIndustry && onSelectIndustry(ind)}
                onMouseEnter={() => setHoveredIndustry(ind)}
                onMouseLeave={() => setHoveredIndustry(null)}
                className="cursor-pointer transition-transform"
              >
                {/* Bubble Dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 8 : isTop12 ? 6 : 4}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={isHovered ? 2.5 : 1.5}
                  fillOpacity={isHovered ? 1 : 0.85}
                />

                {/* Top 12 Labels */}
                {isTop12 && !isHovered && (
                  <text
                    x={cx + 8}
                    y={cy + 4}
                    fontSize="10"
                    fontWeight="bold"
                    fill="var(--text, #E4E4E7)"
                    className="select-none pointer-events-none drop-shadow"
                  >
                    #{ind.rank} {ind.basic_industry.length > 18 ? `${ind.basic_industry.substring(0, 16)}…` : ind.basic_industry}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredIndustry && (
          <div
            className="absolute z-20 pointer-events-none bg-surface-subtle p-3 rounded-lg border border-border shadow-xl text-xs space-y-1"
            style={{
              left: Math.min(width - 240, Math.max(10, scaleX(hoveredIndustry.rs_x) - 100)),
              top: Math.max(10, scaleY(hoveredIndustry.rs_y) - 95),
            }}
          >
            <div className="flex items-center gap-1.5 font-bold text-text">
              {hoveredIndustry.rank != null && (
                <span className="text-accent font-mono">#{hoveredIndustry.rank}</span>
              )}
              <span>{hoveredIndustry.basic_industry}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              {hoveredIndustry.sector} · {hoveredIndustry.n_stocks} stocks · {formatMcap(hoveredIndustry.mcap_cr)}
            </div>
            <div className="flex items-center gap-3 pt-1 font-mono text-[11px]">
              <span>RS Mom: {hoveredIndustry.rs_x?.toFixed(2)}</span>
              <span>RS Ratio: {hoveredIndustry.rs_y?.toFixed(2)}</span>
              <span className="font-bold uppercase text-accent">{hoveredIndustry.tag}</span>
            </div>
          </div>
        )}
      </div>

      {/* Quadrant Legend Bar */}
      <div className="p-3 bg-surface rounded-xl border border-border flex flex-wrap items-center justify-between text-xs text-text-muted gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="font-medium text-text">Leading</span>
            <span>(RS &gt; 100, Momentum &gt; 0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="font-medium text-text">Weakening</span>
            <span>(RS &gt; 100, Momentum &le; 0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="font-medium text-text">Improving</span>
            <span>(RS &le; 100, Momentum &gt; 0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="font-medium text-text">Lagging</span>
            <span>(RS &le; 100, Momentum &le; 0)</span>
          </div>
        </div>
        <span className="text-text-muted">Benchmark: NIFTY 500</span>
      </div>
    </div>
  );
}
