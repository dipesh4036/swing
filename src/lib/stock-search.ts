import { queryWithRetry } from "@/lib/db";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export interface StockSearchResult {
  token: number;
  symbol: string;
  name: string;
  industry: string | null;
  industryRank: number | null;
  close: number | null;
  ret1dPct: number | null;
  rsRating: number | null;
}

export function parseSearchQuery(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length < 1 || trimmed.length > 30) return null;
  const sanitized = trimmed.replace(/[%_\\]/g, "").trim();
  if (sanitized.length < 1) return null;
  return sanitized;
}

export async function searchLiquidStocks(
  rawQuery: string,
  q: QueryFn = queryWithRetry
): Promise<StockSearchResult[]> {
  const clean = parseSearchQuery(rawQuery);
  if (!clean) return [];

  const upper = clean.toUpperCase();
  const prefixPattern = `${upper}%`;
  const containsPattern = `%${upper}%`;

  const res = await q(
    `
    WITH latest_snap AS (
      SELECT s.snapshot_id, s.trade_date
      FROM industry_snapshots s
      WHERE s.status = 'completed'
        AND EXISTS (SELECT 1 FROM latest_industry_stock_metrics m WHERE m.snapshot_id = s.snapshot_id)
      ORDER BY s.trade_date DESC, s.completed_at DESC
      LIMIT 1
    )
    SELECT i.token,
           i.symbol,
           i.name,
           COALESCE(m.industry, i.industry) AS industry,
           d.rank_trend AS industry_rank,
           m.close,
           m.ret_1d AS ret_1d_pct,
           m.rs_rating
    FROM instruments i
    LEFT JOIN latest_snap ls ON TRUE
    LEFT JOIN latest_industry_stock_metrics m
      ON m.token = i.token AND m.snapshot_id = ls.snapshot_id
    LEFT JOIN industry_groups g
      ON g.level = 'industry' AND g.label = COALESCE(m.industry, i.industry)
    LEFT JOIN daily_industry_strength d
      ON d.group_id = g.group_id AND d.trade_date = ls.trade_date AND d.universe = 'all'
    WHERE i.exchange = 'NSE'
      AND COALESCE(i.is_active, TRUE) = TRUE
      AND i.instrument_type = 'EQ'
      AND COALESCE(m.is_liquid, TRUE) = TRUE
      AND (UPPER(i.symbol) LIKE $1 OR UPPER(i.name) LIKE $2)
    ORDER BY
      CASE WHEN UPPER(i.symbol) LIKE $1 THEN 0 ELSE 1 END,
      LENGTH(i.symbol) ASC,
      i.symbol ASC
    LIMIT 10;
    `,
    [prefixPattern, containsPattern]
  );

  return res.rows.map((r) => ({
    token: Number(r.token),
    symbol: String(r.symbol),
    name: String(r.name || r.symbol),
    industry: r.industry ? String(r.industry) : null,
    industryRank: r.industry_rank !== null && r.industry_rank !== undefined ? Number(r.industry_rank) : null,
    close: r.close !== null && r.close !== undefined ? Number(r.close) : null,
    ret1dPct: r.ret_1d_pct !== null && r.ret_1d_pct !== undefined ? Number(r.ret_1d_pct) : null,
    rsRating: r.rs_rating !== null && r.rs_rating !== undefined ? Number(r.rs_rating) : null,
  }));
}
