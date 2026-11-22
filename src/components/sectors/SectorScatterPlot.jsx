"use client";

import React, { useState, useMemo } from "react";

/**
 * SectorScatterPlot: RS Trend Rotation Map (T10.3, T14)
 * - Auto-ranged symmetric axes with padding
 * - Short sector labels with deterministic 8-direction collision avoidance pass
 * - Corner watermarks (outside the scatter data cluster)
 * - Click to filter sector, hover tooltip
 */
export default function SectorScatterPlot({
  sectors = [],
  selectedSectorKey = null,
  onSelectSector = null,
}) {
  const [hoveredSector, setHoveredSector] = useState(null);

  // Plottable sectors: must have valid x, y, quadrant, and NOT be insufficient constituents (<8)
  const plottable = useMemo(() => {
    return sectors.filter(
      (s) =>
        s.x != null &&
        s.y != null &&
        s.quadrant != null &&
        !s.insufficient_data &&
        (s.n_valid == null || s.n_valid >= 8)
    );
  }, [sectors]);

  // Determine auto-ranged symmetric boundaries around 0 (T14.2)
  const { boundX, boundY } = useMemo(() => {
    let maxX = 3.0;
    let maxY = 3.0;
    for (const s of plottable) {
      if (Math.abs(s.x) > maxX) maxX = Math.abs(s.x);
      if (Math.abs(s.y) > maxY) maxY = Math.abs(s.y);
    }
    const maxVal = Math.max(maxX, maxY) * 1.25; // 25% padding
    const bound = Math.max(4.0, Math.ceil(maxVal * 2) / 2);
    return { boundX: bound, boundY: bound };
  }, [plottable]);

  const width = 800;
  const height = 480;
  const paddingX = 45;
  const paddingY = 40;
  const plotW = width - paddingX * 2;
  const plotH = height - paddingY * 2;
  const originX = paddingX + plotW / 2;
  const originY = paddingY + plotH / 2;

  const scaleX = (val) => originX + (val / boundX) * (plotW / 2);
  const scaleY = (val) => originY - (val / boundY) * (plotH / 2);

  // Deterministic 8-position label placement pass with overlap avoidance (T14.3)
  const placedLabels = useMemo(() => {
    const scaleXLocal = (val) => originX + (val / boundX) * (plotW / 2);
    const scaleYLocal = (val) => originY - (val / boundY) * (plotH / 2);

    const placed = [];
    const candidateOffsets = [
      { dx: 12, dy: -6, anchor: "start" },   // right-up
      { dx: 12, dy: 6, anchor: "start" },    // right-down
      { dx: 0, dy: -14, anchor: "middle" },  // top
      { dx: 0, dy: 16, anchor: "middle" },   // bottom
      { dx: -12, dy: -6, anchor: "end" },    // left-up
      { dx: -12, dy: 6, anchor: "end" },     // left-down
      { dx: 14, dy: 0, anchor: "start" },    // right
      { dx: -14, dy: 0, anchor: "end" },     // left
    ];

    const boxes = [];

    for (const s of plottable) {
      const dotX = scaleXLocal(s.x);
      const dotY = scaleYLocal(s.y);
      const labelText = s.short || s.label;
      const charWidth = 6.5;
      const boxW = Math.max(30, labelText.length * charWidth);
      const boxH = 14;

      let bestOffset = candidateOffsets[0];
      let bestX = dotX + bestOffset.dx;
      let bestY = dotY + bestOffset.dy;

      for (const off of candidateOffsets) {
        let lx = dotX + off.dx;
        let ly = dotY + off.dy;

        // Bounding box approximation
        let left = off.anchor === "start" ? lx : off.anchor === "end" ? lx - boxW : lx - boxW / 2;
        let right = left + boxW;
        let top = ly - boxH / 2;
        let bottom = top + boxH;

        // Check if overlaps any existing box or plot edges
        const inBounds = left >= paddingX && right <= width - paddingX && top >= paddingY && bottom <= height - paddingY;
        let overlaps = false;
        if (inBounds) {
          for (const b of boxes) {
            if (!(right < b.left || left > b.right || bottom < b.top || top > b.bottom)) {
              overlaps = true;
              break;
            }
          }
        } else {
          overlaps = true;
        }

        if (!overlaps) {
          bestOffset = off;
          bestX = lx;
          bestY = ly;
          boxes.push({ left, right, top, bottom });
          break;
        }
      }

      // If all overlapped, clamp to plot area
      placed.push({
        sector: s,
        dotX,
        dotY,
        labelX: Math.max(paddingX + 15, Math.min(width - paddingX - 15, bestX)),
        labelY: Math.max(paddingY + 10, Math.min(height - paddingY - 10, bestY)),
        anchor: bestOffset.anchor,
        text: labelText,
        moved: Math.abs(bestOffset.dx) > 12 || Math.abs(bestOffset.dy) > 12,
      });
    }

    return placed;
  }, [plottable, boundX, boundY, originX, originY, plotW, plotH]);

  const getQuadrantColor = (q) => {
    switch (q?.toLowerCase()) {
      case "leading":
        return "#10B981"; // emerald
      case "improving":
        return "#3B82F6"; // blue
      case "weakening":
        return "#F59E0B"; // amber
      case "lagging":
        return "#F43F5E"; // rose
      default:
        return "#71717A";
    }
  };

  return (
    <div className="flex flex-col w-full bg-surface border border-border rounded-lg p-3">
      {/* Header and Legend */}
      <div className="flex items-center justify-between pb-2 border-b border-border text-xs flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text">RS Trend Rotation Map</span>
          <span className="text-text-muted text-[11px] font-mono hidden sm:inline">
            (x: RS vs 50 SMA %, y: 10d RS Momentum %)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Leading
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Improving
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Weakening
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Lagging
          </span>
        </div>
      </div>

      {/* SVG Canvas (responsive full width, T14.2) */}
      <div className="relative w-full flex items-center justify-center pt-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-h-[440px] select-none"
        >
          {/* Quadrant Background Tints */}
          <rect
            x={originX}
            y={paddingY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#10B981"
            fillOpacity="0.04"
          />
          <rect
            x={paddingX}
            y={paddingY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#3B82F6"
            fillOpacity="0.04"
          />
          <rect
            x={paddingX}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#F43F5E"
            fillOpacity="0.04"
          />
          <rect
            x={originX}
            y={originY}
            width={plotW / 2}
            height={plotH / 2}
            fill="#F59E0B"
            fillOpacity="0.04"
          />

          {/* Corner Watermarks (T14.4: Placed in outer corners so they never overlap dots) */}
          <text
            x={width - paddingX - 10}
            y={paddingY + 16}
            textAnchor="end"
            className="text-[11px] font-bold fill-emerald-500/25 tracking-widest uppercase pointer-events-none"
          >
            LEADING (x&gt;0, y&gt;0)
          </text>
          <text
            x={paddingX + 10}
            y={paddingY + 16}
            textAnchor="start"
            className="text-[11px] font-bold fill-blue-500/25 tracking-widest uppercase pointer-events-none"
          >
            IMPROVING (x≤0, y&gt;0)
          </text>
          <text
            x={paddingX + 10}
            y={height - paddingY - 8}
            textAnchor="start"
            className="text-[11px] font-bold fill-rose-500/25 tracking-widest uppercase pointer-events-none"
          >
            LAGGING (x≤0, y≤0)
          </text>
          <text
            x={width - paddingX - 10}
            y={height - paddingY - 8}
            textAnchor="end"
            className="text-[11px] font-bold fill-amber-500/25 tracking-widest uppercase pointer-events-none"
          >
            WEAKENING (x&gt;0, y≤0)
          </text>

          {/* Centered Crosshairs (0, 0) */}
          <line
            x1={paddingX}
            y1={originY}
            x2={width - paddingX}
            y2={originY}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          <line
            x1={originX}
            y1={paddingY}
            x2={originX}
            y2={height - paddingY}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />

          {/* Axis Labels & Values */}
          <text
            x={width - paddingX + 6}
            y={originY + 4}
            className="text-[10px] font-mono fill-text-muted"
            textAnchor="start"
          >
            +{boundX}%
          </text>
          <text
            x={paddingX - 6}
            y={originY + 4}
            className="text-[10px] font-mono fill-text-muted"
            textAnchor="end"
          >
            -{boundX}%
          </text>
          <text
            x={originX}
            y={paddingY - 8}
            className="text-[10px] font-mono fill-text-muted"
            textAnchor="middle"
          >
            +{boundY}%
          </text>
          <text
            x={originX}
            y={height - paddingY + 14}
            className="text-[10px] font-mono fill-text-muted"
            textAnchor="middle"
          >
            -{boundY}%
          </text>

          {/* Leader lines for moved labels */}
          {placedLabels.map(({ sector, dotX, dotY, labelX, labelY, moved }) => {
            if (!moved) return null;
            return (
              <line
                key={`line-${sector.key}`}
                x1={dotX}
                y1={dotY}
                x2={labelX}
                y2={labelY}
                stroke="currentColor"
                className="text-border/60"
                strokeWidth="0.8"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Sector Dots & Labels */}
          {placedLabels.map(({ sector, dotX, dotY, labelX, labelY, anchor, text }) => {
            const isSelected = selectedSectorKey === sector.key;
            const isHovered = hoveredSector?.key === sector.key;
            const color = getQuadrantColor(sector.quadrant);

            return (
              <g
                key={sector.key}
                onClick={() => onSelectSector && onSelectSector(sector.key)}
                onMouseEnter={() => setHoveredSector(sector)}
                onMouseLeave={() => setHoveredSector(null)}
                className="cursor-pointer"
              >
                {/* Hit target for touch/mouse */}
                <circle cx={dotX} cy={dotY} r={16} fill="transparent" />

                {/* Outer ring on selected or hovered */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={dotX}
                    cy={dotY}
                    r={9}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                  />
                )}

                {/* Data Dot */}
                <circle
                  cx={dotX}
                  cy={dotY}
                  r={isSelected ? 5.5 : 4.5}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={1.2}
                />

                {/* Sector Short Label */}
                <text
                  x={labelX}
                  y={labelY + 3.5}
                  textAnchor={anchor}
                  className={`text-[10px] font-medium select-none pointer-events-none ${
                    isSelected ? "font-bold fill-primary" : "fill-text"
                  }`}
                >
                  {text}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Box */}
        {hoveredSector && (
          <div className="absolute top-4 right-4 z-20 bg-surface/95 backdrop-blur-sm border border-border shadow-md rounded-md p-2.5 text-xs flex flex-col gap-1 min-w-[190px] pointer-events-none">
            <div className="flex items-center justify-between border-b border-border pb-1">
              <span className="font-bold text-text">{hoveredSector.label}</span>
              <span
                className="px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase"
                style={{
                  backgroundColor: `${getQuadrantColor(hoveredSector.quadrant)}20`,
                  color: getQuadrantColor(hoveredSector.quadrant),
                }}
              >
                {hoveredSector.quadrant}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] font-mono pt-0.5">
              <span className="text-text-muted">RS vs 50 SMA:</span>
              <span className="text-right font-medium">
                {hoveredSector.x >= 0 ? "+" : ""}{hoveredSector.x}%
              </span>
              <span className="text-text-muted">10d RS Momentum:</span>
              <span className="text-right font-medium">
                {hoveredSector.y >= 0 ? "+" : ""}{hoveredSector.y}%
              </span>
              <span className="text-text-muted">1M Return:</span>
              <span className="text-right font-medium">
                {hoveredSector.ret_1m != null ? `${hoveredSector.ret_1m >= 0 ? "+" : ""}${hoveredSector.ret_1m}%` : "—"}
              </span>
              <span className="text-text-muted">1M RS vs N500:</span>
              <span className="text-right font-medium">
                {hoveredSector.rs_1m != null ? `${hoveredSector.rs_1m >= 0 ? "+" : ""}${hoveredSector.rs_1m}%` : "—"}
              </span>
              <span className="text-text-muted">&gt; 50 DMA:</span>
              <span className="text-right font-medium">
                {hoveredSector.pct_above_50dma != null ? `${hoveredSector.pct_above_50dma}%` : "—"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
