"use client";

import React from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { BreadcrumbItem, ClassificationLevel } from "@/lib/industry-types";
import { SegmentedControl } from "@/components/ui/segmented-control";

const LEVEL_OPTIONS: { id: ClassificationLevel; label: string }[] = [
  { id: "macro", label: "Macro" },
  { id: "sector", label: "Sector" },
  { id: "industry", label: "Industry" },
  { id: "basic_industry", label: "Basic Industry" },
];

export type QuickPreset = "all" | "outperforming" | "improving" | "leaders";

const PRESET_OPTIONS: { id: QuickPreset; label: string }[] = [
  { id: "all", label: "All Groups" },
  { id: "outperforming", label: "RS ≥ 21E" },
  { id: "improving", label: "Improving" },
  { id: "leaders", label: "Top RS (≥75%)" },
];

interface ClassificationTabsProps {
  level: ClassificationLevel;
  onLevelChange: (level: ClassificationLevel) => void;
  preset: QuickPreset;
  onPresetChange: (preset: QuickPreset) => void;
  breadcrumbs: BreadcrumbItem[];
  onBreadcrumbSelect: (crumb: BreadcrumbItem | null) => void;
  search: string;
  onSearchChange: (val: string) => void;
}

export default function ClassificationTabs({
  level,
  onLevelChange,
  preset,
  onPresetChange,
  breadcrumbs,
  onBreadcrumbSelect,
  search,
  onSearchChange,
}: ClassificationTabsProps) {
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
            options={PRESET_OPTIONS as never[]}
            value={preset}
            onChange={(val: QuickPreset) => onPresetChange(val)}
            size="sm"
          />
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search groups or path..."
            aria-label="Filter classification groups"
            className="w-full h-8 pl-8 pr-8 text-xs rounded-md bg-surface border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
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

      {breadcrumbs.length > 0 && (
        <nav aria-label="Hierarchy breadcrumbs" className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => onBreadcrumbSelect(null)}
            className="px-2 py-0.5 rounded-[4px] bg-bg-secondary border border-border text-text-secondary hover:text-text cursor-pointer transition-colors"
          >
            All NSE
          </button>
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.groupId}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <button
                type="button"
                onClick={() => onBreadcrumbSelect(crumb)}
                className="px-2 py-0.5 rounded-[4px] bg-primary-subtle border border-accent-border text-primary font-semibold hover:bg-bg-selected cursor-pointer transition-colors"
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
