"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { TopGroupRow } from "@/lib/industry-types";
import { RankBadge, SignedReturn, format20dHL } from "./RankPrimitives";

export default function TopGroupsStrip({
  topGroups,
  topGroupsAsOf,
  loading,
  onSelectGroup,
}: {
  topGroups: TopGroupRow[];
  topGroupsAsOf: string | null;
  loading: boolean;
  onSelectGroup: (groupId: string) => void;
}) {
  if (loading && topGroups.length === 0) {
    return (
      <section aria-label="Top 3 across timeframes" className="space-y-2">
        <div className="h-4 w-48 rounded bg-bg-secondary" />
        <div className="flex lg:grid lg:grid-cols-3 gap-3 overflow-x-auto">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-[88%] sm:w-[62%] lg:w-auto shrink-0 h-44 rounded-xl border border-border bg-bg-secondary"
            />
          ))}
        </div>
      </section>
    );
  }

  if (topGroups.length === 0) {
    return (
      <section
        aria-label="Top 3 across timeframes"
        className="rounded-xl border border-border bg-surface p-3.5 text-xs text-text-secondary"
      >
        <div className="font-semibold text-text mb-0.5">Top 3 across 1D / 1W / 1M / 3M</div>
        <p>Top 3 will appear after the next daily run.</p>
      </section>
    );
  }

  return (
    <section aria-label="Top 3 across timeframes" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Best Across All Timeframes
          </h2>
          {topGroupsAsOf && (
            <span className="text-[11px] text-text-secondary tabular-nums">
              {topGroupsAsOf}
            </span>
          )}
        </div>
        {topGroups.length < 3 && (
          <span className="text-xs text-text-secondary">
            Only {topGroups.length} {topGroups.length === 1 ? "group qualifies" : "groups qualify"} across all four timeframes.
          </span>
        )}
      </div>

      <div className="flex lg:grid lg:grid-cols-3 gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1 lg:mx-0 lg:px-0">
        {topGroups.map((g) => (
          <button
            key={g.groupId}
            type="button"
            onClick={() => onSelectGroup(g.groupId)}
            className="w-[88%] sm:w-[62%] lg:w-auto shrink-0 snap-start text-left rounded-xl border border-border bg-surface hover:border-primary/50 hover:bg-bg-secondary/40 p-3.5 transition-colors duration-150 cursor-pointer flex flex-col justify-between gap-2.5"
          >
            <div className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <RankBadge rank={g.pos} medal />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{g.label}</div>
                    {g.sectorLabel && g.sectorLabel !== g.label && (
                      <div className="text-xs text-text-secondary truncate">{g.sectorLabel}</div>
                    )}
                  </div>
                </div>
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-bg-secondary border border-border tabular-nums text-xs font-semibold text-text-secondary tabular-nums">
                  Worst #{g.worstRank}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[
                  { tf: "1D", r: g.r1d, med: g.med1d },
                  { tf: "1W", r: g.r1w, med: g.med1w },
                  { tf: "1M", r: g.r1m, med: g.med1m },
                  { tf: "3M", r: g.r3m, med: g.med3m },
                ].map((item) => (
                  <div
                    key={item.tf}
                    className="rounded-md bg-bg-secondary/70 px-1.5 py-1 border border-border/60"
                  >
                    <div className="flex items-center justify-between text-xs text-text-secondary tabular-nums">
                      <span>{item.tf}</span>
                      <span className="text-[13px] font-semibold text-text">#{item.r}</span>
                    </div>
                    <div className="mt-0.5">
                      <SignedReturn value={item.med} size="xs" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-text-secondary tabular-nums">
                <span>20D {format20dHL(g.n20dHigh, g.n20dLow)}</span>
                <span>
                  &gt;50 SMA {g.pctAbove50dma !== null ? `${g.pctAbove50dma.toFixed(0)}%` : "—"}
                </span>
              </div>

              <p className="text-[13px] leading-snug text-text-secondary line-clamp-2">
                {g.noteText}
              </p>

              {g.noteSource === "gemini" && (
                <div className="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <Sparkles className="w-3 h-3" />
                  <span>AI-written from the numbers</span>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
