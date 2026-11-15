"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import BaseAreaChart from "@/components/charts/BaseAreaChart";
import { formatShortDate } from "@/lib/formatters";

export function BreakoutsBreakdowns({ keyMetrics, history = [] }) {
  const [period, setPeriod] = useState("Daily");

  const PERIODS = [
    { id: "Daily", label: "Daily" },
    { id: "5D", label: "5D net" },
    { id: "Cumulative", label: "Cumulative" },
  ];

  const brk = keyMetrics?.breakouts;
  const liveHeld = brk?.breakouts20d;
  const liveFailed = brk?.breakdowns20d;
  const liveNet =
    liveHeld !== null && liveFailed !== null && liveHeld !== undefined && liveFailed !== undefined
      ? liveHeld - liveFailed
      : null;

  // Chart data adapted to period
  const chartData = useMemo(() => {
    let cumulative = 0;
    return history.map((d, idx) => {
      const net = (d.breakouts20d ?? 0) - (d.breakdowns20d ?? 0);
      cumulative += net;

      let val = net;
      if (period === "5D") {
        const slice5 = history.slice(Math.max(0, idx - 4), idx + 1);
        val = slice5.reduce((sum, item) => sum + ((item.breakouts20d ?? 0) - (item.breakdowns20d ?? 0)), 0);
      } else if (period === "Cumulative") {
        val = cumulative;
      }

      return {
        date: formatShortDate(d.date),
        val,
      };
    });
  }, [history, period]);

  const displayValue = useMemo(() => {
    if (liveNet === null) return "—";
    if (period === "Daily") return `${liveNet >= 0 ? "+" : ""}${liveNet}`;
    if (period === "5D") {
      const last5 = history.slice(-5);
      const net5 = last5.reduce((sum, item) => sum + ((item.breakouts20d ?? 0) - (item.breakdowns20d ?? 0)), 0);
      return `${net5 >= 0 ? "+" : ""}${net5}`;
    }
    const cum = history.reduce((sum, item) => sum + ((item.breakouts20d ?? 0) - (item.breakdowns20d ?? 0)), 0);
    return `${cum >= 0 ? "+" : ""}${cum}`;
  }, [period, liveNet, history]);

  const displayStatus = useMemo(() => {
    if (liveNet === null) return "—";
    if (period === "Daily") {
      return liveNet >= 0 ? "More breakouts" : "More breakdowns";
    }
    if (period === "5D") {
      return liveNet >= 0 ? "Expansion pace" : "Contraction pace";
    }
    return liveNet >= 0 ? "Positive drift" : "Negative drift";
  }, [period, liveNet]);

  const displaySubtext = useMemo(() => {
    if (period === "Daily") {
      if (liveHeld === null || liveFailed === null || liveHeld === undefined || liveFailed === undefined) return "—";
      return `${liveHeld} breakouts / ${liveFailed} breakdowns`;
    }
    if (period === "5D") return "5-day rolling net breakouts held";
    return "Cumulative net breakout line";
  }, [period, liveHeld, liveFailed]);

  const isPositive = (liveNet ?? 0) >= 0;

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#17233B] truncate">Breakouts − breakdowns</div>
          <div className="text-[10px] text-[#64748B] truncate">
            {period === "Daily"
              ? "20D channel breakouts vs breakdowns on volume"
              : `${period} trend of breakouts vs breakdowns`}
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

      {/* Numerical row */}
      <div className="flex items-baseline justify-between gap-2 flex-wrap min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={`text-[17px] sm:text-[18px] font-bold tabular-nums ${
              isPositive ? "text-[#3478F6]" : "text-[#F05283]"
            }`}
          >
            {displayValue}
          </span>
          <span className="text-[11px] font-medium text-[#64748B]">
            {displayStatus}
          </span>
        </div>
        <div className="text-[10px] text-[#64748B] shrink-0">{displaySubtext}</div>
      </div>

      {/* Chart */}
      <BaseAreaChart
        data={chartData}
        xKey="date"
        series={[
          {
            key: "val",
            name: period === "Daily" ? "Daily Net" : `${period} Net`,
            color: isPositive ? "#3478F6" : "#F05283",
            fill: true,
            strokeWidth: 1.75,
          },
        ]}
        height={95}
      />
    </BaseCard>
  );
}

export default BreakoutsBreakdowns;
