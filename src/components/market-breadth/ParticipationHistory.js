"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import ComparisonChart from "@/components/charts/ComparisonChart";
import { formatShortDate } from "@/lib/formatters";

export function ParticipationHistory({ keyMetrics, history = [] }) {
  const [period, setPeriod] = useState("All");

  const PERIODS = [
    { id: "All", label: "All" },
    { id: "20D", label: "20 EMA" },
    { id: "50D", label: "50 SMA" },
    { id: "200D", label: "200 SMA" },
  ];

  const ma = keyMetrics?.movingAverages;
  const pct20 = ma?.pctAbove20ema;
  const pct50 = ma?.pctAbove50sma;
  const pct200 = ma?.pctAbove200sma;

  const chartData = useMemo(() => {
    return history.map((b) => ({
      date: formatShortDate(b.date),
      above20: b.pctAbove20ema,
      above50: b.pctAbove50sma,
      above200: b.pctAbove200sma,
    }));
  }, [history]);

  const lines = useMemo(() => {
    if (period === "20D") {
      return [
        { key: "above20", name: ">20 EMA", color: "var(--color-primary, #4F46E5)", strokeWidth: 2.2 },
        { key: "above50", name: ">50 SMA", color: "var(--color-border-subtle, #E4E4E7)", strokeWidth: 1 },
        { key: "above200", name: ">200 SMA", color: "var(--color-border-strong, #CBD5E1)", strokeWidth: 1 },
      ];
    }
    if (period === "50D") {
      return [
        { key: "above20", name: ">20 EMA", color: "var(--color-border-strong, #CBD5E1)", strokeWidth: 1 },
        { key: "above50", name: ">50 SMA", color: "#F97316", strokeWidth: 2.2 },
        { key: "above200", name: ">200 SMA", color: "var(--color-border-subtle, #E4E4E7)", strokeWidth: 1 },
      ];
    }
    if (period === "200D") {
      return [
        { key: "above20", name: ">20 EMA", color: "var(--color-border-subtle, #E4E4E7)", strokeWidth: 1 },
        { key: "above50", name: ">50 SMA", color: "var(--color-border-strong, #CBD5E1)", strokeWidth: 1 },
        { key: "above200", name: ">200 SMA", color: "var(--color-bullish, #059669)", strokeWidth: 2.2 },
      ];
    }
    // "All"
    return [
      { key: "above20", name: ">20 EMA", color: "var(--color-primary, #4F46E5)", strokeWidth: 1.75 },
      { key: "above50", name: ">50 SMA", color: "#F97316", strokeWidth: 1.5 },
      { key: "above200", name: ">200 SMA", color: "var(--color-bullish, #059669)", strokeWidth: 1.25 },
    ];
  }, [period]);

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-text truncate">Participation history</div>
          <div className="text-xs text-text-secondary truncate">
            {period === "All"
              ? "% stocks above 20 EMA, 50 SMA, 200 SMA"
              : `Focus on % stocks above ${period === "20D" ? "20 EMA" : period === "50D" ? "50 SMA" : "200 SMA"}`}
          </div>
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

      {/* Pill Row showing current stats */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap min-w-0">
        <span className="text-xs sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-border bg-bg-secondary flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          <span className="text-text-secondary">&gt;20 EMA:</span>
          <span className="text-text">{pct20 !== null && pct20 !== undefined ? `${pct20.toFixed(1)}%` : "—"}</span>
        </span>
        <span className="text-xs sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-border bg-bg-secondary flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F97316] shrink-0" />
          <span className="text-text-secondary">&gt;50 SMA:</span>
          <span className="text-text">{pct50 !== null && pct50 !== undefined ? `${pct50.toFixed(1)}%` : "—"}</span>
        </span>
        <span className="text-xs sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-border bg-bg-secondary flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-bullish shrink-0" />
          <span className="text-text-secondary">&gt;200 SMA:</span>
          <span className="text-text">{pct200 !== null && pct200 !== undefined ? `${pct200.toFixed(1)}%` : "—"}</span>
        </span>
      </div>

      {/* Chart */}
      <ComparisonChart
        data={chartData}
        xKey="date"
        series={lines}
        height={145}
      />
    </BaseCard>
  );
}

export default ParticipationHistory;
