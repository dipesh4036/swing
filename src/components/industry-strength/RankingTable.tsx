"use client";

import React from "react";
import { ArrowDown, ArrowUp, ChevronRight, LineChart as LineChartIcon } from "lucide-react";
import { ClassificationLevel, IndustryGroupRow } from "@/lib/industry-types";
import { BaseCard } from "@/components/ui/card";

interface RankingTableProps {
  groups: IndustryGroupRow[];
  level: ClassificationLevel;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (col: string) => void;
  selectedGroupId: string | null;
  onSelectGroup: (group: IndustryGroupRow) => void;
  onDrillDown?: (group: IndustryGroupRow) => void;
  chartGroupIds: string[];
  onToggleChartGroup: (group: IndustryGroupRow) => void;
}

function fmtPct(val: number | null, decimals = 1, signed = false) {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return (
      <span className="text-text-muted" title="Insufficient history or corporate action">
        —
      </span>
    );
  }
  const prefix = signed && val > 0 ? "+" : "";
  const cls = signed
    ? val > 0
      ? "text-bullish font-medium"
      : val < 0
        ? "text-bearish font-medium"
        : "text-text-secondary"
    : "text-text";
  return <span className={`tabular-nums ${cls}`}>{`${prefix}${val.toFixed(decimals)}%`}</span>;
}

function rsBadgeClass(rs: number | null) {
  if (rs === null) return "bg-bg-secondary text-text-muted border-border";
  if (rs >= 75) return "bg-bullish-bg text-bullish border-bullish-border";
  if (rs >= 50) return "bg-warning-bg text-warning border-border";
  return "bg-bearish-bg text-bearish border-bearish-border";
}

export default function RankingTable({
  groups,
  level,
  sortBy,
  sortDir,
  onSortChange,
  selectedGroupId,
  onSelectGroup,
  onDrillDown,
  chartGroupIds,
  onToggleChartGroup,
}: RankingTableProps) {
  const canDrill = level !== "basic_industry" && Boolean(onDrillDown);

  const renderHeader = (key: string, label: string, align = "right") => {
    const active = sortBy === key;
    return (
      <th
        key={key}
        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap cursor-pointer select-none hover:text-text transition-colors ${
          align === "left" ? "text-left" : "text-right"
        }`}
        onClick={() => onSortChange(key)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />)}
        </span>
      </th>
    );
  };

  return (
    <BaseCard padding="p-0" className="overflow-hidden">
      <div className="overflow-x-auto max-h-[540px]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-secondary border-b border-border">
            <tr>
              {renderHeader("rank", "#", "left")}
              {renderHeader("label", "Group", "left")}
              {renderHeader("n_stocks", "Elig / Tot")}
              {renderHeader("rs_sts", "RS_STS%")}
              {renderHeader("ret_1d", "1D")}
              {renderHeader("ret_1w", "1W")}
              {renderHeader("ret_1m", "1M")}
              {renderHeader("ret_3m", "3M")}
              {renderHeader("ret_6m", "6M")}
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-right whitespace-nowrap">
                A / D
              </th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-right whitespace-nowrap">
                &gt;20E
              </th>
              {renderHeader("pct_above_50dma", ">50D")}
              {renderHeader("pct_above_200dma", ">200D")}
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-center whitespace-nowrap">
                RS vs 21E
              </th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-center whitespace-nowrap">
                Compare
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {groups.length === 0 ? (
              <tr>
                <td colSpan={15} className="px-4 py-12 text-center text-text-muted">
                  No classification groups match your current filter criteria.
                </td>
              </tr>
            ) : (
              groups.map((g, idx) => {
                const isSelected = selectedGroupId === g.groupId;
                const inChart = chartGroupIds.includes(g.groupId);
                return (
                  <tr
                    key={g.groupId}
                    onClick={() => onSelectGroup(g)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-bg-selected border-l-2 border-l-primary"
                        : idx % 2 === 1
                          ? "bg-bg-secondary/35 hover:bg-bg-hover"
                          : "hover:bg-bg-hover"
                    }`}
                  >
                    <td className="px-3 py-2.5 tabular-nums font-medium text-text-muted whitespace-nowrap">
                      {g.rank ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 min-w-[210px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-text truncate">{g.label}</div>
                          {level !== "macro" && (
                            <div className="text-[10px] text-text-muted truncate" title={g.fullPath}>
                              {g.fullPath}
                            </div>
                          )}
                        </div>
                        {canDrill && (
                          <button
                            type="button"
                            title={`Drill down into ${g.label}`}
                            aria-label={`Drill down into ${g.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDrillDown?.(g);
                            }}
                            className="p-1 rounded-[4px] hover:bg-primary-subtle text-text-muted hover:text-primary shrink-0 cursor-pointer transition-colors"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary whitespace-nowrap">
                      {g.eligibleCount}/{g.stockCount}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border text-[11px] font-semibold ${rsBadgeClass(
                          g.rsSts
                        )}`}
                      >
                        {g.rsSts !== null ? `${g.rsSts.toFixed(1)}%` : "—"}
                        {g.rsTrend === "improving" && <span className="text-[9px]">▲</span>}
                        {g.rsTrend === "weakening" && <span className="text-[9px]">▼</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPct(g.ret1d, 2, true)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPct(g.ret1w, 2, true)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPct(g.ret1m, 2, true)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPct(g.ret3m, 2, true)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPct(g.ret6m, 2, true)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      <span className="text-bullish font-medium">{g.adv}</span>
                      <span className="text-text-muted">/</span>
                      <span className="text-bearish font-medium">{g.dec}</span>
                    </td>
                    <td
                      className="px-3 py-2.5 text-right whitespace-nowrap"
                      title={`Valid observations: ${g.nValid20ema}/${g.stockCount}`}
                    >
                      {fmtPct(g.pctAbove20ema, 0, false)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right whitespace-nowrap"
                      title={`Valid observations: ${g.nValid50dma}/${g.stockCount}`}
                    >
                      {fmtPct(g.pctAbove50dma, 0, false)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right whitespace-nowrap"
                      title={`Valid observations: ${g.nValid200dma}/${g.stockCount}`}
                    >
                      {fmtPct(g.pctAbove200dma, 0, false)}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {g.rsAboveEma21 === null ? (
                        <span className="text-text-muted" title="Insufficient RS history">
                          —
                        </span>
                      ) : g.rsAboveEma21 ? (
                        <span className="px-1.5 py-0.5 rounded-[4px] bg-bullish-bg text-bullish border border-bullish-border text-[10px] font-semibold">
                          ▲ &gt;21E
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded-[4px] bg-bearish-bg text-bearish border border-bearish-border text-[10px] font-semibold">
                          ▼ &lt;21E
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <button
                        type="button"
                        aria-label={`Compare ${g.label} in Rotation Chart`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleChartGroup(g);
                        }}
                        className={`p-1 rounded-[4px] border cursor-pointer transition-colors ${
                          inChart
                            ? "bg-primary-subtle border-accent-border text-primary"
                            : "border-border text-text-muted hover:text-text hover:bg-bg-hover"
                        }`}
                      >
                        <LineChartIcon className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </BaseCard>
  );
}
