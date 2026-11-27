"use client";

import React, { useState } from "react";
import { ChevronRight, Filter, Search, X } from "lucide-react";
import {
  BreadcrumbItem,
  ClassificationLevel,
  ExtendedPeriod,
  StrengthUniverse,
} from "@/lib/industry-types";
import BottomSheet from "./BottomSheet";

const LEVEL_ITEMS: { id: ClassificationLevel; label: string }[] = [
  { id: "macro", label: "Macro" },
  { id: "sector", label: "Sector" },
  { id: "industry", label: "Industry" },
  { id: "basic_industry", label: "Basic industry" },
];

const BASE_PERIODS: { id: ExtendedPeriod; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
];

const EXT_PERIODS: { id: ExtendedPeriod; label: string }[] = [
  { id: "1y", label: "1Y" },
  { id: "ytd", label: "YTD" },
];

export default function ControlBar({
  level,
  onLevelChange,
  period,
  onPeriodChange,
  has1yYtd,
  universe,
  onUniverseChange,
  showSmall,
  onShowSmallChange,
  moreColumns,
  onMoreColumnsChange,
  search,
  onSearchChange,
  breadcrumbs,
  onBreadcrumbSelect,
  onToggleGuide,
}: {
  level: ClassificationLevel;
  onLevelChange: (l: ClassificationLevel) => void;
  period: ExtendedPeriod;
  onPeriodChange: (p: ExtendedPeriod) => void;
  has1yYtd: boolean;
  universe: StrengthUniverse;
  onUniverseChange: (u: StrengthUniverse) => void;
  showSmall: boolean;
  onShowSmallChange: (v: boolean) => void;
  moreColumns: boolean;
  onMoreColumnsChange: (v: boolean) => void;
  search: string;
  onSearchChange: (s: string) => void;
  breadcrumbs: BreadcrumbItem[];
  onBreadcrumbSelect: (groupId: string | null) => void;
  onToggleGuide: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const [filterOpen, setFilterOpen] = useState(false);

  const periods = has1yYtd ? [...BASE_PERIODS, ...EXT_PERIODS] : BASE_PERIODS;
  const activeFilterCount =
    (universe === "liquid" ? 1 : 0) + (showSmall ? 1 : 0) + (moreColumns ? 1 : 0);

  return (
    <>
      <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-y border-border py-2 -mx-3 px-3 sm:-mx-4 sm:px-4 space-y-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {/* Level chips */}
          <div className="flex items-center gap-1 shrink-0" role="tablist" aria-label="Classification level">
            {LEVEL_ITEMS.map((item) => {
              const active = level === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onLevelChange(item.id)}
                  className={`h-7 px-2.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors duration-150 cursor-pointer ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-surface text-text-secondary border-border hover:text-text"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <span className="h-4 w-px bg-border shrink-0" aria-hidden="true" />

          {/* Timeframe chips */}
          <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Timeframe">
            {periods.map((p) => {
              const active = period === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPeriodChange(p.id)}
                  className={`h-7 px-2 rounded-md text-xs tabular-nums font-medium whitespace-nowrap border transition-colors duration-150 cursor-pointer ${
                    active
                      ? "bg-primary-subtle text-primary border-accent-border font-semibold"
                      : "bg-surface text-text-secondary border-border hover:text-text"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search groups"
              aria-expanded={searchOpen}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md border cursor-pointer ${
                searchOpen || search
                  ? "bg-primary-subtle border-accent-border text-primary"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              aria-label="Filters"
              className={`inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-medium cursor-pointer ${
                activeFilterCount > 0
                  ? "bg-primary-subtle border-accent-border text-primary"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              {activeFilterCount > 0 && (
                <span className="tabular-nums text-xs">{activeFilterCount}</span>
              )}
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Filter groups by name..."
                aria-label="Filter groups by name"
                className="w-full h-8 pl-8 pr-8 rounded-md border border-border bg-surface text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {breadcrumbs.length > 0 && (
          <nav aria-label="Hierarchy breadcrumbs" className="flex items-center gap-1 text-xs text-text-secondary overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => onBreadcrumbSelect(null)}
              className="hover:text-text font-medium cursor-pointer shrink-0"
            >
              All
            </button>
            {breadcrumbs.map((b) => (
              <React.Fragment key={b.groupId}>
                <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
                <button
                  type="button"
                  onClick={() => onBreadcrumbSelect(b.groupId)}
                  className="hover:text-text font-medium cursor-pointer shrink-0"
                >
                  {b.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}
      </div>

      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filters & Display">
        <div className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <div className="font-semibold text-text">Universe</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "all", label: "All NSE" },
                  { id: "liquid", label: "Liquid Only" },
                ] as { id: StrengthUniverse; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUniverseChange(opt.id)}
                  className={`h-9 rounded-md border font-medium cursor-pointer ${
                    universe === opt.id
                      ? "bg-primary text-white border-primary"
                      : "bg-bg-secondary text-text border-border"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between py-2 border-t border-border cursor-pointer">
            <div>
              <div className="font-medium text-text">Show small groups (&lt; 5 stocks)</div>
              <div className="text-xs text-text-secondary">Include unranked micro-groups</div>
            </div>
            <input
              type="checkbox"
              checked={showSmall}
              onChange={(e) => onShowSmallChange(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>

          <label className="hidden lg:flex items-center justify-between py-2 border-t border-border cursor-pointer">
            <div>
              <div className="font-medium text-text">More columns</div>
              <div className="text-xs text-text-secondary">Show &gt;20E, &gt;200D, Adv/Dec, MCap, and all medians</div>
            </div>
            <input
              type="checkbox"
              checked={moreColumns}
              onChange={(e) => onMoreColumnsChange(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>

          <div className="pt-2 border-t border-border flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setFilterOpen(false);
                onToggleGuide();
              }}
              className="text-primary font-medium hover:underline cursor-pointer"
            >
              How ranks work
            </button>
            <button
              type="button"
              onClick={() => setFilterOpen(false)}
              className="px-3 py-1.5 rounded-md bg-primary text-white font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
