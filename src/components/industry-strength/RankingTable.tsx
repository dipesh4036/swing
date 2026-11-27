"use client";

import React from "react";
import { ArrowDown, ArrowUp, ChevronRight, LineChart as LineChartIcon } from "lucide-react";
import { ClassificationLevel, ExtendedPeriod, IndustryGroupRow } from "@/lib/industry-types";
import {
  RankCycleMode,
  formatRankMove,
  formatSignedPct,
  formatUnsignedPct,
  getGroupMedianByPeriod,
} from "@/lib/industry-formatters";
import { BaseCard } from "@/components/ui/card";

interface RankingTableProps {
  groups: IndustryGroupRow[];
  level: ClassificationLevel;
  period: ExtendedPeriod;
  moreColumns: boolean;
  rankMode: RankCycleMode;
  onRankHeaderClick: () => void;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSortChange: (col: string) => void;
  selectedGroupId: string | null;
  onSelectGroup: (group: IndustryGroupRow, triggerEl?: HTMLElement | null) => void;
  onDrillDown?: (group: IndustryGroupRow) => void;
  chartGroupIds: string[];
  onToggleChartGroup: (group: IndustryGroupRow) => void;
}

function signedCls(val: number | null | undefined) {
  if (val === null || val === undefined || !Number.isFinite(val)) return "text-text-muted";
  if (val > 0) return "text-bullish font-medium";
  if (val < 0) return "text-bearish font-medium";
  return "text-text-secondary";
}

function RankBadge({
  rank,
  change,
  mode,
}: {
  rank: number | null;
  change: number | null;
  mode: RankCycleMode;
}) {
  const moveStr = formatRankMove(change, mode);
  return (
    <div className="inline-flex items-center gap-1.5 tabular-nums">
      <span className="font-semibold text-text">{rank ?? "—"}</span>
      {moveStr && (
        <span
          className={`px-1 py-0.2 rounded-[4px] text-[10px] font-semibold ${
            (change ?? 0) > 0
              ? "bg-bullish-bg text-bullish"
              : (change ?? 0) < 0
                ? "bg-bearish-bg text-bearish"
                : "bg-bg-secondary text-text-muted"
          }`}
          title={`5-session rank change: ${moveStr}`}
        >
          {(change ?? 0) > 0 ? `▲${moveStr}` : (change ?? 0) < 0 ? `▼${moveStr}` : moveStr}
        </span>
      )}
    </div>
  );
}

export default function RankingTable({
  groups,
  level,
  period,
  moreColumns,
  rankMode,
  onRankHeaderClick,
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

  const renderHeader = (key: string, label: string, align = "right", extraClass = "") => {
    const active = sortBy === key;
    return (
      <th
        key={key}
        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap cursor-pointer select-none hover:text-text ${
          align === "left" ? "text-left" : "text-right"
        } ${extraClass}`}
        onClick={() => onSortChange(key)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />)}
        </span>
      </th>
    );
  };

  const rankHeaderLabel =
    rankMode === "climbers"
      ? "Rank (Climbers)"
      : rankMode === "fallers"
        ? "Rank (Fallers)"
        : "Rank";

  return (
    <>
      {/* Desktop / Tablet Table (sticky header & sticky first 2 columns) */}
      <BaseCard padding="p-0" className="hidden sm:block overflow-hidden">
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full text-[12px] border-collapse">
            <thead className="sticky top-0 z-20 bg-bg-secondary border-b border-border">
              <tr>
                <th
                  onClick={onRankHeaderClick}
                  title="Click to cycle: Rank → Biggest Climbers → Biggest Fallers → Rank"
                  className="sticky left-0 z-30 bg-bg-secondary px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap cursor-pointer select-none hover:text-text min-w-[84px]"
                >
                  <span className="inline-flex items-center gap-1">
                    {rankHeaderLabel}
                    {rankMode === "climbers" && <ArrowUp className="w-3 h-3 text-bullish" />}
                    {rankMode === "fallers" && <ArrowDown className="w-3 h-3 text-bearish" />}
                  </span>
                </th>
                <th
                  onClick={() => onSortChange("label")}
                  className="sticky left-[84px] z-30 bg-bg-secondary px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap cursor-pointer select-none hover:text-text border-r border-border-subtle min-w-[210px]"
                >
                  <span className="inline-flex items-center gap-1">
                    Group
                    {sortBy === "label" &&
                      (sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />)}
                  </span>
                </th>
                {renderHeader("n_stocks", "Stocks")}
                {renderHeader(`median_${period}`, `MED (${period.toUpperCase()})`)}
                {renderHeader("n_20d_high", "20D H/L")}
                {renderHeader("pct_above_50dma", ">50 SMA")}
                {renderHeader("rs_sts", "RS-STS")}
                {moreColumns && (
                  <>
                    {renderHeader("median_1d", "1D")}
                    {renderHeader("median_1w", "1W")}
                    {renderHeader("median_1m", "1M")}
                    {renderHeader("median_3m", "3M")}
                    {renderHeader("median_6m", "6M")}
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-right whitespace-nowrap">
                      &gt;20E
                    </th>
                    {renderHeader("pct_above_200dma", ">200D")}
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-right whitespace-nowrap">
                      Adv / Dec
                    </th>
                    <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-center whitespace-nowrap">
                      RS vs 21E
                    </th>
                    {renderHeader("mcap_cr", "MCap (Cr)")}
                  </>
                )}
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-secondary text-center whitespace-nowrap">
                  Compare
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={moreColumns ? 18 : 8} className="px-4 py-12 text-center text-text-muted">
                    No groups match the current filter. Enable &ldquo;Show small groups&rdquo; or clear search.
                  </td>
                </tr>
              ) : (
                groups.map((g, idx) => {
                  const isSelected = selectedGroupId === g.groupId;
                  const inChart = chartGroupIds.includes(g.groupId);
                  const rowBg = isSelected
                    ? "bg-bg-selected"
                    : idx % 2 === 1
                      ? "bg-bg-secondary/35"
                      : "bg-surface";
                  const medVal = getGroupMedianByPeriod(g, period);

                  return (
                    <tr
                      key={g.groupId}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${g.label} constituents`}
                      onClick={(e) => onSelectGroup(g, e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectGroup(g, e.currentTarget);
                        }
                      }}
                      className={`cursor-pointer hover:bg-bg-hover focus-visible:outline-none ${rowBg} ${
                        isSelected ? "border-l-2 border-l-primary" : ""
                      }`}
                    >
                      <td className={`sticky left-0 z-10 px-3 py-2.5 whitespace-nowrap ${rowBg}`}>
                        <RankBadge rank={g.rankTrend} change={g.rankTrendChange} mode={rankMode} />
                      </td>
                      <td className={`sticky left-[84px] z-10 px-3 py-2.5 border-r border-border-subtle min-w-[210px] ${rowBg}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-text truncate">{g.label}</div>
                            {level !== "macro" && (
                              <div className="text-[10px] text-text-muted truncate max-w-[220px]" title={g.fullPath}>
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
                              className="p-1 rounded-[4px] hover:bg-primary-subtle text-text-muted hover:text-primary shrink-0 cursor-pointer"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary whitespace-nowrap">
                        {g.eligibleCount}/{g.stockCount}
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(medVal)}`}>
                        {formatSignedPct(medVal, 2)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {g.n20dHigh === null || g.n20dLow === null ? (
                          <span className="text-text-muted">—</span>
                        ) : (
                          <>
                            <span className="text-bullish font-medium">{g.n20dHigh}H</span>
                            <span className="text-text-muted mx-1">/</span>
                            <span className="text-bearish font-medium">{g.n20dLow}L</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text whitespace-nowrap">
                        {formatUnsignedPct(g.pctAbove50dma, 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary whitespace-nowrap">
                        {g.rsSts !== null ? `${g.rsSts.toFixed(1)}%` : "—"}
                      </td>
                      {moreColumns && (
                        <>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(g.median1d)}`}>
                            {formatSignedPct(g.median1d, 2)}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(g.median1w)}`}>
                            {formatSignedPct(g.median1w, 2)}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(g.median1m)}`}>
                            {formatSignedPct(g.median1m, 2)}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(g.median3m)}`}>
                            {formatSignedPct(g.median3m, 2)}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums whitespace-nowrap ${signedCls(g.median6m)}`}>
                            {formatSignedPct(g.median6m, 2)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text whitespace-nowrap">
                            {formatUnsignedPct(g.pctAbove20ema, 0)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text whitespace-nowrap">
                            {formatUnsignedPct(g.pctAbove200dma, 0)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                            <span className="text-bullish font-medium">{g.adv}A</span>
                            <span className="text-text-muted mx-1">/</span>
                            <span className="text-bearish font-medium">{g.dec}D</span>
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            {g.rsAboveEma21 === null ? (
                              <span className="text-text-muted">—</span>
                            ) : g.rsAboveEma21 ? (
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-bullish-bg text-bullish text-[10px] font-semibold">
                                ▲ &gt;21E
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-[4px] bg-bearish-bg text-bearish text-[10px] font-semibold">
                                ▼ &lt;21E
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary whitespace-nowrap">
                            {g.mcapCr !== null ? `₹${Math.round(g.mcapCr).toLocaleString("en-IN")}` : "—"}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <button
                          type="button"
                          aria-label={`Compare ${g.label} in Rotation Chart`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleChartGroup(g);
                          }}
                          className={`p-1 rounded-[4px] border cursor-pointer ${
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

      {/* Mobile Cards (< 640px / 360px): zero horizontal page scroll */}
      <div className="sm:hidden space-y-2">
        {groups.length === 0 ? (
          <BaseCard padding="p-6" className="text-center text-xs text-text-muted">
            No groups match the current filter.
          </BaseCard>
        ) : (
          groups.map((g) => {
            const medVal = getGroupMedianByPeriod(g, period);
            return (
              <BaseCard
                key={g.groupId}
                padding="p-3"
                role="button"
                tabIndex={0}
                onClick={(e: React.MouseEvent<HTMLElement>) => onSelectGroup(g, e.currentTarget)}
                onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectGroup(g, e.currentTarget);
                  }
                }}
                className="cursor-pointer hover:bg-bg-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RankBadge rank={g.rankTrend} change={g.rankTrendChange} mode={rankMode} />
                      <span className="font-semibold text-[13px] text-text truncate">{g.label}</span>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5 tabular-nums">
                      {g.eligibleCount}/{g.stockCount} stocks
                    </div>
                  </div>
                  <div className={`text-sm font-bold tabular-nums shrink-0 ${signedCls(medVal)}`}>
                    {formatSignedPct(medVal, 2)}
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-border-subtle flex items-center justify-between text-[11px] tabular-nums">
                  <span>
                    20D H/L: <strong className="text-bullish">{g.n20dHigh}H</strong> /{" "}
                    <strong className="text-bearish">{g.n20dLow}L</strong>
                  </span>
                  <span>
                    &gt;50 SMA: <strong className="text-text">{formatUnsignedPct(g.pctAbove50dma, 0)}</strong>
                  </span>
                </div>
              </BaseCard>
            );
          })
        )}
      </div>
    </>
  );
}
