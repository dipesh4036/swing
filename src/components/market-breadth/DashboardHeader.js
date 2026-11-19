"use client";

import React from "react";
import { Activity, ChevronDown } from "lucide-react";
import { STOCK_UNIVERSES, PERIOD_OPTIONS } from "@/lib/constants";
import SegmentedControl from "@/components/ui/segmented-control";
import { formatTradeDate } from "@/lib/formatters";

export function DashboardHeader({
  activeTab = "breadth",
  onTabChange,
  selectedUniverse = "all",
  onUniverseChange,
  selectedPeriod = "1M",
  onPeriodChange,
  asOfDate = null,
  coverage = null,
}) {
  const currentUniverse =
    STOCK_UNIVERSES.find((u) => u.id === selectedUniverse) || STOCK_UNIVERSES[0];

  return (
    <div className="bg-surface border border-border rounded-lg px-3.5 sm:px-4 py-3 mb-4 w-full min-w-0 transition-colors duration-150">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full min-w-0">
        {/* Left: Product title, date & navigation tabs */}
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-text-inverse shrink-0">
              <Activity size={16} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] sm:text-[15px] font-bold text-text tracking-tight leading-none truncate">
                Market Breadth
              </h1>
              <span className="text-[10px] sm:text-[11px] text-text-muted font-medium leading-none block mt-1 truncate">
                {asOfDate ? `Read as of ${formatTradeDate(asOfDate)}` : "—"}
              </span>
            </div>
          </div>

          {/* Navigation Tab & Coverage Pill */}
          <div className="hidden xs:flex items-center gap-2 border-l border-border pl-3 sm:pl-4">
            <span className="text-xs font-semibold px-2.5 sm:px-3 py-1 rounded-md bg-primary-subtle text-primary border border-accent-border">
              Market Breadth
            </span>
            {coverage && (
              <span
                className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-secondary bg-bg-secondary border border-border rounded-md px-2 py-0.5 cursor-help"
                title={coverage.excludedReason || `${coverage.valid} of ${coverage.total} covered (${coverage.pct}%)`}
              >
                <span className="text-text-muted">Coverage:</span>
                <span className="font-semibold text-text">{coverage.valid}/{coverage.total}</span>
                <span className="text-primary font-semibold">({coverage.pct}%)</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Stock universe dropdown & period selector */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap justify-between sm:justify-end w-full sm:w-auto min-w-0">
          {/* Stock universe dropdown */}
          <div className="relative inline-block z-10 shrink-0">
            <select
              value={selectedUniverse}
              onChange={(e) => {
                if (onUniverseChange) {
                  onUniverseChange(e.target.value);
                }
              }}
              className="appearance-none bg-bg-secondary border border-border rounded-md text-[11px] sm:text-xs font-medium text-text pl-2.5 pr-7 sm:pr-8 py-1 h-7 sm:h-7.5 hover:border-border-strong focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary cursor-pointer max-w-[150px] sm:max-w-none transition-colors"
            >
              {STOCK_UNIVERSES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.count.toLocaleString("en-IN")})
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
            />
          </div>

          {/* Period selector */}
          <div className="min-w-0 overflow-x-auto max-w-full">
            <SegmentedControl
              options={PERIOD_OPTIONS}
              value={selectedPeriod}
              onChange={(val) => {
                if (onPeriodChange) {
                  onPeriodChange(val);
                }
              }}
              size="xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardHeader;
