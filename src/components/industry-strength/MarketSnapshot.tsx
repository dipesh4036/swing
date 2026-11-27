"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RankingsSummary } from "@/lib/industry-types";

export default function MarketSnapshot({
  summary,
  onSelectGroup,
}: {
  summary: RankingsSummary;
  onSelectGroup: (groupId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="grid grid-cols-3 gap-2 flex-1 min-w-0 text-[11px]">
          <button
            type="button"
            onClick={() => summary.strongestGroup && onSelectGroup(summary.strongestGroup.groupId)}
            disabled={!summary.strongestGroup}
            className="text-left min-w-0 cursor-pointer disabled:cursor-default"
          >
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Strongest</div>
            <div className="font-semibold text-success truncate">
              {summary.strongestGroup ? summary.strongestGroup.label : "—"}
            </div>
          </button>

          <button
            type="button"
            onClick={() => summary.weakestGroup && onSelectGroup(summary.weakestGroup.groupId)}
            disabled={!summary.weakestGroup}
            className="text-left min-w-0 cursor-pointer disabled:cursor-default"
          >
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Weakest</div>
            <div className="font-semibold text-danger truncate">
              {summary.weakestGroup ? summary.weakestGroup.label : "—"}
            </div>
          </button>

          <div className="text-left min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Beat NIFTY 500</div>
            <div className="font-mono font-semibold text-text tabular-nums">
              {summary.outperformingCount} / {summary.totalGroups}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="Toggle market snapshot details"
          className="p-1 rounded text-text-secondary hover:text-text hover:bg-bg-secondary shrink-0 cursor-pointer"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <span className="text-text-muted">Underperforming: </span>
            <span className="font-mono font-semibold text-text tabular-nums">{summary.underperformingCount}</span>
          </div>
          <div>
            <span className="text-text-muted">Improving: </span>
            <span className="font-mono font-semibold text-success tabular-nums">{summary.improvingCount}</span>
          </div>
          <div>
            <span className="text-text-muted">Weakening: </span>
            <span className="font-mono font-semibold text-danger tabular-nums">{summary.weakeningCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
