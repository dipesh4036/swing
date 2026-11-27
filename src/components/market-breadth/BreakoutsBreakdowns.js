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

  // Filter history to skip null or missing breakout/breakdown days
  const validHistory = useMemo(() => {
    return (history || []).filter(
      (d) =>
        d &&
        typeof d.breakouts20d === "number" &&
        typeof d.breakdowns20d === "number"
    );
  }, [history]);

  // Chart data adapted to period (skips null days)
  const chartData = useMemo(() => {
    let cumulative = 0;
    return validHistory.map((d, idx) => {
      const net = d.breakouts20d - d.breakdowns20d;
      cumulative += net;

      let val = net;
      if (period === "5D") {
        const slice5 = validHistory.slice(Math.max(0, idx - 4), idx + 1);
        val = slice5.reduce((sum, item) => sum + (item.breakouts20d - item.breakdowns20d), 0);
      } else if (period === "Cumulative") {
        val = cumulative;
      }

      return {
        date: formatShortDate(d.date),
        val,
      };
    });
  }, [validHistory, period]);

  const displayValue = useMemo(() => {
    if (liveNet === null) return "—";
    if (period === "Daily") return `${liveNet >= 0 ? "+" : ""}${liveNet}`;
    if (validHistory.length === 0) return "—";
    if (period === "5D") {
      const last5 = validHistory.slice(-5);
      if (last5.length === 0) return "—";
      const net5 = last5.reduce((sum, item) => sum + (item.breakouts20d - item.breakdowns20d), 0);
      return `${net5 >= 0 ? "+" : ""}${net5}`;
    }
    const cum = validHistory.reduce((sum, item) => sum + (item.breakouts20d - item.breakdowns20d), 0);
    return `${cum >= 0 ? "+" : ""}${cum}`;
  }, [period, liveNet, validHistory]);

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

  const isPositive = liveNet !== null && liveNet !== undefined ? liveNet >= 0 : true;

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-text truncate">Breakouts − breakdowns</div>
          <div className="text-xs text-text-secondary truncate">
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
              isPositive ? "text-primary" : "text-bearish"
            }`}
          >
            {displayValue}
          </span>
          <span className="text-xs font-medium text-text-secondary">
            {displayStatus}
          </span>
        </div>
        <div className="text-xs text-text-secondary shrink-0">{displaySubtext}</div>
      </div>

      {/* Chart */}
      <BaseAreaChart
        data={chartData}
        xKey="date"
        series={[
          {
            key: "val",
            name: period === "Daily" ? "Daily Net" : `${period} Net`,
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

export default BreakoutsBreakdowns;
