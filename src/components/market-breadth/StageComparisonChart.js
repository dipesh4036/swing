"use client";

import React from "react";
import BaseAreaChart from "@/components/charts/BaseAreaChart";

export function StageComparisonChart({ data = [] }) {
  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="space-y-2 pt-3 border-t border-border w-full min-w-0">
      {/* Title & Legend */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[13px] font-bold text-text tracking-tight">
            Stage 2 vs Stage 4
          </div>
          <div className="text-xs text-text-secondary">Share of stocks in each stage</div>
        </div>

        {/* Legend with latest values */}
        <div className="flex items-center gap-3 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-primary">
            <span className="w-2 h-2 rounded-xs bg-primary" />
            Stage 2: {latest?.stage2 !== null && latest?.stage2 !== undefined ? `${latest.stage2.toFixed(1)}%` : "—"}
          </span>
          <span className="flex items-center gap-1.5 text-bearish">
            <span className="w-2 h-2 rounded-xs bg-bearish" />
            Stage 4: {latest?.stage4 !== null && latest?.stage4 !== undefined ? `${latest.stage4.toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>

      {/* Chart */}
      <BaseAreaChart
        data={data}
        xKey="date"
        series={[
          {
            key: "stage2",
            name: "Stage 2 (Uptrend)",
            color: "var(--color-primary, #4F46E5)",
            fill: true,
            strokeWidth: 1.75,
          },
          {
            key: "stage4",
            name: "Stage 4 (Downtrend)",
            color: "var(--color-bearish, #E11D48)",
            fill: true,
            strokeWidth: 1.75,
          },
        ]}
        height={170}
        yDomain={[0, 70]}
        yUnit="%"
        referenceLines={[{ y: 35, color: "var(--color-border, #E4E4E7)", strokeDasharray: "2 2" }]}
      />
    </div>
  );
}

export default StageComparisonChart;
