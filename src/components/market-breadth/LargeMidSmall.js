"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import ComparisonChart from "@/components/charts/ComparisonChart";
import { formatShortDate } from "@/lib/formatters";

export function LargeMidSmall({ performance = {}, rebasedSeries = {}, capSeries = {} }) {
  const [period, setPeriod] = useState("3M");

  const PERIODS = [
    { id: "1M", label: "1M" },
    { id: "3M", label: "3M" },
    { id: "YTD", label: "YTD" },
  ];

  // 1. Process capSeries (or fallback rebasedSeries) for the selected period slice
  const { chartData, activeSeries, lastReturns } = useMemo(() => {
    // Prefer raw 260-session capSeries independent of dashboard period (R17)
    const largeRows = capSeries?.large?.length ? capSeries.large : rebasedSeries?.large || [];
    const midRows = capSeries?.mid?.length ? capSeries.mid : rebasedSeries?.mid || [];
    const smallRows = capSeries?.small?.length ? capSeries.small : rebasedSeries?.small || [];

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
        lastReturns: { large: null, mid: null, small: null },
      };
    }

    // Determine slice range for the chosen period
    let sliceDates = [];
    if (period === "1M") {
      if (sortedDates.length >= 21) {
        sliceDates = sortedDates.slice(-21);
      }
    } else if (period === "3M") {
      if (sortedDates.length >= 63) {
        sliceDates = sortedDates.slice(-63);
      }
    } else if (period === "YTD") {
      // Use session dates from the data, not the browser clock (R17)
      const latestDate = sortedDates[sortedDates.length - 1];
      const currentYear = latestDate.split("-")[0];
      const ytdDates = sortedDates.filter((d) => d.startsWith(currentYear));
      sliceDates = ytdDates;
    }

    if (sliceDates.length === 0) {
      return {
        chartData: [],
        activeSeries: [],
        lastReturns: { large: null, mid: null, small: null },
      };
    }

    // Map dates to row entries
    const largeMap = new Map(largeRows.map((r) => [r.date, r]));
    const midMap = new Map(midRows.map((r) => [r.date, r]));
    const smallMap = new Map(smallRows.map((r) => [r.date, r]));

    // Required sessions check: if a series has fewer sessions than needed, hide it and show "—"
    const requiredSessions = period === "1M" ? 21 : period === "3M" ? 63 : sliceDates.length;

    const countValidSessions = (map) => {
      let count = 0;
      for (const d of sliceDates) {
        const row = map.get(d);
        const val = row?.close ?? row?.rebased;
        if (typeof val === "number" && !isNaN(val) && val > 0) {
          count++;
        }
      }
      return count;
    };

    const isLargeValid = requiredSessions > 0 && countValidSessions(largeMap) >= requiredSessions;
    const isMidValid = requiredSessions > 0 && countValidSessions(midMap) >= requiredSessions;
    const isSmallValid = requiredSessions > 0 && countValidSessions(smallMap) >= requiredSessions;

    // Find baseline (first valid session in slice) for each series
    const getBaseVal = (map) => {
      for (const d of sliceDates) {
        const row = map.get(d);
        const val = row?.close ?? row?.rebased;
        if (typeof val === "number" && !isNaN(val) && val > 0) {
          return val;
        }
      }
      return null;
    };

    const largeBase = isLargeValid ? getBaseVal(largeMap) : null;
    const midBase = isMidValid ? getBaseVal(midMap) : null;
    const smallBase = isSmallValid ? getBaseVal(smallMap) : null;

    const calcReturn = (map, baseVal, date) => {
      if (!baseVal) return null;
      const row = map.get(date);
      const val = row?.close ?? row?.rebased;
      if (typeof val !== "number" || isNaN(val)) {
        return null;
      }
      return Number((((val - baseVal) / baseVal) * 100).toFixed(2));
    };

    const data = sliceDates.map((date) => ({
      date: formatShortDate(date),
      large: isLargeValid ? calcReturn(largeMap, largeBase, date) : null,
      mid: isMidValid ? calcReturn(midMap, midBase, date) : null,
      small: isSmallValid ? calcReturn(smallMap, smallBase, date) : null,
    }));

    // Active chart lines: if a series is missing or has fewer sessions than needed, exclude it
    const lines = [];
    if (isLargeValid && largeBase !== null) {
      lines.push({ key: "large", name: "Large", color: "#2563EB", strokeWidth: 1.75 });
    }
    if (isMidValid && midBase !== null) {
      lines.push({ key: "mid", name: "Mid", color: "#F97316", strokeWidth: 1.5 });
    }
    if (isSmallValid && smallBase !== null) {
      lines.push({ key: "small", name: "Small", color: "#16A878", strokeWidth: 1.25 });
    }

    // Pills must come from the same slice so the chart's last point equals the pill value (R17)
    const lastDate = sliceDates[sliceDates.length - 1];
    const lastLarge = isLargeValid ? calcReturn(largeMap, largeBase, lastDate) : null;
    const lastMid = isMidValid ? calcReturn(midMap, midBase, lastDate) : null;
    const lastSmall = isSmallValid ? calcReturn(smallMap, smallBase, lastDate) : null;

    return {
      chartData: data,
      activeSeries: lines,
      lastReturns: {
        large: lastLarge,
        mid: lastMid,
        small: lastSmall,
      },
    };
  }, [capSeries, rebasedSeries, period]);

  const segmentStats = useMemo(() => {
    return [
      { id: "large", label: "Large", pct: lastReturns.large, color: "#2563EB" },
      { id: "mid", label: "Mid", pct: lastReturns.mid, color: "#F97316" },
      { id: "small", label: "Small", pct: lastReturns.small, color: "#16A878" },
    ];
  }, [lastReturns]);

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
