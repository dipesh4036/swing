import { queryWithRetry } from "@/lib/db";
import {
  BreadcrumbItem,
  ClassificationLevel,
  ConstituentStockRow,
  CoverageSummary,
  GroupConstituentsResponse,
  GroupHistoryPoint,
  GroupHistoryResponse,
  IndustryGroupRow,
  RankingsResponse,
  RankingsSummary,
  StrengthPeriod,
  StrengthUniverse,
  VALID_LEVELS,
  VALID_PERIODS,
  VALID_UNIVERSES,
} from "@/lib/industry-types";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function toInt(val: unknown, fallback = 0): number {
  const num = toFiniteNumber(val);
  return num === null ? fallback : Math.trunc(num);
}

export function validateLevel(raw: string | null): ClassificationLevel {
  if (raw && (VALID_LEVELS as readonly string[]).includes(raw)) {
    return raw as ClassificationLevel;
  }
  return "industry";
}

export function validateUniverse(raw: string | null): StrengthUniverse {
  if (raw && (VALID_UNIVERSES as readonly string[]).includes(raw)) {
    return raw as StrengthUniverse;
  }
  return "all";
}

export function validatePeriod(raw: string | null): StrengthPeriod {
  if (raw && (VALID_PERIODS as readonly string[]).includes(raw)) {
    return raw as StrengthPeriod;
  }
  return "1m";
}

const RANKING_SORT_ALLOWLIST: Record<string, string> = {
  rank: "COALESCE(d.rank, 999999)",
  rs_sts: "COALESCE(d.rs_sts, -999)",
  ret_1d: "COALESCE(d.ret_1d, -999)",
  ret_1w: "COALESCE(d.ret_1w, -999)",
  ret_1m: "COALESCE(d.ret_1m, -999)",
  ret_3m: "COALESCE(d.ret_3m, -999)",
  ret_6m: "COALESCE(d.ret_6m, -999)",
  pct_above_50dma: "COALESCE(d.pct_above_50dma, -999)",
  pct_above_200dma: "COALESCE(d.pct_above_200dma, -999)",
  n_stocks: "d.n_stocks",
  mcap_cr: "COALESCE(d.mcap_cr, -1)",
  label: "g.label",
};

const STOCK_SORT_ALLOWLIST: Record<string, string> = {
  rs_sts: "COALESCE(m.rs_sts, -999)",
  rs_rating: "COALESCE(m.rs_rating, -1)",
  ret_1d: "COALESCE(m.ret_1d, -999)",
  ret_1w: "COALESCE(m.ret_1w, -999)",
  ret_1m: "COALESCE(m.ret_1m, -999)",
  ret_3m: "COALESCE(m.ret_3m, -999)",
  ret_6m: "COALESCE(m.ret_6m, -999)",
  adr_pct: "COALESCE(m.adr_pct, -1)",
  pct_from_52w_high: "COALESCE(m.pct_from_52w_high, 999)",
  avg_turnover_cr: "COALESCE(m.avg_turnover_cr, -1)",
  mcap_cr: "COALESCE(m.mcap_cr, -1)",
  symbol: "m.symbol",
};

export async function getLatestCompletedSnapshot(q: QueryFn = queryWithRetry) {
  const res = await q(
    `
    SELECT snapshot_id,
           trade_date::text AS trade_date,
           classification_date::text AS classification_date,
           methodology_version,
           total_stocks,
           classified_stocks,
           eligible_stocks,
           group_count
    FROM industry_snapshots
    WHERE status = 'completed'
    ORDER BY trade_date DESC, completed_at DESC
    LIMIT 1;
    `
  );
  return res.rows[0] || null;
}

export function getCoverageFromSnapshot(snap: Record<string, unknown> | null): CoverageSummary {
  if (!snap) {
    return {
      totalStocks: 0,
      classifiedStocks: 0,
      unclassifiedStocks: 0,
      eligibleStocks: 0,
      coveragePct: null,
    };
  }
  const total = toInt(snap.total_stocks);
  const classified = toInt(snap.classified_stocks);
  const eligible = toInt(snap.eligible_stocks);
  return {
    totalStocks: total,
    classifiedStocks: classified,
    unclassifiedStocks: Math.max(0, total - classified),
    eligibleStocks: eligible,
    coveragePct: total > 0 ? Number(((classified / total) * 100).toFixed(1)) : null,
  };
}

export async function getBreadcrumbs(
  parentId: string | null,
  q: QueryFn = queryWithRetry
): Promise<BreadcrumbItem[]> {
  if (!parentId) return [];
  const res = await q(
    `
    WITH RECURSIVE anc AS (
      SELECT group_id, level, label, parent_id, 0 AS depth
      FROM industry_groups
      WHERE group_id = $1
      UNION ALL
      SELECT g.group_id, g.level, g.label, g.parent_id, anc.depth + 1
      FROM industry_groups g
      JOIN anc ON anc.parent_id = g.group_id
      WHERE anc.depth < 4
    )
    SELECT group_id, level, label
    FROM anc
    ORDER BY depth DESC;
    `,
    [parentId]
  );
  return res.rows.map((r) => ({
    groupId: String(r.group_id),
    level: validateLevel(String(r.level)),
    label: String(r.label),
  }));
}

export async function getRankings(
  params: {
    level?: string | null;
    period?: string | null;
    universe?: string | null;
    parentId?: string | null;
    search?: string | null;
    sortBy?: string | null;
    sortDir?: string | null;
  },
  q: QueryFn = queryWithRetry
): Promise<RankingsResponse> {
  const level = validateLevel(params.level ?? null);
  const universe = validateUniverse(params.universe ?? null);
  const period = validatePeriod(params.period ?? null);
  const parentId = params.parentId?.trim() || null;
  const search = params.search?.trim() || null;

  const sortCol = RANKING_SORT_ALLOWLIST[params.sortBy || "rank"] || RANKING_SORT_ALLOWLIST.rank;
  const sortDir = params.sortDir === "desc" ? "DESC" : "ASC";

  const snap = await getLatestCompletedSnapshot(q);
  const coverage = getCoverageFromSnapshot(snap);

  if (!snap) {
    return {
      snapshotId: null,
      snapshotDate: null,
      classificationDate: null,
      methodologyVersion: "rs_sts_v1",
      level,
      universe,
      period,
      coverage,
      summary: {
        totalGroups: 0,
        outperformingCount: 0,
        underperformingCount: 0,
        improvingCount: 0,
        weakeningCount: 0,
        strongestGroup: null,
        weakestGroup: null,
      },
      breadcrumbs: [],
      groups: [],
    };
  }

  const tradeDate = String(snap.trade_date).split("T")[0];
  const conditions: string[] = [
    "d.trade_date = $1",
    "d.universe = $2",
    "g.level = $3",
  ];
  const sqlParams: unknown[] = [tradeDate, universe, level];
  let idx = 4;

  if (parentId) {
    conditions.push(`g.parent_id = $${idx}`);
    sqlParams.push(parentId);
    idx++;
  }
  if (search) {
    conditions.push(`(g.label ILIKE $${idx} OR g.full_path ILIKE $${idx})`);
    sqlParams.push(`%${search}%`);
    idx++;
  }

  const [rowsRes, breadcrumbs] = await Promise.all([
    q(
      `
      SELECT g.group_id, g.level, g.label, g.parent_id, g.full_path,
             g.macro_label, g.sector_label, g.industry_label, g.basic_industry_label,
             d.rank, d.n_stocks, d.n_eligible, d.adv, d.dec, d.unch,
             d.rs_sts, d.rs_sts_prev, d.rs_line, d.rs_above_ema21,
             d.ret_1d, d.ret_1w, d.ret_1m, d.ret_3m, d.ret_6m,
             d.pct_above_20ema, d.pct_above_50dma, d.pct_above_200dma,
             d.n_valid_20ema, d.n_valid_50dma, d.n_valid_200dma,
             d.mcap_cr
      FROM daily_industry_strength d
      JOIN industry_groups g ON g.group_id = d.group_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${sortCol} ${sortDir}, g.label ASC;
      `,
      sqlParams
    ),
    getBreadcrumbs(parentId, q),
  ]);

  const groups: IndustryGroupRow[] = rowsRes.rows.map((r) => {
    const rsSts = toFiniteNumber(r.rs_sts);
    const rsPrev = toFiniteNumber(r.rs_sts_prev);
    const rsDelta =
      rsSts !== null && rsPrev !== null ? Number((rsSts - rsPrev).toFixed(2)) : null;
    let rsTrend: "improving" | "weakening" | "flat" | null = null;
    if (rsDelta !== null) {
      rsTrend = rsDelta > 0.5 ? "improving" : rsDelta < -0.5 ? "weakening" : "flat";
    }
    return {
      groupId: String(r.group_id),
      level: validateLevel(String(r.level)),
      label: String(r.label),
      parentId: r.parent_id ? String(r.parent_id) : null,
      fullPath: String(r.full_path),
      macroLabel: r.macro_label ? String(r.macro_label) : null,
      sectorLabel: r.sector_label ? String(r.sector_label) : null,
      industryLabel: r.industry_label ? String(r.industry_label) : null,
      basicIndustryLabel: r.basic_industry_label ? String(r.basic_industry_label) : null,
      rank: r.rank !== null && r.rank !== undefined ? toInt(r.rank) : null,
      stockCount: toInt(r.n_stocks),
      eligibleCount: toInt(r.n_eligible),
      adv: toInt(r.adv),
      dec: toInt(r.dec),
      unch: toInt(r.unch),
      rsSts,
      rsStsPrev: rsPrev,
      rsDelta,
      rsTrend,
      rsLine: toFiniteNumber(r.rs_line),
      rsAboveEma21: r.rs_above_ema21 === null ? null : Boolean(r.rs_above_ema21),
      ret1d: toFiniteNumber(r.ret_1d),
      ret1w: toFiniteNumber(r.ret_1w),
      ret1m: toFiniteNumber(r.ret_1m),
      ret3m: toFiniteNumber(r.ret_3m),
      ret6m: toFiniteNumber(r.ret_6m),
      pctAbove20ema: toFiniteNumber(r.pct_above_20ema),
      pctAbove50dma: toFiniteNumber(r.pct_above_50dma),
      pctAbove200dma: toFiniteNumber(r.pct_above_200dma),
      nValid20ema: toInt(r.n_valid_20ema),
      nValid50dma: toInt(r.n_valid_50dma),
      nValid200dma: toInt(r.n_valid_200dma),
      mcapCr: toFiniteNumber(r.mcap_cr),
    };
  });

  const ranked = groups.filter((g) => g.rsSts !== null);
  const sortedByRs = [...ranked].sort((a, b) => (b.rsSts ?? -1) - (a.rsSts ?? -1));
  const summary: RankingsSummary = {
    totalGroups: groups.length,
    outperformingCount: ranked.filter((g) => g.rsAboveEma21 === true || (g.rsSts ?? 0) >= 60).length,
    underperformingCount: ranked.filter((g) => g.rsAboveEma21 === false && (g.rsSts ?? 0) < 60).length,
    improvingCount: ranked.filter((g) => g.rsTrend === "improving").length,
    weakeningCount: ranked.filter((g) => g.rsTrend === "weakening").length,
    strongestGroup: sortedByRs[0]
      ? { groupId: sortedByRs[0].groupId, label: sortedByRs[0].label, rsSts: sortedByRs[0].rsSts }
      : null,
    weakestGroup: sortedByRs.length
      ? {
          groupId: sortedByRs[sortedByRs.length - 1].groupId,
          label: sortedByRs[sortedByRs.length - 1].label,
          rsSts: sortedByRs[sortedByRs.length - 1].rsSts,
        }
      : null,
  };

  return {
    snapshotId: String(snap.snapshot_id),
    snapshotDate: tradeDate,
    classificationDate: snap.classification_date
      ? String(snap.classification_date).split("T")[0]
      : null,
    methodologyVersion: String(snap.methodology_version || "rs_sts_v1"),
    level,
    universe,
    period,
    coverage,
    summary,
    breadcrumbs,
    groups,
  };
}

export async function getGroupConstituents(
  groupId: string,
  params: {
    page?: number;
    limit?: number;
    universe?: string | null;
    search?: string | null;
    sortBy?: string | null;
    sortDir?: string | null;
  },
  q: QueryFn = queryWithRetry
): Promise<GroupConstituentsResponse | null> {
  const snap = await getLatestCompletedSnapshot(q);
  if (!snap) return null;

  const grpRes = await q(
    `
    SELECT group_id, level, label, full_path,
           macro_label, sector_label, industry_label, basic_industry_label
    FROM industry_groups
    WHERE group_id = $1;
    `,
    [groupId]
  );
  const grp = grpRes.rows[0];
  if (!grp) return null;

  const page = Math.max(1, toInt(params.page, 1));
  const limit = Math.min(100, Math.max(1, toInt(params.limit, 50)));
  const offset = (page - 1) * limit;
  const universe = validateUniverse(params.universe ?? null);
  const sortCol = STOCK_SORT_ALLOWLIST[params.sortBy || "rs_sts"] || STOCK_SORT_ALLOWLIST.rs_sts;
  const sortDir = params.sortDir === "asc" ? "ASC" : "DESC";

  const snapshotId = String(snap.snapshot_id);
  const tradeDate = String(snap.trade_date).split("T")[0];
  const level = validateLevel(String(grp.level));

  const whereClauses: string[] = ["m.snapshot_id = $1"];
  const sqlParams: unknown[] = [snapshotId];
  let idx = 2;

  if (level === "macro") {
    whereClauses.push(`m.macro = $${idx}`);
    sqlParams.push(grp.macro_label);
    idx++;
  } else if (level === "sector") {
    whereClauses.push(`m.macro = $${idx} AND m.sector = $${idx + 1}`);
    sqlParams.push(grp.macro_label, grp.sector_label);
    idx += 2;
  } else if (level === "industry") {
    whereClauses.push(`m.macro = $${idx} AND m.sector = $${idx + 1} AND m.industry = $${idx + 2}`);
    sqlParams.push(grp.macro_label, grp.sector_label, grp.industry_label);
    idx += 3;
  } else {
    whereClauses.push(
      `m.macro = $${idx} AND m.sector = $${idx + 1} AND m.industry = $${idx + 2} AND m.basic_industry = $${idx + 3}`
    );
    sqlParams.push(
      grp.macro_label,
      grp.sector_label,
      grp.industry_label,
      grp.basic_industry_label
    );
    idx += 4;
  }

  if (universe === "liquid") {
    whereClauses.push("m.is_liquid = TRUE");
  }
  if (params.search?.trim()) {
    whereClauses.push(`(m.symbol ILIKE $${idx} OR m.name ILIKE $${idx})`);
    sqlParams.push(`%${params.search.trim()}%`);
    idx++;
  }

  const whereSql = whereClauses.join(" AND ");

  const countRes = await q(
    `SELECT COUNT(*)::int AS total FROM latest_industry_stock_metrics m WHERE ${whereSql};`,
    sqlParams
  );
  const totalCount = toInt(countRes.rows[0]?.total);

  const dataRes = await q(
    `
    SELECT m.token, m.symbol, m.name, m.isin,
           m.macro, m.sector, m.industry, m.basic_industry,
           m.is_liquid, m.is_new_listing, m.listing_sessions,
           m.close, m.ret_1d, m.ret_1w, m.ret_1m, m.ret_3m, m.ret_6m,
           m.pct_from_52w_high, m.adr_pct,
           m.above_20ema, m.above_50dma, m.above_200dma,
           m.rs_sts, m.rs_above_ema21, m.rs_rating,
           m.avg_turnover_cr, m.mcap_cr
    FROM latest_industry_stock_metrics m
    WHERE ${whereSql}
    ORDER BY ${sortCol} ${sortDir}, m.symbol ASC
    LIMIT $${idx} OFFSET $${idx + 1};
    `,
    [...sqlParams, limit, offset]
  );

  const stocks: ConstituentStockRow[] = dataRes.rows.map((r) => ({
    token: toInt(r.token),
    symbol: String(r.symbol),
    name: String(r.name || r.symbol),
    isin: r.isin ? String(r.isin) : null,
    macro: r.macro ? String(r.macro) : null,
    sector: r.sector ? String(r.sector) : null,
    industry: r.industry ? String(r.industry) : null,
    basicIndustry: r.basic_industry ? String(r.basic_industry) : null,
    isLiquid: Boolean(r.is_liquid),
    isNewListing: Boolean(r.is_new_listing),
    listingSessions: r.listing_sessions !== null ? toInt(r.listing_sessions) : null,
    close: toFiniteNumber(r.close),
    ret1d: toFiniteNumber(r.ret_1d),
    ret1w: toFiniteNumber(r.ret_1w),
    ret1m: toFiniteNumber(r.ret_1m),
    ret3m: toFiniteNumber(r.ret_3m),
    ret6m: toFiniteNumber(r.ret_6m),
    pctFrom52wHigh: toFiniteNumber(r.pct_from_52w_high),
    adrPct: toFiniteNumber(r.adr_pct),
    above20ema: r.above_20ema === null ? null : Boolean(r.above_20ema),
    above50dma: r.above_50dma === null ? null : Boolean(r.above_50dma),
    above200dma: r.above_200dma === null ? null : Boolean(r.above_200dma),
    rsSts: toFiniteNumber(r.rs_sts),
    rsAboveEma21: r.rs_above_ema21 === null ? null : Boolean(r.rs_above_ema21),
    rsRating: r.rs_rating !== null ? toInt(r.rs_rating) : null,
    avgTurnoverCr: toFiniteNumber(r.avg_turnover_cr),
    mcapCr: toFiniteNumber(r.mcap_cr),
  }));

  return {
    snapshotId,
    snapshotDate: tradeDate,
    methodologyVersion: String(snap.methodology_version || "rs_sts_v1"),
    group: {
      groupId: String(grp.group_id),
      level,
      label: String(grp.label),
      fullPath: String(grp.full_path),
    },
    page,
    limit,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    stocks,
  };
}

export async function getGroupHistory(
  groupId: string,
  params: { period?: string | null; universe?: string | null },
  q: QueryFn = queryWithRetry
): Promise<GroupHistoryResponse | null> {
  const grpRes = await q(
    `SELECT group_id, level, label FROM industry_groups WHERE group_id = $1;`,
    [groupId]
  );
  const grp = grpRes.rows[0];
  if (!grp) return null;

  const period = validatePeriod(params.period ?? "6m");
  const universe = validateUniverse(params.universe ?? "all");

  const limitByPeriod: Record<StrengthPeriod, number> = {
    "1d": 20,
    "1w": 20,
    "1m": 30,
    "3m": 70,
    "6m": 135,
    "1y": 260,
  };
  const maxSessions = limitByPeriod[period] || 135;

  const histRes = await q(
    `
    SELECT trade_date::text AS trade_date, rs_line, rs_sts, ret_1m
    FROM (
      SELECT trade_date, rs_line, rs_sts, ret_1m
      FROM daily_industry_strength
      WHERE group_id = $1 AND universe = $2
      ORDER BY trade_date DESC
      LIMIT $3
    ) sub
    ORDER BY trade_date ASC;
    `,
    [groupId, universe, maxSessions]
  );

  const points: GroupHistoryPoint[] = histRes.rows.map((r) => ({
    date: String(r.trade_date).split("T")[0],
    rsLine: toFiniteNumber(r.rs_line),
    rsSts: toFiniteNumber(r.rs_sts),
    ret1m: toFiniteNumber(r.ret_1m),
  }));

  return {
    groupId: String(grp.group_id),
    label: String(grp.label),
    level: validateLevel(String(grp.level)),
    universe,
    period,
    benchmarkName: "NIFTY 500",
    units: {
      rsLine: "Equal-Weight Group / NIFTY 500 (Base 1.0)",
      rsSts: "26-Session Percentile Rank (0-100%)",
    },
    points,
  };
}
