"use client";

import React from "react";
import { TrendingUp, TrendingDown, Activity, Award } from "lucide-react";
import { RankingsSummary } from "@/lib/industry-types";
import { BaseCard } from "@/components/ui/card";

interface SummaryCardsProps {
  summary: RankingsSummary;
  onSelectGroup?: (groupId: string) => void;
}

export default function SummaryCards({ summary, onSelectGroup }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <BaseCard
        padding="p-3.5"
        className={`text-left ${summary.strongestGroup ? "hover:border-bullish cursor-pointer" : ""}`}
        onClick={() => summary.strongestGroup && onSelectGroup?.(summary.strongestGroup.groupId)}
        role={summary.strongestGroup ? "button" : undefined}
        tabIndex={summary.strongestGroup ? 0 : undefined}
      >
        <div className="flex items-center justify-between text-[11px] font-medium text-text-secondary mb-1">
          <span>Strongest Group (RS_STS)</span>
          <Award className="w-3.5 h-3.5 text-bullish" />
        </div>
        <div className="text-[13px] font-bold text-text truncate">
          {summary.strongestGroup ? summary.strongestGroup.label : "—"}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-bullish-bg text-bullish text-[11px] font-semibold tabular-nums">
            {summary.strongestGroup?.rsSts !== null && summary.strongestGroup?.rsSts !== undefined
              ? `▲ ${summary.strongestGroup.rsSts.toFixed(1)}%`
              : "—"}
          </span>
          <span className="text-[10px] text-text-muted">Click to inspect</span>
        </div>
      </BaseCard>

      <BaseCard
        padding="p-3.5"
        className={`text-left ${summary.weakestGroup ? "hover:border-bearish cursor-pointer" : ""}`}
        onClick={() => summary.weakestGroup && onSelectGroup?.(summary.weakestGroup.groupId)}
        role={summary.weakestGroup ? "button" : undefined}
        tabIndex={summary.weakestGroup ? 0 : undefined}
      >
        <div className="flex items-center justify-between text-[11px] font-medium text-text-secondary mb-1">
          <span>Weakest Group (RS_STS)</span>
          <TrendingDown className="w-3.5 h-3.5 text-bearish" />
        </div>
        <div className="text-[13px] font-bold text-text truncate">
          {summary.weakestGroup ? summary.weakestGroup.label : "—"}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-bearish-bg text-bearish text-[11px] font-semibold tabular-nums">
            {summary.weakestGroup?.rsSts !== null && summary.weakestGroup?.rsSts !== undefined
              ? `▼ ${summary.weakestGroup.rsSts.toFixed(1)}%`
              : "—"}
          </span>
          <span className="text-[10px] text-text-muted">Click to inspect</span>
        </div>
      </BaseCard>

      <BaseCard padding="p-3.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-text-secondary mb-1">
          <span>vs NIFTY 500 (RS &ge; 21E)</span>
          <Activity className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[18px] font-bold text-bullish leading-tight">
            {summary.outperformingCount}
          </span>
          <span className="text-[11px] font-medium text-text-secondary">Outperforming</span>
        </div>
        <div className="text-[11px] text-text-muted tabular-nums mt-0.5">
          {summary.underperformingCount} Underperforming &middot; {summary.totalGroups} groups
        </div>
      </BaseCard>

      <BaseCard padding="p-3.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-text-secondary mb-1">
          <span>RS Momentum (vs Prev Session)</span>
          <TrendingUp className="w-3.5 h-3.5 text-warning" />
        </div>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-[18px] font-bold text-bullish leading-tight">
            {summary.improvingCount}
          </span>
          <span className="text-[11px] font-medium text-text-secondary">Improving</span>
        </div>
        <div className="text-[11px] text-text-muted tabular-nums mt-0.5">
          {summary.weakeningCount} Weakening (&Delta; &gt; 0.5 pts)
        </div>
      </BaseCard>
    </div>
  );
}
