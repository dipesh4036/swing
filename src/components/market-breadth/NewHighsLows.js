"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import BaseAreaChart from "@/components/charts/BaseAreaChart";
import { formatShortDate } from "@/lib/formatters";

export function NewHighsLows({ keyMetrics, history = [] }) {
  const [period, setPeriod] = useState("20D");

  const PERIODS = [
    { id: "20D", label: "20D" },
    { id: "52W", label: "52W" },
  ];

  const is52W = period === "52W";
  const hl = keyMetrics?.highsLows;
  const liveHighs = is52W ? hl?.highs52w : hl?.highs20d;
  const liveLows = is52W ? hl?.lows52w : hl?.lows20d;
  const liveNet = is52W ? hl?.net52w : hl?.net20d;

  const chartData = useMemo(() => {
    return history.map((b) => {
      const net = is52W ? b.net52w : b.netHighs20d;
      return {
        date: formatShortDate(b.date),
        net: net !== null && net !== undefined ? net : null,
      };
    });
  }, [history, is52W]);

  const weeklyChangeText = useMemo(() => {
    if (history.length < 6) return null;
    const curNet = is52W ? history[history.length - 1]?.net52w : history[history.length - 1]?.netHighs20d;
    const pastNet = is52W ? history[history.length - 6]?.net52w : history[history.length - 6]?.netHighs20d;
    if (curNet === null || pastNet === null || curNet === undefined || pastNet === undefined) return null;
    const diff = curNet - pastNet;
    const sign = diff >= 0 ? "+" : "−";
    return `${sign}${Math.abs(diff)} in a week`;
  }, [history, is52W]);

  const statusText =
    liveNet === null || liveNet === undefined
      ? "—"
      : liveNet >= 0
      ? "More highs than lows"
      : "More lows than highs";

  const isPositive = (liveNet ?? 0) >= 0;

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-bold text-[#17233B]">New highs − lows</div>
          <div className="text-[10px] text-[#64748B]">
            Stocks at a {period} high minus those at a {period} low
          </div>
        </div>
        <SegmentedControl
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          size="xs"
        />
      </div>

      {/* Numerical row */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[18px] font-bold tabular-nums ${
              isPositive ? "text-[#3478F6]" : "text-[#F05283]"
            }`}
          >
            {liveNet !== null && liveNet !== undefined ? `${liveNet > 0 ? "+" : ""}${liveNet}` : "—"}
          </span>
          <span className="text-[11px] font-medium text-[#64748B]">
            {statusText}
          </span>
        </div>
        <div className="text-[10px] text-[#64748B]">
          {liveHighs !== null && liveHighs !== undefined ? liveHighs : "—"} highs /{" "}
          {liveLows !== null && liveLows !== undefined ? liveLows : "—"} lows
        </div>
      </div>

      {weeklyChangeText && (
        <div
          className={`text-[10px] font-semibold ${
            isPositive ? "text-[#16A878]" : "text-[#F05283]"
          }`}
        >
          {weeklyChangeText}
        </div>
      )}

      {/* Chart */}
      <BaseAreaChart
        data={chartData}
        xKey="date"
        series={[
          {
            key: "net",
            name: `Net ${period} Highs`,
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

export default NewHighsLows;
