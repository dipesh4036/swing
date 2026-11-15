"use client";

import React, { useState, useMemo } from "react";
import BaseCard from "@/components/ui/card";
import SegmentedControl from "@/components/ui/segmented-control";
import BaseAreaChart from "@/components/charts/BaseAreaChart";
import { formatShortDate } from "@/lib/formatters";

export function AdvanceDecline({ keyMetrics, history = [] }) {
  const [period, setPeriod] = useState("20D");

  const PERIODS = [
    { id: "20D", label: "20D" },
    { id: "40D", label: "40D" },
    { id: "AD", label: "A-D line" },
  ];

  const adData = keyMetrics?.advanceDecline;
  const advances = adData?.advances;
  const declines = adData?.declines;
  const ratio = period === "40D" ? adData?.ratio40d : adData?.ratio20d;

  const chartData = useMemo(() => {
    return history.map((b) => {
      const val =
        period === "AD"
          ? b.adLine
          : period === "40D"
          ? b.adRatio40d
          : b.adRatio20d;
      return {
        date: formatShortDate(b.date),
        val: val !== null && val !== undefined ? val : null,
        benchmark: period === "AD" ? 0 : 1.0,
      };
    });
  }, [history, period]);

  const displayVal =
    period === "AD"
      ? keyMetrics?.adLine !== null && keyMetrics?.adLine !== undefined
        ? `${keyMetrics.adLine > 0 ? "+" : ""}${keyMetrics.adLine.toLocaleString("en-IN")}`
        : "—"
      : ratio !== null && ratio !== undefined
      ? ratio.toFixed(2)
      : "—";

  const isPositive =
    period === "AD"
      ? (keyMetrics?.adLine !== null && keyMetrics?.adLine !== undefined ? keyMetrics.adLine >= 0 : true)
      : (ratio !== null && ratio !== undefined ? ratio >= 1.0 : true);

  const statusText =
    ratio === null || ratio === undefined
      ? "—"
      : ratio >= 1.05
      ? "Bullish"
      : ratio <= 0.95
      ? "Bearish"
      : "Even";

  // Calculate 1-week change from history (5 sessions ago)
  const weeklyChangeText = useMemo(() => {
    if (history.length < 6) return null;
    const curVal = period === "AD" ? history[history.length - 1]?.adLine : history[history.length - 1]?.adRatio20d;
    const pastVal = period === "AD" ? history[history.length - 6]?.adLine : history[history.length - 6]?.adRatio20d;
    if (curVal === null || pastVal === null || curVal === undefined || pastVal === undefined) return null;
    const diff = curVal - pastVal;
    const sign = diff >= 0 ? "+" : "−";
    return `${sign}${Math.abs(diff).toFixed(period === "AD" ? 0 : 2)} in a week`;
  }, [history, period]);

  return (
    <BaseCard padding="p-3.5" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap sm:flex-nowrap min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#17233B] truncate">Advance / Decline</div>
          <div className="text-[10px] text-[#64748B] truncate">
            {period === "AD" ? "Cumulative Advance minus Decline line" : `Stocks that rose vs fell, ${period} rolling ratio`}
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
                isPositive ? "text-[#2563EB]" : "text-[#F05283]"
              }`}
            >
              {displayVal}
            </span>
            <span className="text-[10px] uppercase font-semibold text-[#64748B] tracking-wider">
              {period === "AD" ? "Cumulative Net" : `${period} Ratio`}
            </span>
          </div>
          <span className="text-[11px] font-medium text-[#64748B]">{statusText}</span>
          {weeklyChangeText && (
            <span className={`text-[10px] font-semibold ${isPositive ? "text-[#16A878]" : "text-[#F05283]"}`}>
              {weeklyChangeText}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#64748B] shrink-0 bg-[#F8FAFC] border border-[#E5EAF2] rounded-[4px] px-2 py-0.5">
          <span className="text-[#94A3B8]">Today: </span>
          <span className="font-semibold text-[#16A878]">{advances !== null && advances !== undefined ? `${advances.toLocaleString("en-IN")} up` : "—"}</span>
          <span className="text-[#94A3B8]"> / </span>
          <span className="font-semibold text-[#F05283]">{declines !== null && declines !== undefined ? `${declines.toLocaleString("en-IN")} down` : "—"}</span>
        </div>
      </div>

      {/* Chart */}
      <BaseAreaChart
        data={chartData}
        xKey="date"
        series={[
          {
            key: "val",
            name: period === "AD" ? "A-D Line" : `${period} Ratio`,
            color: isPositive ? "#2563EB" : "#F05283",
            fill: true,
            strokeWidth: 1.75,
          },
          ...(period !== "AD"
            ? [
                {
                  key: "benchmark",
                  name: "Neutral (1.0x)",
                  color: "#94A3B8",
                  fill: false,
                  strokeWidth: 1,
                  strokeDasharray: "2 2",
                },
              ]
            : []),
        ]}
        height={145}
        yDomain={["auto", "auto"]}
        yUnit={period === "AD" ? "" : "x"}
        referenceLines={[
          {
            y: period === "AD" ? 0 : 1.0,
            color: "#94A3B8",
            strokeDasharray: "2 2",
          },
        ]}
        tooltipFormatter={(val) =>
          typeof val === "number"
            ? period === "AD"
              ? `${val > 0 ? "+" : ""}${val.toLocaleString("en-IN")}`
              : `${val.toFixed(2)}x`
            : val
        }
      />
    </BaseCard>
  );
}

export default AdvanceDecline;
