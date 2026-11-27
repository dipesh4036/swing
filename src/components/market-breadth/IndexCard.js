"use client";

import React from "react";
import BaseCard from "@/components/ui/card";
import SparklineChart from "@/components/charts/SparklineChart";
import PercentageChange from "@/components/data-display/PercentageChange";
import { formatINR } from "@/lib/formatters";

export function IndexCard({ item }) {
  const {
    name,
    value,
    changePct,
    distFromHighPct,
    supportResistance,
    subtext,
    sparkline = [],
    isDollar = false,
  } = item;

  const isPos = changePct >= 0;
  const sparkColor = isPos ? "var(--color-bullish, #059669)" : "var(--color-bearish, #E11D48)";

  return (
    <BaseCard padding="p-3" className="flex flex-col justify-between space-y-2 w-full min-w-0">
      {/* Top: Name & % Change */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-text truncate">{name}</span>
        <PercentageChange value={changePct} showBg={false} />
      </div>

      {/* Main numerical value */}
      <div className="text-[17px] font-bold text-text tabular-nums tracking-tight">
        {value === null || value === undefined
          ? "—"
          : isDollar
          ? `$${Number(value).toFixed(2)}`
          : formatINR(value, value < 100 ? 2 : 0)}
      </div>

      {/* Mini Sparkline Chart */}
      <div className="h-9 w-full py-0.5 min-w-0">
        <SparklineChart
          data={sparkline}
          dataKey="val"
          color={sparkColor}
          height={34}
        />
      </div>

      {/* Bottom Subtext */}
      <div className="flex items-center justify-between text-xs text-text-secondary pt-1 border-t border-border gap-1">
        {distFromHighPct !== null && distFromHighPct !== undefined ? (
          <>
            <span
              className={
                distFromHighPct >= -3
                  ? "text-bullish font-semibold shrink-0"
                  : distFromHighPct <= -15
                  ? "text-bearish font-medium shrink-0"
                  : "text-text-secondary font-medium shrink-0"
              }
            >
              {distFromHighPct === 0
                ? "At 52W High"
                : `${distFromHighPct.toFixed(1)}% from 52W high`}
            </span>
            <span className="text-text-secondary truncate text-right">{subtext}</span>
          </>
        ) : (
          <span className="text-text-secondary truncate">{subtext}</span>
        )}
      </div>
    </BaseCard>
  );
}

export default IndexCard;
