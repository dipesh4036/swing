"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import BaseAreaChart from "@/components/charts/BaseAreaChart";
import { formatShortDate } from "@/lib/formatters";

export function FourPercentMovers({ keyMetrics, history = [] }) {
  const [period, setPeriod] = useState("Daily");

  const PERIODS = [
    { id: "Daily", label: "Daily" },
    { id: "5D", label: "5D ratio" },
    { id: "10D", label: "10D ratio" },
  ];

  const movers = keyMetrics?.movers4pct;
  const pctUp = movers?.pctUp;
  const pctDown = movers?.pctDown;
  const ratio5d = movers?.ratio5d;
  const ratio10d = movers?.ratio10d;

  const netPct =
    pctUp !== null && pctDown !== null && pctUp !== undefined && pctDown !== undefined
      ? +(pctUp - pctDown).toFixed(2)
      : null;

  const chartData = useMemo(() => {
    return history.map((b) => {
      let val = null;
      if (period === "Daily") {
        val =
          b.pctMoversUp !== null && b.pctMoversDown !== null
            ? +(b.pctMoversUp - b.pctMoversDown).toFixed(2)
            : null;
      } else if (period === "5D") {
        val = b.moversRatio5d !== null ? b.moversRatio5d : null;
      } else {
        val = b.moversRatio10d !== null ? b.moversRatio10d : null;
      }

      return {
        date: formatShortDate(b.date),
        val,
      };
    });
  }, [history, period]);

  const displayValue = useMemo(() => {
    if (period === "Daily") {
      if (netPct === null) return "—";
      return `${netPct >= 0 ? "+" : ""}${netPct}%`;
    }
    if (period === "5D") {
      if (ratio5d === null || ratio5d === undefined) return "—";
      return `${ratio5d.toFixed(2)}x`;
    }
    if (ratio10d === null || ratio10d === undefined) return "—";
    return `${ratio10d.toFixed(2)}x`;
  }, [period, netPct, ratio5d, ratio10d]);

  const displayStatus = useMemo(() => {
    if (period === "Daily") {
      if (netPct === null) return "—";
      return netPct >= 0 ? "More up 4%+" : "More down 4%-";
    }
    if (period === "5D") {
      if (ratio5d === null || ratio5d === undefined) return "—";
      return ratio5d >= 1.0 ? "Bullish momentum" : "Bearish momentum";
    }
    if (ratio10d === null || ratio10d === undefined) return "—";
    return ratio10d >= 1.0 ? "Sustained expansion" : "Sustained contraction";
  }, [period, netPct, ratio5d, ratio10d]);

  const displaySubtext = useMemo(() => {
    if (period === "Daily") {
      if (pctUp === null || pctDown === null || pctUp === undefined || pctDown === undefined) return "—";
      return `${pctUp.toFixed(1)}% up / ${pctDown.toFixed(1)}% down`;
    }
    if (period === "5D") return "5-day rolling gainers/losers ratio";
    return "10-day smoothed momentum ratio";
  }, [period, pctUp, pctDown]);

  const isPositive =
    period === "Daily"
      ? (netPct ?? 0) >= 0
      : period === "5D"
      ? (ratio5d ?? 0) >= 1.0
      : (ratio10d ?? 0) >= 1.0;

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#17233B] truncate">4% movers</div>
          <div className="text-[10px] text-[#64748B] truncate">
            {period === "Daily" ? "% stocks moving ±4% daily" : `${period} rolling ratio of ±4% movers`}
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
            name: period === "Daily" ? "Net %" : `${period} Ratio`,
            color: isPositive ? "#3478F6" : "#F05283",
            fill: true,
            strokeWidth: 1.75,
          },
        ]}
        height={145}
      />
    </BaseCard>
  );
}

export default FourPercentMovers;
