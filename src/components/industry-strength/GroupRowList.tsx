"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { ExtendedPeriod, IndustryGroupRow } from "@/lib/industry-types";
import { RankCycleMode } from "@/lib/industry-formatters";
import {
  RankBadge,
  RankChangeChip,
  SignedReturn,
  format20dHL,
  getMedianForPeriod,
} from "./RankPrimitives";

const PAGE_SIZE = 15;

const RANK_MODE_LABEL: Record<RankCycleMode, string> = {
  normal: "Rank: Normal",
  climbers: "Rank: Climbers",
  fallers: "Rank: Fallers",
};

export default function GroupRowList({
  groups,
  period,
  rankMode,
  onCycleRankMode,
  selectedGroupId,
  onSelectGroup,
  chartGroupIds,
  onToggleCompare,
  search,
}: {
  groups: IndustryGroupRow[];
  period: ExtendedPeriod;
  rankMode: RankCycleMode;
  onCycleRankMode: () => void;
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
  chartGroupIds: Set<string>;
  onToggleCompare: (group: IndustryGroupRow) => void;
  search: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const visibleGroups = groups.slice(0, visibleCount);
  const remaining = Math.max(0, groups.length - visibleGroups.length);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center text-xs text-text-secondary">
        {search.trim()
          ? `No groups match "${search.trim()}".`
          : "No industry groups available for this filter."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-text-secondary px-0.5">
        <button
          type="button"
          onClick={onCycleRankMode}
          className="px-2 py-1 rounded-md border border-border bg-surface text-text font-medium cursor-pointer"
        >
          {RANK_MODE_LABEL[rankMode]}
        </button>
        <span className="tabular-nums text-text-secondary">
          Showing {visibleGroups.length} of {groups.length} · MED ({period.toUpperCase()})
        </span>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-surface overflow-hidden">
        {visibleGroups.map((g) => {
          const isExpanded = expandedId === g.groupId;
          const isCompared = chartGroupIds.has(g.groupId);
          const isSelected = selectedGroupId === g.groupId;
          const med = getMedianForPeriod(g, period);

          return (
            <div
              key={g.groupId}
              className={isSelected ? "bg-primary-subtle/30" : ""}
            >
              <button
                type="button"
                onClick={() => setExpandedId((cur) => (cur === g.groupId ? null : g.groupId))}
                aria-expanded={isExpanded}
                className="w-full text-left px-3 py-2.5 min-h-[64px] flex flex-col justify-center gap-1 hover:bg-bg-secondary/40 cursor-pointer"
              >
                {/* Line 1: Rank + change · Group name · MED · chevron */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <RankBadge rank={g.rankTrend} />
                    <RankChangeChip change={g.rankTrendChange} mode={rankMode} />
                    <span className="text-[13px] font-semibold text-text truncate">
                      {g.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SignedReturn value={med} size="lg" />
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </div>

                {/* Line 2: 20D H/L · >50 SMA · stocks */}
                <div className="text-xs text-text-secondary tabular-nums truncate">
                  20D {format20dHL(g.n20dHigh, g.n20dLow)} · &gt;50 SMA{" "}
                  {g.pctAbove50dma !== null ? `${g.pctAbove50dma.toFixed(0)}%` : "—"} ·{" "}
                  {g.stockCount} stocks
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-2 border-t border-border/60 bg-bg-secondary/35 space-y-2.5 text-xs">
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "1D", val: g.median1d },
                      { label: "1W", val: g.median1w },
                      { label: "1M", val: g.median1m },
                      { label: "3M", val: g.median3m },
                      { label: "6M", val: g.median6m },
                      { label: "1Y", val: g.median1y },
                      { label: "YTD", val: g.medianYtd },
                    ].map((m) => (
                      <div key={m.label} className="rounded bg-surface px-2 py-1 border border-border/60">
                        <div className="text-xs text-text-secondary tabular-nums">{m.label}</div>
                        <SignedReturn value={m.val} size="xs" />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 tabular-nums text-text-secondary">
                    <div>
                      <span className="text-text-secondary">&gt;20E: </span>
                      <span>{g.pctAbove20ema !== null ? `${g.pctAbove20ema.toFixed(0)}%` : "—"}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">&gt;200D: </span>
                      <span>{g.pctAbove200dma !== null ? `${g.pctAbove200dma.toFixed(0)}%` : "—"}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">RS-STS: </span>
                      <span>{g.rsSts !== null ? `${g.rsSts.toFixed(0)}%` : "—"}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Adv/Dec: </span>
                      <span>{g.adv}/{g.dec}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onToggleCompare(g)}
                      className={`h-8 px-3 rounded-md border text-xs font-medium cursor-pointer ${
                        isCompared
                          ? "bg-primary-subtle border-accent-border text-primary"
                          : "bg-surface border-border text-text"
                      }`}
                    >
                      {isCompared ? "In Compare" : "+ Compare"}
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectGroup(g.groupId)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-white text-xs font-medium cursor-pointer"
                    >
                      <span>Open stocks</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full h-9 rounded-lg border border-border bg-surface hover:bg-bg-secondary text-xs font-medium text-text cursor-pointer"
        >
          Show {Math.min(PAGE_SIZE, remaining)} more · {remaining} left
        </button>
      )}
    </div>
  );
}
