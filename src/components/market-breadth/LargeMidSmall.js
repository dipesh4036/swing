"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import ComparisonChart from "@/components/charts/ComparisonChart";
import { formatShortDate } from "@/lib/formatters";

export function LargeMidSmall({ performance = {}, history = [] }) {
  const [period, setPeriod] = useState("3M");

  const PERIODS = [
    { id: "1M", label: "1M" },
    { id: "3M", label: "3M" },
    { id: "YTD", label: "YTD" },
  ];

  const largePerf = performance?.large?.[period] ?? null;
  const midPerf = performance?.mid?.[period] ?? null;
  const smallPerf = performance?.small?.[period] ?? null;

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

  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    const sliceCount = period === "1M" ? 21 : period === "3M" ? 63 : 120;
    const slice = history.slice(-sliceCount);
    
    return slice.map((h) => ({
      date: formatShortDate(h.date),
      large: h.pctAbove20ema !== null ? +(h.pctAbove20ema - 50).toFixed(1) : 0,
      mid: h.pctAbove50sma !== null ? +(h.pctAbove50sma - 50).toFixed(1) : 0,
      small: h.pctAbove200sma !== null ? +(h.pctAbove200sma - 50).toFixed(1) : 0,
    }));
  }, [history, period]);

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
        series={[
          { key: "large", name: "Large", color: "var(--color-primary, #4F46E5)", strokeWidth: 1.75 },
          { key: "mid", name: "Mid", color: "#F97316", strokeWidth: 1.5 },
          { key: "small", name: "Small", color: "var(--color-bullish, #059669)", strokeWidth: 1.25 },
        ]}
        height={145}
      />
    </BaseCard>
  );
}

export default LargeMidSmall;
