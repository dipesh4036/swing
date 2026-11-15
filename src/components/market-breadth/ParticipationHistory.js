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
        { key: "above20", name: ">20 EMA", color: "#3478F6", strokeWidth: 2.2 },
        { key: "above50", name: ">50 SMA", color: "#E2E8F0", strokeWidth: 1 },
        { key: "above200", name: ">200 SMA", color: "#CBD5E1", strokeWidth: 1 },
      ];
    }
    if (period === "50D") {
      return [
        { key: "above20", name: ">20 EMA", color: "#CBD5E1", strokeWidth: 1 },
        { key: "above50", name: ">50 SMA", color: "#F97316", strokeWidth: 2.2 },
        { key: "above200", name: ">200 SMA", color: "#E2E8F0", strokeWidth: 1 },
      ];
    }
    if (period === "200D") {
      return [
        { key: "above20", name: ">20 EMA", color: "#E2E8F0", strokeWidth: 1 },
        { key: "above50", name: ">50 SMA", color: "#CBD5E1", strokeWidth: 1 },
        { key: "above200", name: ">200 SMA", color: "#16A878", strokeWidth: 2.2 },
      ];
    }
    // "All"
    return [
      { key: "above20", name: ">20 EMA", color: "#3478F6", strokeWidth: 1.75 },
      { key: "above50", name: ">50 SMA", color: "#F97316", strokeWidth: 1.5 },
      { key: "above200", name: ">200 SMA", color: "#16A878", strokeWidth: 1.25 },
    ];
  }, [period]);

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#17233B] truncate">Participation history</div>
          <div className="text-[10px] text-[#64748B] truncate">
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
        <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3478F6] shrink-0" />
          <span className="text-[#64748B]">&gt;20 EMA:</span>
          <span className="text-[#17233B]">{pct20 !== null && pct20 !== undefined ? `${pct20.toFixed(1)}%` : "—"}</span>
        </span>
        <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F97316] shrink-0" />
          <span className="text-[#64748B]">&gt;50 SMA:</span>
          <span className="text-[#17233B]">{pct50 !== null && pct50 !== undefined ? `${pct50.toFixed(1)}%` : "—"}</span>
        </span>
        <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] bg-[#F8FAFC] flex items-center gap-1 tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-[#16A878] shrink-0" />
          <span className="text-[#64748B]">&gt;200 SMA:</span>
          <span className="text-[#17233B]">{pct200 !== null && pct200 !== undefined ? `${pct200.toFixed(1)}%` : "—"}</span>
        </span>
      </div>

      {/* Chart */}
      <ComparisonChart
        data={chartData}
        xKey="date"
        series={lines}
        height={95}
      />
    </BaseCard>
  );
}

export default ParticipationHistory;
