"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import ComparisonChart from "@/components/charts/ComparisonChart";
import { formatShortDate } from "@/lib/formatters";

export function LargeMidSmall({ performance = {}, rebasedSeries = {} }) {
  const [period, setPeriod] = useState("3M");

  const PERIODS = [
    { id: "1M", label: "1M" },
    { id: "3M", label: "3M" },
    { id: "YTD", label: "YTD" },
  ];

  // 1. Process rebasedSeries for the selected period slice
  const { chartData, activeSeries, availability } = useMemo(() => {
    const largeRows = rebasedSeries?.large || [];
    const midRows = rebasedSeries?.mid || [];
    const smallRows = rebasedSeries?.small || [];

    // Collect unique dates across all available segments
    const dateSet = new Set();
    largeRows.forEach((r) => r.date && dateSet.add(r.date));
    midRows.forEach((r) => r.date && dateSet.add(r.date));
    smallRows.forEach((r) => r.date && dateSet.add(r.date));

    const sortedDates = Array.from(dateSet).sort();
    if (sortedDates.length === 0) {
      return {
        chartData: [],
        activeSeries: [],
        availability: { large: false, mid: false, small: false },
      };
    }

    // Determine slice range for the chosen period
    let sliceDates = sortedDates;
    if (period === "1M") {
      sliceDates = sortedDates.slice(-21);
    } else if (period === "3M") {
      sliceDates = sortedDates.slice(-63);
    } else if (period === "YTD") {
      const currentYear = new Date().getFullYear().toString();
      const ytdDates = sortedDates.filter((d) => d.startsWith(currentYear));
      sliceDates = ytdDates.length > 0 ? ytdDates : sortedDates.slice(-63);
    }

    if (sliceDates.length === 0) {
      return {
        chartData: [],
        activeSeries: [],
        availability: { large: false, mid: false, small: false },
      };
    }

    // Map dates to row entries
    const largeMap = new Map(largeRows.map((r) => [r.date, r]));
    const midMap = new Map(midRows.map((r) => [r.date, r]));
    const smallMap = new Map(smallRows.map((r) => [r.date, r]));

    // Find baseline (first valid session in slice) for each series
    const getBaseVal = (map) => {
      for (const d of sliceDates) {
        const row = map.get(d);
        if (row && typeof row.rebased === "number" && row.rebased > 0) {
          return row.rebased;
        }
      }
      return null;
    };

    const largeBase = getBaseVal(largeMap);
    const midBase = getBaseVal(midMap);
    const smallBase = getBaseVal(smallMap);

    const calcReturn = (map, baseVal, date) => {
      if (!baseVal) return null;
      const row = map.get(date);
      if (!row || typeof row.rebased !== "number" || isNaN(row.rebased)) {
        return null;
      }
      return Number((((row.rebased - baseVal) / baseVal) * 100).toFixed(2));
    };

    const data = sliceDates.map((date) => ({
      date: formatShortDate(date),
      large: calcReturn(largeMap, largeBase, date),
      mid: calcReturn(midMap, midBase, date),
      small: calcReturn(smallMap, smallBase, date),
    }));

    // Active chart lines: if a series is missing, exclude it
    const lines = [];
    if (largeBase !== null) {
      lines.push({ key: "large", name: "Large", color: "#2563EB", strokeWidth: 1.75 });
    }
    if (midBase !== null) {
      lines.push({ key: "mid", name: "Mid", color: "#F97316", strokeWidth: 1.5 });
    }
    if (smallBase !== null) {
      lines.push({ key: "small", name: "Small", color: "#16A878", strokeWidth: 1.25 });
    }

    return {
      chartData: data,
      activeSeries: lines,
      availability: {
        large: largeBase !== null,
        mid: midBase !== null,
        small: smallBase !== null,
      },
    };
  }, [rebasedSeries, period]);

  const largePerf = availability.large ? (performance?.large?.[period] ?? null) : null;
  const midPerf = availability.mid ? (performance?.mid?.[period] ?? null) : null;
  const smallPerf = availability.small ? (performance?.small?.[period] ?? null) : null;

  const segmentStats = useMemo(() => {
    return [
      { id: "large", label: "Large", pct: largePerf, color: "#2563EB" },
      { id: "mid", label: "Mid", pct: midPerf, color: "#F97316" },
      { id: "small", label: "Small", pct: smallPerf, color: "#16A878" },
    ];
  }, [largePerf, midPerf, smallPerf]);

  const leaderText = useMemo(() => {
    const valid = segmentStats.filter((s) => s.pct !== null);
    if (valid.length === 0) return "—";
    const sorted = [...valid].sort((a, b) => b.pct - a.pct);
    if (sorted[0].id === "large") return "Large caps lead";
    if (sorted[0].id === "mid") return "Mid caps lead";
    return "Small caps lead";
  }, [segmentStats]);

  const referenceText = useMemo(() => {
    if (period === "1M") return "Nifty 50 vs Midcap 150 vs Smallcap 250, 1-month return";
    if (period === "YTD") return "Nifty 50 vs Midcap 150 vs Smallcap 250, return YTD";
    return "Nifty 50 vs Midcap 150 vs Smallcap 250, return over 3 months";
  }, [period]);

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-text truncate">Large · Mid · Small</div>
          <div className="text-[10px] text-text-secondary truncate">{referenceText}</div>
        </div>
        <div className="shrink-0">
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="xs"
          />
        </div>
      </div>

      {/* Segment Pill Returns */}
      <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
        <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
          {segmentStats.map((seg) => (
            <span
              key={seg.id}
              className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-border bg-bg-secondary flex items-center gap-1 tabular-nums"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-text-secondary">{seg.label}:</span>
              <span
                className={
                  seg.pct === null
                    ? "text-text-secondary"
                    : seg.pct >= 0
                    ? "text-bullish"
                    : "text-bearish"
                }
              >
                {seg.pct !== null ? `${seg.pct >= 0 ? "+" : ""}${seg.pct.toFixed(1)}%` : "—"}
              </span>
            </span>
          ))}
        </div>
        <span className="text-[10px] sm:text-[11px] font-medium text-text shrink-0 pl-1">{leaderText}</span>
      </div>

      {/* Comparison Chart */}
      <ComparisonChart
        data={chartData}
        xKey="date"
        series={activeSeries}
        height={145}
      />
    </BaseCard>
  );
}

export default LargeMidSmall;
