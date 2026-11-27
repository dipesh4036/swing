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

  const isPositive = liveNet !== null && liveNet !== undefined ? liveNet >= 0 : true;

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-text truncate">New highs − lows</div>
          <div className="text-xs text-text-secondary truncate">
            {is52W
              ? "Long-term market strength (52-week new highs minus lows)"
              : "Short-term momentum (20-day new highs minus lows)"}
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
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-[17px] sm:text-[18px] font-bold tabular-nums ${
                isPositive ? "text-primary" : "text-bearish"
              }`}
            >
              {liveNet !== null && liveNet !== undefined ? `${liveNet > 0 ? "+" : ""}${liveNet}` : "—"}
            </span>
            <span className="text-xs uppercase font-semibold text-text-secondary tracking-wider">
              {period} Net Stocks
            </span>
          </div>
          <span className="text-xs font-medium text-text-secondary">
            {statusText}
          </span>
        </div>
        <div className="text-xs text-text-secondary shrink-0 bg-bg-secondary border border-border rounded-md px-2 py-0.5">
          <span className="font-semibold text-bullish">{liveHighs !== null && liveHighs !== undefined ? liveHighs : "—"} highs</span>
          <span className="text-text-secondary"> / </span>
          <span className="font-semibold text-bearish">{liveLows !== null && liveLows !== undefined ? liveLows : "—"} lows</span>
        </div>
      </div>

      {weeklyChangeText && (
        <div
          className={`text-xs font-semibold ${
            isPositive ? "text-bullish" : "text-bearish"
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
            color: isPositive ? "var(--color-primary, #4F46E5)" : "var(--color-bearish, #E11D48)",
            fill: true,
            strokeWidth: 1.75,
          },
        ]}
        height={145}
        yDomain={["auto", "auto"]}
        yUnit=""
        referenceLines={[{ y: 0, color: "var(--color-border-strong, #CBD5E1)", strokeDasharray: "2 2" }]}
        tooltipFormatter={(val) =>
          typeof val === "number" ? `${val > 0 ? "+" : ""}${val} stocks` : val
        }
      />
    </BaseCard>
  );
}

export default NewHighsLows;
