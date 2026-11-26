"use client";

import React from "react";
import { ChevronRight, Columns3, Search, X } from "lucide-react";
import { BreadcrumbItem, ClassificationLevel, ExtendedPeriod } from "@/lib/industry-types";
import { SegmentedControl } from "@/components/ui/segmented-control";

const LEVEL_OPTIONS: { id: ClassificationLevel; label: string }[] = [
  { id: "macro", label: "Macro" },
  { id: "sector", label: "Sector" },
  { id: "industry", label: "Industry" },
  { id: "basic_industry", label: "Basic Industry" },
];

const ALL_TIMEFRAME_OPTIONS: { id: ExtendedPeriod; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "ytd", label: "YTD" },
];

interface ClassificationTabsProps {
  level: ClassificationLevel;
  onLevelChange: (level: ClassificationLevel) => void;
  period: ExtendedPeriod;
  onPeriodChange: (period: ExtendedPeriod) => void;
  has1yYtd?: boolean;
  showSmall: boolean;
  onShowSmallChange: (val: boolean) => void;
  moreColumns: boolean;
  onMoreColumnsChange: (val: boolean) => void;
  breadcrumbs: BreadcrumbItem[];
  onBreadcrumbSelect: (crumb: BreadcrumbItem | null) => void;
  search: string;
  onSearchChange: (val: string) => void;
}

export default function ClassificationTabs({
  level,
  onLevelChange,
  period,
  onPeriodChange,
  has1yYtd = true,
  showSmall,
  onShowSmallChange,
  moreColumns,
  onMoreColumnsChange,
  breadcrumbs,
  onBreadcrumbSelect,
  search,
  onSearchChange,
}: ClassificationTabsProps) {
  const timeframeOptions = has1yYtd
    ? ALL_TIMEFRAME_OPTIONS
    : ALL_TIMEFRAME_OPTIONS.filter((t) => t.id !== "1y" && t.id !== "ytd");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={LEVEL_OPTIONS as never[]}
            value={level}
            onChange={(val: ClassificationLevel) => onLevelChange(val)}
            size="md"
          />
          <SegmentedControl
            options={timeframeOptions as never[]}
            value={period}
            onChange={(val: ExtendedPeriod) => onPeriodChange(val)}
            size="sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-secondary cursor-pointer select-none px-2 py-1 rounded-[6px] border border-border bg-surface hover:bg-bg-hover">
            <input
              type="checkbox"
              checked={showSmall}
              onChange={(e) => onShowSmallChange(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span>Show small groups (&lt;5)</span>
          </label>

          <button
            type="button"
            onClick={() => onMoreColumnsChange(!moreColumns)}
            aria-pressed={moreColumns}
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[6px] border text-[11px] font-medium cursor-pointer ${
              moreColumns
                ? "bg-primary-subtle border-accent-border text-primary"
                : "bg-surface border-border text-text-secondary hover:text-text hover:bg-bg-hover"
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span>More columns</span>
          </button>

          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search groups..."
              aria-label="Filter classification groups"
              className="w-full h-8 pl-8 pr-8 text-xs rounded-md bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear group search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {breadcrumbs.length > 0 && (
        <nav aria-label="Hierarchy breadcrumbs" className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => onBreadcrumbSelect(null)}
            className="px-2 py-0.5 rounded-[4px] bg-bg-secondary border border-border text-text-secondary hover:text-text cursor-pointer"
          >
            All NSE
          </button>
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.groupId}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <button
                type="button"
                onClick={() => onBreadcrumbSelect(crumb)}
                className="px-2 py-0.5 rounded-[4px] bg-primary-subtle border border-accent-border text-primary font-semibold hover:bg-bg-selected cursor-pointer"
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
          <button
            type="button"
            onClick={() => onBreadcrumbSelect(null)}
            className="ml-1 text-text-muted hover:text-text underline cursor-pointer"
          >
            Reset drill-down
          </button>
        </nav>
      )}
    </div>
  );
}
