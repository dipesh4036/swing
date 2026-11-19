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
          <div className="text-[13px] font-bold text-text tracking-tight">
            Market participation
          </div>
          <div className="text-[11px] text-text-secondary">{dateSubtext}</div>
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
        <span className="text-[24px] font-bold text-text tabular-nums tracking-tight">
          {currentPct !== null && currentPct !== undefined ? `${currentPct.toFixed(1)}%` : "—"}
        </span>
        {status !== "—" && <StatusBadge status="info">{status}</StatusBadge>}
        {weeklyChangePts !== null && weeklyChangePts !== undefined && (
          <span
            className={`text-[11px] font-semibold tabular-nums ${
              weeklyChangePts >= 0 ? "text-bullish" : "text-bearish"
            }`}
          >
            {weeklyChangePts >= 0 ? "+" : "−"}{Math.abs(weeklyChangePts).toFixed(1)} pts in a week
          </span>
        )}

        {/* Legend */}
        <div className="ml-auto hidden sm:flex items-center gap-3 text-[10px] text-text-secondary">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-primary inline-block rounded" />
            Participation
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-text-muted inline-block rounded" />
            50% breadth threshold
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
            color: "var(--color-primary, #4F46E5)",
            fill: true,
            strokeWidth: 2,
          },
          {
            key: "benchmark",
            name: "50% breadth threshold",
            color: "var(--color-border-strong, #CBD5E1)",
            fill: false,
            strokeWidth: 1.5,
            strokeDasharray: "2 2",
          },
        ]}
        height={185}
        yDomain={[0, 100]}
        yUnit="%"
        referenceLines={[
          { y: 20, color: "var(--color-border, #E4E4E7)", strokeDasharray: "2 2" },
          { y: 50, color: "var(--color-border, #E4E4E7)", strokeDasharray: "2 2" },
          { y: 80, color: "var(--color-border, #E4E4E7)", strokeDasharray: "2 2" },
        ]}
      />
    </div>
  );
}

export default MarketParticipationChart;
