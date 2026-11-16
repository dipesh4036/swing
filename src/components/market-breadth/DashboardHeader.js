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
    <div className="bg-white border border-[#E5EAF2] rounded-[8px] sm:rounded-[10px] px-3.5 sm:px-4 py-3 shadow-[0_1px_2px_0_rgba(15,23,42,0.04)] mb-4 w-full min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full min-w-0">
        {/* Left: Product title, date & navigation tabs */}
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-[6px] bg-[#2563EB] flex items-center justify-center text-white shadow-xs shrink-0">
              <Activity size={16} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] sm:text-[15px] font-bold text-[#17233B] tracking-tight leading-none truncate">
                Market Breadth
              </h1>
              <span className="text-[10px] sm:text-[11px] text-[#94A3B8] font-medium leading-none block mt-1 truncate">
                {asOfDate ? `Read as of ${formatTradeDate(asOfDate)}` : "—"}
              </span>
            </div>
          </div>

          {/* Navigation Tab & Coverage Pill */}
          <div className="hidden xs:flex items-center gap-2 border-l border-[#E5EAF2] pl-3 sm:pl-4">
            <span className="text-xs font-semibold px-2.5 sm:px-3 py-1 rounded-[6px] bg-[#EFF6FF] text-[#2563EB]">
              Market Breadth
            </span>
            {coverage && (
              <span
                className="hidden md:inline-flex items-center gap-1 text-[11px] text-[#64748B] bg-[#F8FAFC] border border-[#E5EAF2] rounded-[6px] px-2 py-0.5 cursor-help"
                title={coverage.excludedReason || `${coverage.valid} of ${coverage.total} covered (${coverage.pct}%)`}
              >
                <span className="text-[#94A3B8]">Coverage:</span>
                <span className="font-semibold text-[#17233B]">{coverage.valid}/{coverage.total}</span>
                <span className="text-[#2563EB] font-semibold">({coverage.pct}%)</span>
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
              className="appearance-none bg-[#F8FAFC] border border-[#E5EAF2] rounded-[6px] text-[11px] sm:text-xs font-medium text-[#17233B] pl-2.5 pr-7 sm:pr-8 py-1 h-7 sm:h-7.5 hover:border-[#CBD5E1] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] cursor-pointer shadow-2xs max-w-[150px] sm:max-w-none"
            >
              {STOCK_UNIVERSES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.count.toLocaleString("en-IN")})
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] pointer-events-none"
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
