"use client";

import React from "react";
import { Info } from "lucide-react";

export function StageAnalysis({ data }) {
  const { totalStocks = 0, timeframe = "150-day SMA", stages = [], coverage = null } = data || {};

  return (
    <div className="pt-4 border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between text-[11px] mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-1 font-semibold uppercase tracking-wider text-text-secondary">
          <span>Stage Analysis</span>
          <span title="Stage analysis classifies stocks into Wyckoff 4 market stages: 1-Base, 2-Uptrend, 3-Top, 4-Downtrend">
            <Info size={12} className="text-text-muted cursor-pointer" />
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <span>
            Coverage:{" "}
            <strong className="text-text font-semibold">
              {coverage
                ? coverage.total !== null
                  ? `${coverage.valid}/${coverage.total} (${coverage.pct}%)`
                  : `${coverage.valid ?? totalStocks} stocks`
                : `${totalStocks} stocks`}
            </strong>
          </span>
          {coverage?.excludedReason && (
            <span
              className="text-text-muted hover:text-text-secondary cursor-pointer inline-flex items-center"
              title={coverage.excludedReason}
            >
              <Info size={12} />
            </span>
          )}
        </div>
      </div>

      {/* Stacked Progress Bar */}
      <div className="w-full h-2 rounded-full overflow-hidden flex bg-bg-secondary border border-border mb-3">
        {stages.map((stg) => (
          <div
            key={stg.id}
            style={{ width: `${stg.pct}%`, backgroundColor: stg.color }}
            className="h-full transition-all duration-500"
            title={`${stg.name}: ${stg.pct}%`}
          />
        ))}
      </div>

      {/* Stage Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-1 text-center">
        {stages.map((stg) => {
          const isPos = stg.change1D > 0;
          const isNeg = stg.change1D < 0;
          return (
            <div key={stg.id} className="flex flex-col items-center">
              <div className="flex items-center gap-1 text-[11px] text-text-secondary font-medium">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: stg.color }}
                />
                <span>{stg.name}</span>
              </div>
              <div className="text-[13px] font-bold text-text tabular-nums mt-0.5">
                {stg.pct !== null && stg.pct !== undefined ? `${stg.pct.toFixed(1)}%` : "—"}
              </div>
              <div
                className={`text-[10px] font-semibold tabular-nums mt-0.5 ${
                  stg.id === "uptrend"
                    ? isPos
                      ? "text-bullish"
                      : "text-bearish"
                    : stg.id === "downtrend"
                    ? isPos
                      ? "text-bearish"
                      : "text-bullish"
                    : "text-text-secondary"
                }`}
              >
                {stg.change1D !== null && stg.change1D !== undefined ? `${isPos ? "+" : ""}${stg.change1D} 1D` : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default StageAnalysis;

