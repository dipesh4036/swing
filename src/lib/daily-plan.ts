import { queryWithRetry } from "@/lib/db";
import { TopGroupRow } from "@/lib/industry-types";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface PlanMarketBlock {
  status: "available" | "unavailable";
  reason?: string;
  as_of: string | null;
  state?: "Strong" | "Mixed" | "Weak";
  pct_above_50sma?: number;
  pct_above_200sma?: number;
  net_highs_20d?: number;
  delta_50sma_5d?: number | null;
}

export interface PlanCapSegment {
  key: string;
  label: string;
  index_name: string;
  breadth_universe: string;
  ret_5d: number | null;
  ret_20d: number | null;
  pct_above_50sma: number | null;
}

export interface PlanCapsBlock {
  status: "available" | "unavailable";
  reason?: string;
  as_of: string | null;
  leader?: string;
  gap_pp?: number;
  segments?: PlanCapSegment[];
  benchmark?: PlanCapSegment | null;
}

export interface PlanBreakoutsBlock {
  status: "available" | "unavailable";
  reason?: string;
  as_of: string | null;
  counts?: Record<string, { today: number; prev_1d: number | null; prev_5d: number | null }>;
  stage2_pct?: Record<string, number | null>;
  follow_through?: { n: number; holding_count: number; pct: number | null; label: string };
}

export interface PlanTopIndustriesBlock {
  status: "available" | "unavailable";
  reason?: string;
  candidate_reason?: "ok" | "no_stock_metrics" | "no_qualifying_industry" | "none_passed_filter";
  as_of: string | null;
  level: string;
  universe: string;
  groups: TopGroupRow[];
}

export interface PlanCandidateRow {
  rank: number;
  token: number;
  symbol: string;
  industryLabel: string;
  level: string;
  rsRank: number;
  stage: number;
  screenerHits: string[];
  reasons: string[];
  close: number | null;
  ret1dPct: number | null;
  pctFrom52wHigh: number | null;
}

export interface DailyPlanResponse {
  planDate: string | null;
  availableDates: string[];
  market: PlanMarketBlock;
  caps: PlanCapsBlock;
  breakouts: PlanBreakoutsBlock;
  topIndustries: PlanTopIndustriesBlock;
  totalCandidates: number;
  nseVerifiedCount?: number;
  candidates: PlanCandidateRow[];
  summaryText: string;
  summarySource: "gemini" | "template";
  rulesVersion: string;
  generatedAt: string | null;
}

export function isValidPlanDateParam(raw: string | null): boolean {
  if (!raw) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

export async function getDailyPlan(
  dateParam: string | null = null,
  q: QueryFn = queryWithRetry
): Promise<DailyPlanResponse | null> {
  const datesRes = await q(
    `SELECT plan_date::text AS d FROM daily_plan ORDER BY plan_date DESC LIMIT 90;`
  );
  const availableDates = datesRes.rows.map((r) => String(r.d).split("T")[0]);
  if (availableDates.length === 0) {
    return null;
  }

  const targetDate = dateParam || availableDates[0];
  const planRes = await q(
    `
    SELECT plan_date::text AS plan_date, market, caps, breakouts, top_industries,
           total_candidates, summary_text, summary_source, rules_version, generated_at::text AS generated_at
    FROM daily_plan
    WHERE plan_date = $1;
    `,
    [targetDate]
  );
  const row = planRes.rows[0];
  if (!row) {
    return null;
  }

  const candRes = await q(
    `
    SELECT c.rank, c.token, c.symbol, c.industry_label, c.level, c.rs_rank, c.stage,
           c.screener_hits, c.reasons, c.close, c.ret_1d_pct, c.pct_from_52w_high,
           (i.classification_source = 'nse_quote') AS nse_verified
    FROM daily_plan_candidates c
    LEFT JOIN instruments i ON i.token = c.token
    WHERE c.plan_date = $1
    ORDER BY c.rank ASC;
    `,
    [targetDate]
  );

  const nseVerifiedCount = candRes.rows.filter((c) => Boolean(c.nse_verified)).length;

  const candidates: PlanCandidateRow[] = candRes.rows.map((c) => ({
    rank: Number(c.rank),
    token: Number(c.token),
    symbol: String(c.symbol),
    industryLabel: String(c.industry_label),
    level: String(c.level),
    rsRank: Number(c.rs_rank),
    stage: Number(c.stage),
    screenerHits: Array.isArray(c.screener_hits) ? (c.screener_hits as string[]) : [],
    reasons: Array.isArray(c.reasons) ? (c.reasons as string[]) : [],
    close: c.close !== null && c.close !== undefined ? Number(c.close) : null,
    ret1dPct: c.ret_1d_pct !== null && c.ret_1d_pct !== undefined ? Number(c.ret_1d_pct) : null,
    pctFrom52wHigh: c.pct_from_52w_high !== null && c.pct_from_52w_high !== undefined ? Number(c.pct_from_52w_high) : null,
  }));

  return {
    planDate: String(row.plan_date).split("T")[0],
    availableDates,
    market: row.market as PlanMarketBlock,
    caps: row.caps as PlanCapsBlock,
    breakouts: row.breakouts as PlanBreakoutsBlock,
    topIndustries: row.top_industries as PlanTopIndustriesBlock,
    totalCandidates: Number(row.total_candidates ?? candidates.length),
    nseVerifiedCount,
    candidates,
    summaryText: String(row.summary_text || ""),
    summarySource: row.summary_source === "gemini" ? "gemini" : "template",
    rulesVersion: String(row.rules_version || "plan_v1"),
    generatedAt: row.generated_at ? String(row.generated_at) : null,
  };
}
