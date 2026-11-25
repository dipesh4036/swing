"use client";

import React from "react";
import { TrendingUp, TrendingDown, Activity, Award } from "lucide-react";
import { RankingsSummary } from "@/lib/industry-types";

interface SummaryCardsProps {
  summary: RankingsSummary;
  onSelectGroup?: (groupId: string) => void;
}

export default function SummaryCards({ summary, onSelectGroup }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <button
        type="button"
        disabled={!summary.strongestGroup || !onSelectGroup}
        onClick={() => summary.strongestGroup && onSelectGroup?.(summary.strongestGroup.groupId)}
        className="text-left p-3.5 rounded-xl bg-surface-elevated border border-border hover:border-emerald-500/40 transition-colors"
      >
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>Strongest Group (RS_STS)</span>
          <Award className="w-3.5 h-3.5 text-emerald-500" />
        </div>
        <div className="text-sm font-semibold text-text-primary truncate">
          {summary.strongestGroup ? summary.strongestGroup.label : "—"}
        </div>
        <div className="text-xs text-emerald-500 font-mono mt-0.5">
          {summary.strongestGroup?.rsSts !== null && summary.strongestGroup?.rsSts !== undefined
            ? `${summary.strongestGroup.rsSts.toFixed(1)}%`
            : "—"}
        </div>
      </button>

      <button
        type="button"
        disabled={!summary.weakestGroup || !onSelectGroup}
        onClick={() => summary.weakestGroup && onSelectGroup?.(summary.weakestGroup.groupId)}
        className="text-left p-3.5 rounded-xl bg-surface-elevated border border-border hover:border-rose-500/40 transition-colors"
      >
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>Weakest Group (RS_STS)</span>
          <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
        </div>
        <div className="text-sm font-semibold text-text-primary truncate">
          {summary.weakestGroup ? summary.weakestGroup.label : "—"}
        </div>
        <div className="text-xs text-rose-500 font-mono mt-0.5">
          {summary.weakestGroup?.rsSts !== null && summary.weakestGroup?.rsSts !== undefined
            ? `${summary.weakestGroup.rsSts.toFixed(1)}%`
            : "—"}
        </div>
      </button>

      <div className="p-3.5 rounded-xl bg-surface-elevated border border-border">
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>vs NIFTY 500 (RS &ge; 21E)</span>
          <Activity className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-emerald-500 font-mono">
            {summary.outperformingCount} Outperforming
          </span>
        </div>
        <div className="text-xs text-text-muted font-mono mt-0.5">
          {summary.underperformingCount} Underperforming · {summary.totalGroups} total
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-surface-elevated border border-border">
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>RS Momentum (vs Prev Session)</span>
          <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-emerald-500 font-mono">
            {summary.improvingCount} Improving
          </span>
        </div>
        <div className="text-xs text-text-muted font-mono mt-0.5">
          {summary.weakeningCount} Weakening (&Delta; &gt; 0.5 pts)
        </div>
      </div>
    </div>
  );
}
