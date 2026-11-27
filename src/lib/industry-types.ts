export type ClassificationLevel = "macro" | "sector" | "industry" | "basic_industry";
export type StrengthUniverse = "all" | "liquid";
export type StrengthPeriod = "1d" | "1w" | "1m" | "3m" | "6m" | "1y";

export const VALID_LEVELS: readonly ClassificationLevel[] = [
  "macro",
  "sector",
  "industry",
  "basic_industry",
];

export const VALID_UNIVERSES: readonly StrengthUniverse[] = ["all", "liquid"];
export const VALID_PERIODS: readonly StrengthPeriod[] = ["1d", "1w", "1m", "3m", "6m", "1y"];
export type ExtendedPeriod = StrengthPeriod | "ytd";
export const VALID_EXTENDED_PERIODS: readonly ExtendedPeriod[] = ["1d", "1w", "1m", "3m", "6m", "1y", "ytd"];

export interface CoverageSummary {
  totalStocks: number;
  classifiedStocks: number;
  unclassifiedStocks: number;
  eligibleStocks: number;
  coveragePct: number | null;
  nseVerifiedStocks: number;
  nseVerifiedPct: number | null;
  nseVerifiedMcapPct: number | null;
}

export interface IndustryGroupRow {
  groupId: string;
  level: ClassificationLevel;
  label: string;
  parentId: string | null;
  fullPath: string;
  macroLabel: string | null;
  sectorLabel: string | null;
  industryLabel: string | null;
  basicIndustryLabel: string | null;
  rank: number | null;
  rankTrend: number | null;
  rankTrendPrev5: number | null;
  rankTrendChange: number | null;
  stockCount: number;
  eligibleCount: number;
  adv: number;
  dec: number;
  unch: number;
  n20dHigh: number | null;
  n20dLow: number | null;
  rsSts: number | null;
  rsStsPrev: number | null;
  rsDelta: number | null;
  rsTrend: "improving" | "weakening" | "flat" | null;
  rsLine: number | null;
  rsAboveEma21: boolean | null;
  ret1d: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  median1d: number | null;
  median1w: number | null;
  median1m: number | null;
  median3m: number | null;
  median6m: number | null;
  median1y: number | null;
  medianYtd: number | null;
  pctAbove20ema: number | null;
  pctAbove50dma: number | null;
  pctAbove200dma: number | null;
  nValid20ema: number;
  nValid50dma: number;
  nValid200dma: number;
  mcapCr: number | null;
}

export interface RankingsSummary {
  totalGroups: number;
  outperformingCount: number;
  underperformingCount: number;
  improvingCount: number;
  weakeningCount: number;
  strongestGroup: { groupId: string; label: string; rsSts: number | null } | null;
  weakestGroup: { groupId: string; label: string; rsSts: number | null } | null;
}

export interface BreadcrumbItem {
  groupId: string;
  level: ClassificationLevel;
  label: string;
}

export interface TopGroupRow {
  pos: number;
  groupId: string;
  label: string;
  sectorLabel: string | null;
  parentId: string | null;
  fullPath: string;
  r1d: number;
  r1w: number;
  r1m: number;
  r3m: number;
  worstRank: number;
  meanRank: number;
  med1d: number;
  med1w: number;
  med1m: number;
  med3m: number;
  n20dHigh: number | null;
  n20dLow: number | null;
  pctAbove50dma: number | null;
  nEligible: number;
  noteText: string;
  noteSource: "gemini" | "template";
}

export interface RankingsResponse {
  snapshotId: string | null;
  snapshotDate: string | null;
  classificationDate: string | null;
  methodologyVersion: string;
  level: ClassificationLevel;
  universe: StrengthUniverse;
  period: StrengthPeriod;
  coverage: CoverageSummary;
  summary: RankingsSummary;
  breadcrumbs: BreadcrumbItem[];
  groups: IndustryGroupRow[];
  topGroups: TopGroupRow[];
  topGroupsAsOf: string | null;
}

export interface ConstituentStockRow {
  token: number;
  symbol: string;
  name: string;
  isin: string | null;
  macro: string | null;
  sector: string | null;
  industry: string | null;
  basicIndustry: string | null;
  isLiquid: boolean;
  isNewListing: boolean;
  listingSessions: number | null;
  close: number | null;
  ret1d: number | null;
  ret1w: number | null;
  ret1m: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  retYtd: number | null;
  at20dHigh: boolean | null;
  at20dLow: boolean | null;
  pctFrom52wHigh: number | null;
  adrPct: number | null;
  above20ema: boolean | null;
  above50dma: boolean | null;
  above200dma: boolean | null;
  rsSts: number | null;
  rsAboveEma21: boolean | null;
  rsRating: number | null;
  avgTurnoverCr: number | null;
  mcapCr: number | null;
}

export interface GroupConstituentsResponse {
  snapshotId: string;
  snapshotDate: string;
  methodologyVersion: string;
  group: {
    groupId: string;
    level: ClassificationLevel;
    label: string;
    fullPath: string;
  };
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  stocks: ConstituentStockRow[];
}

export interface GroupHistoryPoint {
  date: string;
  rsLine: number | null;
  rsSts: number | null;
  ret1m: number | null;
}

export interface GroupHistoryResponse {
  groupId: string;
  label: string;
  level: ClassificationLevel;
  universe: StrengthUniverse;
  period: StrengthPeriod;
  benchmarkName: string;
  units: {
    rsLine: string;
    rsSts: string;
  };
  points: GroupHistoryPoint[];
}
