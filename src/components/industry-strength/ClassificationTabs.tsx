"use client";

import React from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { BreadcrumbItem, ClassificationLevel } from "@/lib/industry-types";

const LEVEL_TABS: { key: ClassificationLevel; label: string }[] = [
  { key: "macro", label: "Macro" },
  { key: "sector", label: "Sector" },
  { key: "industry", label: "Industry" },
  { key: "basic_industry", label: "Basic Industry" },
];

interface ClassificationTabsProps {
  level: ClassificationLevel;
  onLevelChange: (level: ClassificationLevel) => void;
  breadcrumbs: BreadcrumbItem[];
  onBreadcrumbSelect: (crumb: BreadcrumbItem | null) => void;
  search: string;
  onSearchChange: (val: string) => void;
}

export default function ClassificationTabs({
  level,
  onLevelChange,
  breadcrumbs,
  onBreadcrumbSelect,
  search,
  onSearchChange,
}: ClassificationTabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onLevelChange(LEVEL_TABS[(idx + 1) % LEVEL_TABS.length].key);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onLevelChange(LEVEL_TABS[(idx - 1 + LEVEL_TABS.length) % LEVEL_TABS.length].key);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="NSE classification hierarchy levels"
          className="inline-flex items-center p-1 rounded-lg bg-surface-elevated border border-border overflow-x-auto max-w-full"
        >
          {LEVEL_TABS.map((tab, idx) => {
            const active = level === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                onClick={() => onLevelChange(tab.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter groups..."
            aria-label="Filter classification groups"
            className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg bg-surface-elevated border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear group search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {breadcrumbs.length > 0 && (
        <nav aria-label="Hierarchy breadcrumbs" className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => onBreadcrumbSelect(null)}
            className="px-2 py-0.5 rounded bg-surface-elevated border border-border text-text-secondary hover:text-text-primary"
          >
            All
          </button>
          {breadcrumbs.map((crumb) => (
            <React.Fragment key={crumb.groupId}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
              <button
                type="button"
                onClick={() => onBreadcrumbSelect(crumb)}
                className="px-2 py-0.5 rounded bg-primary/10 border border-primary/20 text-primary font-medium hover:bg-primary/20"
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
          <button
            type="button"
            onClick={() => onBreadcrumbSelect(null)}
            className="ml-1 text-text-muted hover:text-text-primary underline"
          >
            Clear drill-down
          </button>
        </nav>
      )}
    </div>
  );
}
