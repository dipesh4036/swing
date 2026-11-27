"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import ComparisonChart from "@/components/charts/ComparisonChart";
import { formatShortDate } from "@/lib/formatters";

export function LargeMidSmall({ rebasedSeries = {}, capSeries = {} }) {
  const [period, setPeriod] = useState("3M");

  const PERIODS = [
    { id: "1M", label: "1M" },
    { id: "3M", label: "3M" },
    { id: "YTD", label: "YTD" },
  ];

  // 1. Process capSeries (or fallback rebasedSeries) for the selected period slice
  const { chartData, activeSeries, lastReturns } = useMemo(() => {
    // Helper to extract series rows from either array or object wrapper
    const getSeriesRows = (key) => {
      const val = capSeries?.[key];
      if (Array.isArray(val)) return val;
      if (Array.isArray(val?.series)) return val.series;
      if (Array.isArray(val?.rows)) return val.rows;
      return rebasedSeries?.[key] || [];
    };

    // Helper to extract prevYearClose
    const getPrevYearClose = (key) => {
      const val = capSeries?.[key];
      if (typeof val?.prevYearClose === "number") return val.prevYearClose;
      if (typeof capSeries?.prevYearClose?.[key] === "number") return capSeries.prevYearClose[key];
      if (typeof capSeries?.prevYearCloses?.[key] === "number") return capSeries.prevYearCloses[key];
      return null;
    };

    const largeRows = getSeriesRows("large");
    const midRows = getSeriesRows("mid");
    const smallRows = getSeriesRows("small");

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

    // Determine slice range for the chosen period (R18: N+1 sessions for 1M/3M, full current year for YTD)
    let sliceDates = [];
    let requiredCount = 0;

    if (period === "1M") {
      requiredCount = 22; // 21 + 1 (base session 21 sessions ago)
      if (sortedDates.length >= 22) {
        sliceDates = sortedDates.slice(-22);
      }
    } else if (period === "3M") {
      requiredCount = 64; // 63 + 1 (base session 63 sessions ago)
      if (sortedDates.length >= 64) {
        sliceDates = sortedDates.slice(-64);
      }
    } else if (period === "YTD") {
      // Use session dates from the data, not the browser clock (R17)
      const latestDate = sortedDates[sortedDates.length - 1];
      const currentYear = latestDate.split("-")[0];
      sliceDates = sortedDates.filter((d) => d.startsWith(currentYear));
      requiredCount = sliceDates.length;
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

    // Determine base value for return calculation
    // 1M/3M: base is the first session in sliceDates (which is N sessions before last)
    // YTD: base is prevYearClose from capSeries
    const getBaseVal = (key, map) => {
      if (period === "YTD") {
        const prevClose = getPrevYearClose(key);
        if (typeof prevClose === "number" && !isNaN(prevClose) && prevClose > 0) {
          return prevClose;
        }
        return null;
      }
      const baseDate = sliceDates[0];
      const row = map.get(baseDate);
      const val = row?.close ?? row?.rebased;
      if (typeof val === "number" && !isNaN(val) && val > 0) {
        return val;
      }
      return null;
    };

    const largeBase = getBaseVal("large", largeMap);
    const midBase = getBaseVal("mid", midMap);
    const smallBase = getBaseVal("small", smallMap);

    // Validity check: series must have requiredCount valid sessions AND a valid base
    const isLargeValid = requiredCount > 0 && countValidSessions(largeMap) >= requiredCount && largeBase !== null;
    const isMidValid = requiredCount > 0 && countValidSessions(midMap) >= requiredCount && midBase !== null;
    const isSmallValid = requiredCount > 0 && countValidSessions(smallMap) >= requiredCount && smallBase !== null;

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
    if (isLargeValid) {
      lines.push({ key: "large", name: "Large", color: "#2563EB", strokeWidth: 1.75 });
    }
    if (isMidValid) {
      lines.push({ key: "mid", name: "Mid", color: "#F97316", strokeWidth: 1.5 });
    }
    if (isSmallValid) {
      lines.push({ key: "small", name: "Small", color: "#16A878", strokeWidth: 1.25 });
    }

    // Pills must come from the same slice so the chart's last point equals the pill value (R17/R18)
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
          <div className="text-xs text-text-secondary truncate">{referenceText}</div>
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
              className="text-xs sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-border bg-bg-secondary flex items-center gap-1 tabular-nums"
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
        <span className="text-xs sm:text-xs font-medium text-text shrink-0 pl-1">{leaderText}</span>
      </div>

      {/* Comparison Line Chart */}
      <div className="pt-1 w-full min-w-0">
        <ComparisonChart
          data={chartData}
          series={activeSeries}
          height={140}
        />
      </div>
    </BaseCard>
  );
}

export default LargeMidSmall;
