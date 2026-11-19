"use client";

import React from "react";
import CHART_THEME from "@/lib/chart-theme";

export function ChartTooltip({
  active,
  payload,
  label,
  valuePrefix = "",
  valueSuffix = "",
  formatter,
}) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2 text-xs text-text min-w-[130px]">
      {label && (
        <div className="font-semibold text-text text-[11px] mb-1.5 pb-1 border-b border-border">
          {label}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const val = entry.value;
          const displayVal = formatter
            ? formatter(val, entry.name)
            : typeof val === "number"
            ? `${valuePrefix}${val.toLocaleString("en-IN")}${valueSuffix}`
            : val;

          return (
            <div
              key={`item-${idx}`}
              className="flex items-center justify-between gap-4 text-xs"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color || entry.stroke }}
                />
                <span className="text-text-secondary text-[11px]">{entry.name}:</span>
              </div>
              <span className="font-semibold text-text tabular-nums text-[11px]">
                {displayVal}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ChartTooltip;

