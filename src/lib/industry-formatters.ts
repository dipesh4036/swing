import { ExtendedPeriod, IndustryGroupRow } from "@/lib/industry-types";

export type RankCycleMode = "normal" | "climbers" | "fallers";

export function nextRankCycleState(current: RankCycleMode): RankCycleMode {
  if (current === "normal") return "climbers";
  if (current === "climbers") return "fallers";
  return "normal";
}

export function shouldShowRankMove(
  change: number | null | undefined,
  mode: RankCycleMode
): boolean {
  if (change === null || change === undefined || !Number.isFinite(change)) {
    return false;
  }
  if (mode === "normal") {
    return Math.abs(change) > 5;
  }
  return true;
}

export function formatRankMove(
  change: number | null | undefined,
  mode: RankCycleMode
): string | null {
  if (!shouldShowRankMove(change, mode)) return null;
  const val = Math.trunc(Number(change));
  if (val > 0) return `+${val}`;
  if (val < 0) return `${val}`;
  return "0";
}

export function formatSignedPct(
  val: number | null | undefined,
  decimals = 1
): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  const prefix = val > 0 ? "+" : "";
  return `${prefix}${val.toFixed(decimals)}%`;
}

export function formatUnsignedPct(
  val: number | null | undefined,
  decimals = 0
): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return `${val.toFixed(decimals)}%`;
}

export function formatPriceInr(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "—";
  return `₹${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function getGroupMedianByPeriod(
  group: IndustryGroupRow,
  period: ExtendedPeriod
): number | null {
  switch (period) {
    case "1d":
      return group.median1d;
    case "1w":
      return group.median1w;
    case "1m":
      return group.median1m;
    case "3m":
      return group.median3m;
    case "6m":
      return group.median6m;
    case "1y":
      return group.median1y;
    case "ytd":
      return group.medianYtd;
    default:
      return group.median1m;
  }
}
