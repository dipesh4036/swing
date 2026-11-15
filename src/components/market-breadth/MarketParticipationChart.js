"use client";

import React, { useState, useId } from "react";
import SegmentedControl from "@/components/ui/segmented-control";
import BaseAreaChart from "@/components/charts/BaseAreaChart";
import StatusBadge from "@/components/ui/badge";
import { formatDayMonth } from "@/lib/formatters";

export function MarketParticipationChart({ data = [], stats = {}, asOfDate = null }) {
  const [period, setPeriod] = useState("20D");
  const chartId = useId();

  const {
    currentPct = null,
    status = "—",
    weeklyChangePts = null,
  } = stats || {};

  const PERIODS = [
    { id: "20D", label: "20D" },
    { id: "50D", label: "50D" },
    { id: "200D", label: "200D" },
  ];

  const dateSubtext = asOfDate
    ? `Share of stocks above their ${period} average, as of ${formatDayMonth(asOfDate)}`
    : `Share of stocks above their ${period} average`;

  const activeKey =
    period === "20D" ? "above20" : period === "50D" ? "above50" : "above200";

  return (
    <div className="space-y-3 w-full min-w-0">
      {/* Top Header & Controls */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[13px] font-bold text-[#17233B] tracking-tight">
            Market participation
          </div>
          <div className="text-[11px] text-[#64748B]">{dateSubtext}</div>
        </div>

        <SegmentedControl
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          size="xs"
        />
      </div>

      {/* Numerical Stats Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[24px] font-bold text-[#17233B] tabular-nums tracking-tight">
          {currentPct !== null && currentPct !== undefined ? `${currentPct.toFixed(1)}%` : "—"}
        </span>
        {status !== "—" && <StatusBadge status="info">{status}</StatusBadge>}
        {weeklyChangePts !== null && weeklyChangePts !== undefined && (
          <span
            className={`text-[11px] font-semibold tabular-nums ${
              weeklyChangePts >= 0 ? "text-[#16A878]" : "text-[#F05283]"
            }`}
          >
            {weeklyChangePts >= 0 ? "+" : "−"}{Math.abs(weeklyChangePts).toFixed(1)} pts in a week
          </span>
        )}

        {/* Legend */}
        <div className="ml-auto hidden sm:flex items-center gap-3 text-[10px] text-[#64748B]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-[#3478F6] inline-block rounded" />
            Participation
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-[#94A3B8] inline-block rounded" />
            Benchmark 50%
          </span>
        </div>
      </div>

      {/* Chart */}
      <BaseAreaChart
        data={data}
        xKey="date"
        series={[
          {
            key: activeKey,
            name: "Participation",
            color: "#3478F6",
            fill: true,
            strokeWidth: 2,
          },
          {
            key: "benchmark",
            name: "Benchmark",
            color: "#94A3B8",
            fill: false,
            strokeWidth: 1.5,
            strokeDasharray: "2 2",
          },
        ]}
        height={185}
        yDomain={[0, 100]}
        yUnit="%"
        referenceLines={[
          { y: 20, color: "#E2E8F0", strokeDasharray: "2 2" },
          { y: 50, color: "#E2E8F0", strokeDasharray: "2 2" },
          { y: 80, color: "#E2E8F0", strokeDasharray: "2 2" },
        ]}
      />
    </div>
  );
}

export default MarketParticipationChart;
