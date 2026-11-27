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
        <div className="grid grid-cols-3 gap-2 flex-1 min-w-0 text-xs">
          <button
            type="button"
            onClick={() => summary.strongestGroup && onSelectGroup(summary.strongestGroup.groupId)}
            disabled={!summary.strongestGroup}
            className="text-left min-w-0 cursor-pointer disabled:cursor-default"
          >
            <div className="text-xs uppercase tracking-wider text-text-secondary">Strongest</div>
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
            <div className="text-xs uppercase tracking-wider text-text-secondary">Weakest</div>
            <div className="font-semibold text-danger truncate">
              {summary.weakestGroup ? summary.weakestGroup.label : "—"}
            </div>
          </button>

          <div className="text-left min-w-0">
            <div className="text-xs uppercase tracking-wider text-text-secondary">Beat NIFTY 500</div>
            <div className="tabular-nums font-semibold text-text tabular-nums">
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
        <div className="mt-2 pt-2 border-t border-border grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-text-secondary">Underperforming: </span>
            <span className="tabular-nums font-semibold text-text tabular-nums">{summary.underperformingCount}</span>
          </div>
          <div>
            <span className="text-text-secondary">Improving: </span>
            <span className="tabular-nums font-semibold text-success tabular-nums">{summary.improvingCount}</span>
          </div>
          <div>
            <span className="text-text-secondary">Weakening: </span>
            <span className="tabular-nums font-semibold text-danger tabular-nums">{summary.weakeningCount}</span>
          </div>
        </div>
      )}
    </div>
  );
}
