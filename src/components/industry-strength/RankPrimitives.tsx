"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ExtendedPeriod, IndustryGroupRow } from "@/lib/industry-types";
import { RankCycleMode, shouldShowRankMove } from "@/lib/industry-formatters";

export function getMedianForPeriod(row: IndustryGroupRow, period: ExtendedPeriod): number | null {
  switch (period) {
    case "1d":
      return row.median1d;
    case "1w":
      return row.median1w;
    case "1m":
      return row.median1m;
    case "3m":
      return row.median3m;
    case "6m":
      return row.median6m;
    case "1y":
      return row.median1y;
    case "ytd":
      return row.medianYtd;
    default:
      return row.median1m;
  }
}

export function format20dHL(high: number | null | undefined, low: number | null | undefined): string {
  if (high === null || high === undefined || low === null || low === undefined) {
    return "—";
  }
  return `${high}H / ${low}L`;
}

export function RankBadge({
  rank,
  medal = false,
}: {
  rank: number | null;
  medal?: boolean;
}) {
  if (rank === null || rank === undefined) {
    return <span className="tabular-nums text-xs text-text-muted tabular-nums">—</span>;
  }
  const medalCls =
    medal && rank === 1
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
      : medal && rank === 2
        ? "bg-slate-400/15 text-slate-600 dark:text-slate-300 border-slate-400/30"
        : medal && rank === 3
          ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30"
          : "bg-bg-secondary text-text border-border";

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md border tabular-nums text-xs font-semibold tabular-nums ${medalCls}`}
    >
      #{rank}
    </span>
  );
}

export function RankChangeChip({
  change,
  mode = "normal",
}: {
  change: number | null;
  mode?: RankCycleMode;
}) {
  if (!shouldShowRankMove(change, mode) || change === null) {
    return null;
  }
  const up = change > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs tabular-nums font-semibold tabular-nums ${
        up
          ? "bg-success-bg text-success"
          : "bg-danger-bg text-danger"
      }`}
    >
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {up ? `+${change}` : `${change}`}
    </span>
  );
}

export function SignedReturn({
  value,
  size = "sm",
}: {
  value: number | null;
  size?: "xs" | "sm" | "lg";
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="tabular-nums text-text-muted tabular-nums">—</span>;
  }
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  const colorCls =
    value > 0
      ? "text-success"
      : value < 0
        ? "text-danger"
        : "text-text-secondary";
  const sizeCls =
    size === "lg"
      ? "text-[15px] font-semibold"
      : size === "xs"
        ? "text-[13px] font-semibold"
        : "text-sm font-semibold";

  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${colorCls} ${sizeCls}`}>
      {value === 0 && <Minus className="w-2.5 h-2.5 inline" />}
      {sign}
      {value.toFixed(1)}%
    </span>
  );
}
