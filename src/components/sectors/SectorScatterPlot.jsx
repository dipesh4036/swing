"use client";

import React, { useState } from "react";

export default function SectorScatterPlot({
  sectors = [],
  selectedSectorKey = null,
  onSelectSector = null,
}) {
  const [hoveredSector, setHoveredSector] = useState(null);

  // Plottable sectors have valid x and y
  const plottable = sectors.filter((s) => s.x != null && s.y != null && s.quadrant != null);
  const unplottable = sectors.filter((s) => s.x == null || s.y == null || s.quadrant == null);

  // Determine plot boundaries centered at 0, 0
  let maxX = 6;
  let maxY = 6;
  for (const s of plottable) {
    if (Math.abs(s.x) > maxX) maxX = Math.ceil(Math.abs(s.x)) + 1;
    if (Math.abs(s.y) > maxY) maxY = Math.ceil(Math.abs(s.y)) + 1;
  }
  const boundX = Math.max(maxX, 5);
  const boundY = Math.max(maxY, 5);

  const width = 640;
  const height = 400;
  const padding = 40;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;
  const originX = padding + plotW / 2;
  const originY = padding + plotH / 2;

  const scaleX = (val) => originX + (val / boundX) * (plotW / 2);
  const scaleY = (val) => originY - (val / boundY) * (plotH / 2);

  const getQuadrantColor = (q) => {
    switch (q) {
      case "leading":
        return "#10B981"; // green
      case "improving":
        return "#3B82F6"; // blue
      case "weakening":
        return "#F59E0B"; // amber
      case "lagging":
        return "#EF4444"; // red
      default:
        return "#64748B";
    }
  };

  return (
    <div className="flex flex-col w-full bg-surface border border-border rounded-lg p-3">
      <div className="flex items-center justify-between pb-2 border-b border-border text-xs">
        <div>
          <span className="font-semibold text-text">RS Trend Rotation Map</span>
          <span className="text-text-secondary ml-2 text-[11px]">
            (x: RS vs 50 SMA %, y: 10d RS Momentum %)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Leading
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Improving
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Weakening
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Lagging
          </span>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full flex items-center justify-center pt-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-h-[380px] select-none"
        >
          {/* Quadrant Background Tints */}
          {/* Top-Right: Leading */}
          <rect
            x={originX}
            y={padding}
            width={plotW / 2}
            height={plotH / 2}
            fill="#10B981"
            fillOpacity="0.04"
          />
          {/* Top-Left: Improving */}
          <rect
            x={padding}
            y={padding}
            width={plotW / 2}
            height={plotH / 2}
            fill="#3B82F6"
            fillOpacity="0.04"
          />
          {/* Bottom-Left: Lagging */}
          <rect
            x={padding}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#EF4444"
            fillOpacity="0.04"
          />
          {/* Bottom-Right: Weakening */}
          <rect
            x={originX}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#F59E0B"
            fillOpacity="0.04"
          />

          {/* Quadrant Watermark Labels */}
          <text
            x={originX + plotW / 4}
            y={originY - plotH / 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-[14px] font-bold fill-emerald-500/20 tracking-wider pointer-events-none"
          >
            LEADING
          </text>
          <text
            x={originX - plotW / 4}
            y={originY - plotH / 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-[14px] font-bold fill-blue-500/20 tracking-wider pointer-events-none"
          >
            IMPROVING
          </text>
          <text
            x={originX - plotW / 4}
            y={originY + plotH / 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-[14px] font-bold fill-rose-500/20 tracking-wider pointer-events-none"
          >
            LAGGING
          </text>
          <text
            x={originX + plotW / 4}
            y={originY + plotH / 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-[14px] font-bold fill-amber-500/20 tracking-wider pointer-events-none"
          >
            WEAKENING
          </text>

          {/* Centered Crosshairs (0, 0) */}
          <line
            x1={padding}
            y1={originY}
            x2={width - padding}
            y2={originY}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <line
            x1={originX}
            y1={padding}
            x2={originX}
            y2={height - padding}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Axis End Ticks & Labels */}
          <text
            x={width - padding + 5}
            y={originY + 4}
            className="text-[10px] fill-text-secondary"
            textAnchor="start"
          >
            +{boundX}%
          </text>
          <text
            x={padding - 5}
            y={originY + 4}
            className="text-[10px] fill-text-secondary"
            textAnchor="end"
          >
            -{boundX}%
          </text>
          <text
            x={originX}
            y={padding - 10}
            className="text-[10px] fill-text-secondary"
            textAnchor="middle"
          >
            +{boundY}%
          </text>
          <text
            x={originX}
            y={height - padding + 15}
            className="text-[10px] fill-text-secondary"
            textAnchor="middle"
          >
            -{boundY}%
          </text>

          {/* Sector Data Points */}
          {plottable.map((s) => {
            const cx = scaleX(s.x);
            const cy = scaleY(s.y);
            const isSelected = selectedSectorKey === s.key;
            const isHovered = hoveredSector?.key === s.key;
            const color = getQuadrantColor(s.quadrant);

            return (
              <g
                key={s.key}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectSector && onSelectSector(s)}
                onMouseEnter={() => setHoveredSector(s)}
                onMouseLeave={() => setHoveredSector(null)}
              >
                {/* Active / Selection Ring */}
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r="14"
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray="3 3"
                    className="animate-spin origin-center"
                  />
                )}
                {/* Dot */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered || isSelected ? 8 : 6}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={isHovered || isSelected ? 2 : 1}
                  className="transition-all duration-150"
                />
                {/* Label */}
                <text
                  x={cx}
                  y={cy - 10}
                  textAnchor="middle"
                  className={`text-[11px] font-semibold transition-colors ${
                    isSelected ? "fill-text font-bold" : "fill-text-secondary"
                  }`}
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Box */}
        {hoveredSector && (
          <div
            className="absolute z-20 pointer-events-none bg-surface/95 backdrop-blur-sm border border-border shadow-lg rounded-md p-2.5 text-xs text-text min-w-[170px]"
            style={{
              left: `${Math.min(
                Math.max(scaleX(hoveredSector.x) - 85, 10),
                width - 180
              )}px`,
              top: `${Math.max(scaleY(hoveredSector.y) - 75, 10)}px`,
            }}
          >
            <div className="font-semibold text-sm flex items-center justify-between pb-1 border-b border-border/50">
              <span>{hoveredSector.label}</span>
              <span
                className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${getQuadrantColor(hoveredSector.quadrant)}20`,
                  color: getQuadrantColor(hoveredSector.quadrant),
                }}
              >
                {hoveredSector.quadrant}
              </span>
            </div>
            <div className="pt-1.5 space-y-0.5 text-[11px] text-text-secondary font-mono">
              <div className="flex justify-between">
                <span>1M Return:</span>
                <span className={hoveredSector.ret_1m >= 0 ? "text-emerald-500" : "text-rose-500"}>
                  {hoveredSector.ret_1m != null ? `${hoveredSector.ret_1m > 0 ? "+" : ""}${hoveredSector.ret_1m}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>1M RS vs Nifty 500:</span>
                <span className={hoveredSector.rs_1m >= 0 ? "text-emerald-500" : "text-rose-500"}>
                  {hoveredSector.rs_1m != null ? `${hoveredSector.rs_1m > 0 ? "+" : ""}${hoveredSector.rs_1m}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>RS vs 50 SMA (x):</span>
                <span>{hoveredSector.x != null ? `${hoveredSector.x > 0 ? "+" : ""}${hoveredSector.x}%` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>10d Momentum (y):</span>
                <span>{hoveredSector.y != null ? `${hoveredSector.y > 0 ? "+" : ""}${hoveredSector.y}%` : "—"}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Insufficient History Footer */}
      {unplottable.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span className="text-[11px] font-medium text-text-muted">Insufficient History (&lt;60 sessions):</span>
          {unplottable.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectSector && onSelectSector(s)}
              className={`px-2 py-0.5 rounded text-[11px] border border-border bg-bg-secondary hover:text-text transition-colors ${
                selectedSectorKey === s.key ? "ring-1 ring-primary text-text font-semibold" : ""
              }`}
            >
              {s.label} ({s.price_source === "equal_weight" ? "EW" : "official"})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
