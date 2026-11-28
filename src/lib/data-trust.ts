import { queryWithRetry } from "./db.js";

export interface AuditCheckRow {
  check_id: string;
  label: string;
  run_at: string | null;
  source: string | null;
  sample_n: number | null;
  matched_n: number | null;
  match_pct: number | null;
  gate_pct: number | null;
  passed: boolean | null;
  run_kind: string | null;
  detail: Record<string, unknown> | null;
}

export interface FreshnessRow {
  table_name: string;
  latest_date: string | null;
  row_count: number;
  hours_since_update: number | null;
}

export interface DataTrustPayload {
  chip: {
    status: "passing" | "failing" | "stale" | "not_run";
    label: string;
    failing_count: number;
    days_since_audit: number | null;
  };
  checks: AuditCheckRow[];
  backfill_fidelity_live_dates: number;
  nse_verified: {
    total_active: number;
    verified_count: number;
    verified_pct: number;
    mcap_total_cr: number;
    mcap_verified_cr: number;
    mcap_verified_pct: number;
  };
  freshness: FreshnessRow[];
}

const KNOWN_CHECKS: { check_id: string; label: string; gate_pct: number }[] = [
  { check_id: "price_audit_bhavcopy", label: "Price Ingest Check (NSE Bhavcopy + Index Files)", gate_pct: 99.5 },
  { check_id: "price_audit_angel", label: "Independent Price Audit (Angel SmartAPI)", gate_pct: 99.5 },
  { check_id: "recompute_breadth", label: "Breadth Independent Recomputation", gate_pct: 100.0 },
  { check_id: "recompute_rs_stage2", label: "RS Rating & Stage 2 Recomputation", gate_pct: 99.0 },
  { check_id: "recompute_medians_top3", label: "Industry Medians & Top-3 Recomputation", gate_pct: 100.0 },
  { check_id: "recompute_cap_returns", label: "Index 5D/20D Returns Recomputation", gate_pct: 100.0 },
  { check_id: "classification_audit_nse", label: "Industry Membership (NSE Quote API)", gate_pct: 98.0 },
  { check_id: "backfill_fidelity", label: "Live vs Backfill Plan Fidelity", gate_pct: 99.5 },
];

export async function getDataTrustChip(): Promise<DataTrustPayload["chip"]> {
  const res = await queryWithRetry(`
    SELECT DISTINCT ON (check_id)
      check_id, passed, run_at::text
    FROM data_audit
    ORDER BY check_id, run_at DESC;
  `);
  if (!res.rows.length) {
    return { status: "not_run", label: "Data trust: not run", failing_count: 0, days_since_audit: null };
  }
  let failing = 0;
  let newestMs = 0;
  for (const r of res.rows) {
    if (r.passed === false) failing++;
    const ms = Date.parse(String(r.run_at));
    if (Number.isFinite(ms) && ms > newestMs) newestMs = ms;
  }
  const daysSince = newestMs > 0 ? Math.floor((Date.now() - newestMs) / 86400000) : null;
  if (failing > 0) {
    return {
      status: "failing",
      label: `Data trust: ${failing} failing`,
      failing_count: failing,
      days_since_audit: daysSince,
    };
  }
  if (daysSince !== null && daysSince > 8) {
    return {
      status: "stale",
      label: `Data trust: ${daysSince}d ago`,
      failing_count: 0,
      days_since_audit: daysSince,
    };
  }
  return {
    status: "passing",
    label: "Data trust: passing",
    failing_count: 0,
    days_since_audit: daysSince,
  };
}

export async function getDataTrustData(): Promise<DataTrustPayload> {
  const [auditRes, fidelityCountRes, verCountRes, verMcapRes, freshRes] = await Promise.all([
    queryWithRetry(`
      SELECT DISTINCT ON (check_id)
        check_id, run_at::text, source, sample_n, matched_n,
        match_pct::float, gate_pct::float, passed, detail, run_kind
      FROM data_audit
      ORDER BY check_id, run_at DESC;
    `),
    queryWithRetry(`
      SELECT COUNT(DISTINCT (detail->>'plan_date'))::int AS n
      FROM data_audit
      WHERE check_id = 'backfill_fidelity' AND detail ? 'plan_date';
    `),
    queryWithRetry(`
      SELECT
        COUNT(*)::int AS total_active,
        COUNT(*) FILTER (WHERE classification_source = 'nse_quote')::int AS verified_count
      FROM instruments
      WHERE exchange = 'NSE' AND instrument_type IN ('EQ', 'BE') AND COALESCE(is_active, TRUE) = TRUE;
    `),
    queryWithRetry(`
      WITH latest_mcap AS (
        SELECT DISTINCT ON (symbol) symbol, mcap_rs::float
        FROM stock_mcap
        WHERE mcap_rs > 0
        ORDER BY symbol, trade_date DESC
      )
      SELECT
        COALESCE(SUM(m.mcap_rs) / 1e7, 0)::float AS total_cr,
        COALESCE(SUM(m.mcap_rs) FILTER (WHERE i.classification_source = 'nse_quote') / 1e7, 0)::float AS verified_cr
      FROM instruments i
      JOIN latest_mcap m ON m.symbol = i.symbol
      WHERE i.exchange = 'NSE' AND i.instrument_type IN ('EQ', 'BE') AND COALESCE(i.is_active, TRUE) = TRUE;
    `),
    queryWithRetry(`
      SELECT 'stock_candles' AS tbl, MAX(trade_date)::text AS max_d, COUNT(*)::int AS cnt,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(trade_date)::timestamptz)) / 3600)::int AS hrs
      FROM stock_candles
      UNION ALL
      SELECT 'daily_index_ohlcv', MAX(trade_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(trade_date)::timestamptz)) / 3600)::int
      FROM daily_index_ohlcv
      UNION ALL
      SELECT 'daily_market_breadth', MAX(trade_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(trade_date)::timestamptz)) / 3600)::int
      FROM daily_market_breadth
      UNION ALL
      SELECT 'daily_industry_strength', MAX(trade_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(trade_date)::timestamptz)) / 3600)::int
      FROM daily_industry_strength
      UNION ALL
      SELECT 'industry_top_groups', MAX(snapshot_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 3600)::int
      FROM industry_top_groups
      UNION ALL
      SELECT 'daily_screener_results', MAX(trade_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(trade_date)::timestamptz)) / 3600)::int
      FROM daily_screener_results
      UNION ALL
      SELECT 'daily_plan', MAX(plan_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(generated_at))) / 3600)::int
      FROM daily_plan
      UNION ALL
      SELECT 'plan_outcomes', MAX(plan_date)::text, COUNT(*)::int,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(plan_date)::timestamptz)) / 3600)::int
      FROM plan_outcomes;
    `),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const r of auditRes.rows) {
    byId.set(String(r.check_id), r);
  }

  const checks: AuditCheckRow[] = KNOWN_CHECKS.map((k) => {
    const r = byId.get(k.check_id);
    if (!r) {
      return {
        check_id: k.check_id,
        label: k.label,
        run_at: null,
        source: null,
        sample_n: null,
        matched_n: null,
        match_pct: null,
        gate_pct: k.gate_pct,
        passed: null,
        run_kind: null,
        detail: null,
      };
    }
    return {
      check_id: k.check_id,
      label: k.label,
      run_at: r.run_at ? String(r.run_at) : null,
      source: r.source ? String(r.source) : null,
      sample_n: r.sample_n !== null ? Number(r.sample_n) : null,
      matched_n: r.matched_n !== null ? Number(r.matched_n) : null,
      match_pct: r.match_pct !== null ? Number(r.match_pct) : null,
      gate_pct: r.gate_pct !== null ? Number(r.gate_pct) : k.gate_pct,
      passed: r.passed !== null ? Boolean(r.passed) : null,
      run_kind: r.run_kind ? String(r.run_kind) : null,
      detail: (r.detail as Record<string, unknown>) || null,
    };
  });

  const chip = await getDataTrustChip();
  const vc = verCountRes.rows[0] || { total_active: 0, verified_count: 0 };
  const totalActive = Number(vc.total_active || 0);
  const verCount = Number(vc.verified_count || 0);

  const vm = verMcapRes.rows[0] || { total_cr: 0, verified_cr: 0 };
  const totalCr = Number(vm.total_cr || 0);
  const verCr = Number(vm.verified_cr || 0);

  return {
    chip,
    checks,
    backfill_fidelity_live_dates: Number(fidelityCountRes.rows[0]?.n || 0),
    nse_verified: {
      total_active: totalActive,
      verified_count: verCount,
      verified_pct: totalActive > 0 ? Number(((verCount / totalActive) * 100).toFixed(1)) : 0,
      mcap_total_cr: Number(totalCr.toFixed(0)),
      mcap_verified_cr: Number(verCr.toFixed(0)),
      mcap_verified_pct: totalCr > 0 ? Number(((verCr / totalCr) * 100).toFixed(1)) : 0,
    },
    freshness: freshRes.rows.map((r: Record<string, unknown>) => ({
      table_name: String(r.tbl),
      latest_date: r.max_d ? String(r.max_d).split("T")[0] : null,
      row_count: Number(r.cnt || 0),
      hours_since_update: r.hrs !== null ? Number(r.hrs) : null,
    })),
  };
}
