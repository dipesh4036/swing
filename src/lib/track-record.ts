import { queryWithRetry } from "./db.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export const VALID_HORIZONS = [1, 5, 10, 20] as const;
export const VALID_REFS = ["close", "open"] as const;
export const VALID_SOURCES = ["live", "all"] as const;
export const VALID_DEDUPES = ["first", "all"] as const;
export const VALID_CANDIDATE_SETS = ["filter_only", "displayed"] as const;
export const VALID_SUPERSEDED = ["0", "1"] as const;
export const DEDUPE_WINDOW_SESSIONS = 10;

export interface TrackRecordParams {
  horizon: 1 | 5 | 10 | 20;
  ref: "close" | "open";
  source: "live" | "all";
  dedupe: "first" | "all";
  candidate_set: "filter_only" | "displayed";
  include_superseded: "0" | "1";
  version: string;
}

export function parseTrackRecordParams(searchParams: URLSearchParams): {
  ok: true;
  params: TrackRecordParams;
} | {
  ok: false;
  error: string;
} {
  const hRaw = searchParams.get("horizon") ?? "5";
  const horizonNum = Number(hRaw);
  if (!Number.isInteger(horizonNum) || !VALID_HORIZONS.includes(horizonNum as 1 | 5 | 10 | 20)) {
    return { ok: false, error: `Invalid horizon '${hRaw}'. Allowed: 1, 5, 10, 20.` };
  }

  const refRaw = searchParams.get("ref") ?? "open";
  if (!VALID_REFS.includes(refRaw as "close" | "open")) {
    return { ok: false, error: `Invalid ref '${refRaw}'. Allowed: close, open.` };
  }

  const sourceRaw = searchParams.get("source") ?? "all";
  if (!VALID_SOURCES.includes(sourceRaw as "live" | "all")) {
    return { ok: false, error: `Invalid source '${sourceRaw}'. Allowed: live, all.` };
  }

  const dedupeRaw = searchParams.get("dedupe") ?? "first";
  if (!VALID_DEDUPES.includes(dedupeRaw as "first" | "all")) {
    return { ok: false, error: `Invalid dedupe '${dedupeRaw}'. Allowed: first, all.` };
  }

  const candSetRaw = searchParams.get("candidate_set") ?? "filter_only";
  if (!VALID_CANDIDATE_SETS.includes(candSetRaw as "filter_only" | "displayed")) {
    return { ok: false, error: `Invalid candidate_set '${candSetRaw}'. Allowed: filter_only, displayed.` };
  }

  const supRaw = searchParams.get("include_superseded") ?? "0";
  if (!VALID_SUPERSEDED.includes(supRaw as "0" | "1")) {
    return { ok: false, error: `Invalid include_superseded '${supRaw}'. Allowed: 0, 1.` };
  }

  const versionRaw = searchParams.get("version") ?? "plan_v2";
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(versionRaw)) {
    return { ok: false, error: "Invalid version parameter." };
  }

  return {
    ok: true,
    params: {
      horizon: horizonNum as 1 | 5 | 10 | 20,
      ref: refRaw as "close" | "open",
      source: sourceRaw as "live" | "all",
      dedupe: dedupeRaw as "first" | "all",
      candidate_set: candSetRaw as "filter_only" | "displayed",
      include_superseded: supRaw as "0" | "1",
      version: versionRaw,
    },
  };
}

export interface OutcomeRow {
  plan_date: string;
  token: number;
  symbol: string;
  industry_label: string;
  source: "live" | "backfill";
  horizon: number;
  ret_from_close_pct: number | null;
  ret_from_open_pct: number | null;
  bench_ret_from_close_pct: number | null;
  bench_ret_from_open_pct: number | null;
  excess_from_close_pct: number | null;
  excess_from_open_pct: number | null;
  status: "matured" | "missing";
  missing_reason: string | null;
}

export interface GroupSummaryStats {
  key: "candidates" | "control" | "control_top_any" | "all_liquid" | "cap_nifty100" | "cap_midcap150" | "cap_smallcap250" | "cap_outside";
  label: string;
  n_rows: number;
  n_unique_stocks: number;
  n_missing: number;
  n_beat_bench: number;
  pct_beat_bench: number | null;
  median_ret: number | null;
  median_bench_ret: number | null;
  median_excess: number | null;
  p25_excess: number | null;
  p75_excess: number | null;
  worst_excess: number | null;
  best_excess: number | null;
  first_plan_date: string | null;
  last_plan_date: string | null;
  live_share: number | null;
  starts_at?: string | null;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return Number(sorted[lo].toFixed(2));
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  return Number(val.toFixed(2));
}

export function dedupeFirstInWindow<T extends { plan_date: string; token: number }>(
  rows: T[],
  tradingDayIdx: Map<string, number>,
  windowSessions: number = DEDUPE_WINDOW_SESSIONS
): T[] {
  const ordered = [...rows].sort((a, b) =>
    a.plan_date < b.plan_date ? -1 : a.plan_date > b.plan_date ? 1 : a.token - b.token
  );
  const lastIdxByToken = new Map<number, number>();
  const out: T[] = [];
  let fallbackCounter = 0;

  for (const r of ordered) {
    const idx = tradingDayIdx.get(r.plan_date) ?? fallbackCounter++;
    const prevIdx = lastIdxByToken.get(r.token);
    if (prevIdx !== undefined && idx - prevIdx < windowSessions) {
      continue;
    }
    lastIdxByToken.set(r.token, idx);
    out.push(r);
  }
  return out;
}

export function summarizeGroup(
  key: GroupSummaryStats["key"],
  label: string,
  rows: OutcomeRow[],
  ref: "close" | "open",
  startsAt?: string | null
): GroupSummaryStats {
  const matured = rows.filter((r) => r.status === "matured");
  const missing = rows.filter((r) => r.status === "missing");

  const rets: number[] = [];
  const benchRets: number[] = [];
  const excesses: number[] = [];
  const uniq = new Set<number>();
  let beatCount = 0;
  let liveCount = 0;

  for (const r of matured) {
    const rv = ref === "open" ? r.ret_from_open_pct : r.ret_from_close_pct;
    const bv = ref === "open" ? r.bench_ret_from_open_pct : r.bench_ret_from_close_pct;
    const ev = ref === "open" ? r.excess_from_open_pct : r.excess_from_close_pct;
    if (rv === null || bv === null || ev === null) continue;
    rets.push(rv);
    benchRets.push(bv);
    excesses.push(ev);
    uniq.add(r.token);
    if (ev > 0) beatCount++;
    if (r.source === "live") liveCount++;
  }

  rets.sort((a, b) => a - b);
  benchRets.sort((a, b) => a - b);
  excesses.sort((a, b) => a - b);

  const n = excesses.length;
  const dates = matured.map((r) => r.plan_date).sort();

  return {
    key,
    label,
    n_rows: n,
    n_unique_stocks: uniq.size,
    n_missing: missing.length,
    n_beat_bench: beatCount,
    pct_beat_bench: n > 0 ? Number(((beatCount / n) * 100).toFixed(1)) : null,
    median_ret: percentile(rets, 0.5),
    median_bench_ret: percentile(benchRets, 0.5),
    median_excess: percentile(excesses, 0.5),
    p25_excess: percentile(excesses, 0.25),
    p75_excess: percentile(excesses, 0.75),
    worst_excess: n > 0 ? Number(excesses[0].toFixed(2)) : null,
    best_excess: n > 0 ? Number(excesses[n - 1].toFixed(2)) : null,
    first_plan_date: dates[0] ?? null,
    last_plan_date: dates[dates.length - 1] ?? null,
    live_share: n > 0 ? Number(((liveCount / n) * 100).toFixed(1)) : null,
    ...(startsAt !== undefined ? { starts_at: startsAt } : {}),
  };
}

export const HISTOGRAM_BINS = [
  { label: "< -10%", min: -Infinity, max: -10 },
  { label: "-10 to -5%", min: -10, max: -5 },
  { label: "-5 to -2%", min: -5, max: -2 },
  { label: "-2 to 0%", min: -2, max: 0 },
  { label: "0 to +2%", min: 0, max: 2 },
  { label: "+2 to +5%", min: 2, max: 5 },
  { label: "+5 to +10%", min: 5, max: 10 },
  { label: "> +10%", min: 10, max: Infinity },
] as const;

export function buildExcessHistogram(candExcesses: number[], baseExcesses: number[]) {
  return HISTOGRAM_BINS.map((b) => {
    const inBin = (v: number) =>
      b.min === -Infinity ? v < b.max : b.max === Infinity ? v >= b.min : v >= b.min && v < b.max;
    return {
      label: b.label,
      candidates: candExcesses.filter(inBin).length,
      baseline: baseExcesses.filter(inBin).length,
    };
  });
}

export async function getTrackRecordData(
  params: TrackRecordParams,
  q: QueryFn = queryWithRetry
) {
  const { horizon, ref, source, dedupe, candidate_set, include_superseded, version } = params;

  const [tdRes, covRes, candRes, ctrlRes, ctrlStartRes, recentPlansRes, capRes] = await Promise.all([
    q(`SELECT trade_date::text AS d FROM trading_days ORDER BY trade_date ASC;`),
    q(
      `
      SELECT
        COUNT(DISTINCT plan_date) AS plan_dates,
        COUNT(*) FILTER (WHERE source = 'live' AND status = 'matured') AS live_rows,
        COUNT(*) FILTER (WHERE source = 'backfill' AND status = 'matured') AS backfill_rows,
        COUNT(*) FILTER (WHERE horizon = 1 AND status = 'matured') AS h1,
        COUNT(*) FILTER (WHERE horizon = 5 AND status = 'matured') AS h5,
        COUNT(*) FILTER (WHERE horizon = 10 AND status = 'matured') AS h10,
        COUNT(*) FILTER (WHERE horizon = 20 AND status = 'matured') AS h20,
        MAX(fwd_date)::text AS max_fwd_date
      FROM plan_outcomes
      WHERE rules_version = $1
        AND candidate_set = $2
        AND ($3 = '1' OR COALESCE(method, '') <> 'backfill_v0');
      `,
      [version, candidate_set, include_superseded]
    ),
    q(
      `
      SELECT plan_date::text, token, symbol, industry_label, source, horizon,
             ret_from_close_pct::float, ret_from_open_pct::float,
             bench_ret_from_close_pct::float, bench_ret_from_open_pct::float,
             excess_from_close_pct::float, excess_from_open_pct::float,
             status, missing_reason
      FROM plan_outcomes
      WHERE rules_version = $1
        AND horizon = $2
        AND ($3 = 'all' OR source = $3)
        AND candidate_set = $4
        AND ($5 = '1' OR COALESCE(method, '') <> 'backfill_v0')
      ORDER BY plan_date ASC, token ASC;
      `,
      [version, horizon, source, candidate_set, include_superseded]
    ),
    q(
      `
      SELECT plan_date::text, token, symbol, industry_label, source, horizon, group_name,
             ret_from_close_pct::float, ret_from_open_pct::float,
             bench_ret_from_close_pct::float, bench_ret_from_open_pct::float,
             excess_from_close_pct::float, excess_from_open_pct::float,
             status, missing_reason
      FROM plan_outcomes_control
      WHERE rules_version = $1
        AND horizon = $2
        AND ($3 = 'all' OR source = $3)
        AND ($4 = '1' OR COALESCE(method, '') <> 'backfill_v0')
      ORDER BY plan_date ASC, token ASC;
      `,
      [version, horizon, source, include_superseded]
    ),
    q(`SELECT MIN(plan_date)::text AS d FROM plan_control;`),
    q(
      `
      WITH recent_dates AS (
        SELECT DISTINCT plan_date
        FROM plan_outcomes
        WHERE rules_version = $1
          AND candidate_set = $2
          AND ($3 = '1' OR COALESCE(method, '') <> 'backfill_v0')
        ORDER BY plan_date DESC
        LIMIT 30
      )
      SELECT o.plan_date::text, o.token, o.symbol, o.industry_label, o.horizon,
             o.ret_from_close_pct::float, o.ret_from_open_pct::float,
             o.status, o.missing_reason, c.rank
      FROM plan_outcomes o
      JOIN recent_dates rd ON rd.plan_date = o.plan_date
      LEFT JOIN daily_plan_candidates c ON c.plan_date = o.plan_date AND c.token = o.token
      WHERE o.rules_version = $1
        AND o.candidate_set = $2
        AND ($3 = '1' OR COALESCE(o.method, '') <> 'backfill_v0')
      ORDER BY o.plan_date DESC, COALESCE(c.rank, 999) ASC, o.symbol ASC, o.horizon ASC;
      `,
      [version, candidate_set, include_superseded]
    ),
    q(
      `
      SELECT symbol, index_name
      FROM index_constituents
      WHERE index_name IN ('nifty100', 'nifty_midcap150', 'nifty_smallcap250')
        AND COALESCE(is_active, TRUE) = TRUE;
      `
    ),
  ]);

  const tradingDays = tdRes.rows.map((r) => String(r.d).split("T")[0]);
  const tdIdx = new Map<string, number>();
  tradingDays.forEach((d, idx) => tdIdx.set(d, idx));

  const mapOutcomeRow = (r: Record<string, unknown>): OutcomeRow => ({
    plan_date: String(r.plan_date).split("T")[0],
    token: Number(r.token),
    symbol: String(r.symbol),
    industry_label: String(r.industry_label),
    source: (r.source === "live" ? "live" : "backfill") as "live" | "backfill",
    horizon: Number(r.horizon),
    ret_from_close_pct: r.ret_from_close_pct !== null ? Number(r.ret_from_close_pct) : null,
    ret_from_open_pct: r.ret_from_open_pct !== null ? Number(r.ret_from_open_pct) : null,
    bench_ret_from_close_pct: r.bench_ret_from_close_pct !== null ? Number(r.bench_ret_from_close_pct) : null,
    bench_ret_from_open_pct: r.bench_ret_from_open_pct !== null ? Number(r.bench_ret_from_open_pct) : null,
    excess_from_close_pct: r.excess_from_close_pct !== null ? Number(r.excess_from_close_pct) : null,
    excess_from_open_pct: r.excess_from_open_pct !== null ? Number(r.excess_from_open_pct) : null,
    status: (r.status === "missing" ? "missing" : "matured") as "matured" | "missing",
    missing_reason: r.missing_reason ? String(r.missing_reason) : null,
  });

  const rawCand = candRes.rows.map(mapOutcomeRow);
  const rawCtrlSame = ctrlRes.rows
    .filter((r) => !r.group_name || r.group_name === "same_filter_any_industry")
    .map(mapOutcomeRow);
  const rawCtrlTopAny = ctrlRes.rows
    .filter((r) => r.group_name === "top_industries_any_stock")
    .map(mapOutcomeRow);

  const candFiltered = dedupe === "first" ? dedupeFirstInWindow(rawCand, tdIdx) : rawCand;
  const ctrlSameFiltered = dedupe === "first" ? dedupeFirstInWindow(rawCtrlSame, tdIdx) : rawCtrlSame;
  const ctrlTopAnyFiltered = dedupe === "first" ? dedupeFirstInWindow(rawCtrlTopAny, tdIdx) : rawCtrlTopAny;

  const candSummary = summarizeGroup("candidates", "Plan candidates", candFiltered, ref);
  const ctrlStartDate = ctrlStartRes.rows[0]?.d ? String(ctrlStartRes.rows[0].d).split("T")[0] : null;
  const ctrlSummary = summarizeGroup("control", "Same filter, any industry", ctrlSameFiltered, ref, ctrlStartDate);
  const ctrlTopAnySummary = summarizeGroup(
    "control_top_any",
    "Top industries, any liquid stock",
    ctrlTopAnyFiltered,
    ref,
    ctrlStartDate
  );

  // Cap-segment breakdown for Plan candidates (Nifty 100 / Midcap 150 / Smallcap 250 / Outside Nifty 500)
  const capPriority: Record<string, number> = {
    nifty100: 1,
    nifty_midcap150: 2,
    nifty_smallcap250: 3,
  };
  const capBySymbol = new Map<string, string>();
  for (const r of capRes.rows) {
    const sym = String(r.symbol || "");
    const idxName = String(r.index_name || "");
    const prev = capBySymbol.get(sym);
    if (!prev || (capPriority[idxName] ?? 99) < (capPriority[prev] ?? 99)) {
      capBySymbol.set(sym, idxName);
    }
  }
  const candByCap: Record<"nifty100" | "nifty_midcap150" | "nifty_smallcap250" | "outside", OutcomeRow[]> = {
    nifty100: [],
    nifty_midcap150: [],
    nifty_smallcap250: [],
    outside: [],
  };
  for (const r of candFiltered) {
    const seg = capBySymbol.get(r.symbol);
    if (seg === "nifty100" || seg === "nifty_midcap150" || seg === "nifty_smallcap250") {
      candByCap[seg].push(r);
    } else {
      candByCap.outside.push(r);
    }
  }
  const capSegments = [
    summarizeGroup("cap_nifty100", "Nifty 100", candByCap.nifty100, ref),
    summarizeGroup("cap_midcap150", "Midcap 150", candByCap.nifty_midcap150, ref),
    summarizeGroup("cap_smallcap250", "Smallcap 250", candByCap.nifty_smallcap250, ref),
    summarizeGroup("cap_outside", "Outside Nifty 500", candByCap.outside, ref),
  ];

  // All-liquid baseline over the exact same matured plan_dates
  const maturedDates = Array.from(
    new Set(candFiltered.filter((r) => r.status === "matured").map((r) => r.plan_date))
  ).sort();

  const baseExcesses: number[] = [];
  const baseRets: number[] = [];
  const baseBenchRets: number[] = [];
  let baseBeat = 0;

  if (maturedDates.length > 0) {
    // Compute per-plan-date window median return across all traded NSE EQ stocks from stock_candles
    const windowPairs: Array<{ d: string; dNext: string; dFwd: string }> = [];
    for (const d of maturedDates) {
      const idx = tdIdx.get(d);
      if (idx === undefined || idx + horizon >= tradingDays.length) continue;
      windowPairs.push({ d, dNext: tradingDays[idx + 1], dFwd: tradingDays[idx + horizon] });
    }

    if (windowPairs.length > 0) {
      const allDatesNeeded = Array.from(
        new Set(windowPairs.flatMap((w) => [w.d, w.dNext, w.dFwd]))
      );
      const [scRes, idxRes] = await Promise.all([
        q(
          `
          SELECT c.token, c.trade_date::text AS td, c.open::float, c.close::float
          FROM stock_candles c
          JOIN instruments i ON i.token = c.token
          WHERE i.exchange = 'NSE' AND i.instrument_type = 'EQ' AND COALESCE(i.is_active, TRUE) = TRUE
            AND c.trade_date = ANY($1::date[]);
          `,
          [allDatesNeeded]
        ),
        q(
          `
          SELECT trade_date::text AS td, open::float, close::float
          FROM daily_index_ohlcv
          WHERE index_name = 'NIFTY 500' AND trade_date = ANY($1::date[]);
          `,
          [allDatesNeeded]
        ),
      ]);

      const scMap = new Map<string, Map<number, { open: number | null; close: number | null }>>();
      for (const r of scRes.rows) {
        const td = String(r.td).split("T")[0];
        if (!scMap.has(td)) scMap.set(td, new Map());
        scMap.get(td)!.set(Number(r.token), {
          open: r.open !== null ? Number(r.open) : null,
          close: r.close !== null ? Number(r.close) : null,
        });
      }

      const benchMap = new Map<string, { open: number | null; close: number | null }>();
      for (const r of idxRes.rows) {
        benchMap.set(String(r.td).split("T")[0], {
          open: r.open !== null ? Number(r.open) : null,
          close: r.close !== null ? Number(r.close) : null,
        });
      }

      for (const w of windowPairs) {
        const mBase = scMap.get(w.d);
        const mNext = scMap.get(w.dNext);
        const mFwd = scMap.get(w.dFwd);
        const bBase = benchMap.get(w.d);
        const bNext = benchMap.get(w.dNext);
        const bFwd = benchMap.get(w.dFwd);
        if (!mBase || !mNext || !mFwd || !bBase || !bNext || !bFwd) continue;

        const bRef = ref === "open" ? (bNext.open && bNext.open > 0 ? bNext.open : bNext.close) : bBase.close;
        const bEnd = bFwd.close;
        if (!bRef || bRef <= 0 || !bEnd || bEnd <= 0) continue;
        const bRet = (bEnd / bRef - 1) * 100;

        const winRets: number[] = [];
        const winExc: number[] = [];
        for (const [tok, rowBase] of mBase.entries()) {
          const rowNext = mNext.get(tok);
          const rowFwd = mFwd.get(tok);
          if (!rowNext || !rowFwd) continue;
          const basePx = ref === "open" ? rowNext.open : rowBase.close;
          const fwdPx = rowFwd.close;
          if (!basePx || basePx <= 0 || !fwdPx || fwdPx <= 0) continue;
          const rPct = (fwdPx / basePx - 1) * 100;
          if (Math.abs(rPct) > 200) continue; // guard extreme unadjusted outliers
          winRets.push(rPct);
          winExc.push(rPct - bRet);
        }
        winRets.sort((a, b) => a - b);
        winExc.sort((a, b) => a - b);
        const medR = percentile(winRets, 0.5);
        const medE = percentile(winExc, 0.5);
        if (medR !== null && medE !== null) {
          baseRets.push(medR);
          baseBenchRets.push(Number(bRet.toFixed(2)));
          baseExcesses.push(medE);
          if (medE > 0) baseBeat++;
        }
      }
    }
  }

  baseRets.sort((a, b) => a - b);
  baseBenchRets.sort((a, b) => a - b);
  baseExcesses.sort((a, b) => a - b);

  const allLiquidSummary: GroupSummaryStats = {
    key: "all_liquid",
    label: "All liquid stocks",
    n_rows: baseExcesses.length,
    n_unique_stocks: baseExcesses.length,
    n_missing: 0,
    n_beat_bench: baseBeat,
    pct_beat_bench: baseExcesses.length > 0 ? Number(((baseBeat / baseExcesses.length) * 100).toFixed(1)) : null,
    median_ret: percentile(baseRets, 0.5),
    median_bench_ret: percentile(baseBenchRets, 0.5),
    median_excess: percentile(baseExcesses, 0.5),
    p25_excess: percentile(baseExcesses, 0.25),
    p75_excess: percentile(baseExcesses, 0.75),
    worst_excess: baseExcesses.length > 0 ? Number(baseExcesses[0].toFixed(2)) : null,
    best_excess: baseExcesses.length > 0 ? Number(baseExcesses[baseExcesses.length - 1].toFixed(2)) : null,
    first_plan_date: maturedDates[0] ?? null,
    last_plan_date: maturedDates[maturedDates.length - 1] ?? null,
    live_share: null,
  };

  const candExcesses = candFiltered
    .filter((r) => r.status === "matured")
    .map((r) => (ref === "open" ? r.excess_from_open_pct : r.excess_from_close_pct))
    .filter((v): v is number => v !== null);

  const distribution = buildExcessHistogram(candExcesses, baseExcesses);

  // Recent 30 plan dates expandable table
  const planDateMap = new Map<
    string,
    Map<number, { token: number; symbol: string; industryLabel: string; rank: number | null; horizons: Record<number, { ret: number | null; status: string }> }>
  >();

  for (const r of recentPlansRes.rows) {
    const pd = String(r.plan_date).split("T")[0];
    const tok = Number(r.token);
    const h = Number(r.horizon);
    if (!planDateMap.has(pd)) planDateMap.set(pd, new Map());
    const tokMap = planDateMap.get(pd)!;
    if (!tokMap.has(tok)) {
      tokMap.set(tok, {
        token: tok,
        symbol: String(r.symbol),
        industryLabel: String(r.industry_label),
        rank: r.rank !== null && r.rank !== undefined ? Number(r.rank) : null,
        horizons: {},
      });
    }
    const retVal = ref === "open" ? r.ret_from_open_pct : r.ret_from_close_pct;
    tokMap.get(tok)!.horizons[h] = {
      ret: retVal !== null && retVal !== undefined ? Number(retVal) : null,
      status: String(r.status),
    };
  }

  const recentPlans = Array.from(planDateMap.entries()).map(([planDate, tokMap]) => ({
    planDate,
    candidates: Array.from(tokMap.values()),
  }));

  const cov = covRes.rows[0] || {};
  const dataFreshnessDate = cov.max_fwd_date
    ? String(cov.max_fwd_date).split("T")[0]
    : tradingDays[tradingDays.length - 1] ?? null;

  const allDates = Array.from(new Set(candFiltered.map((r) => r.plan_date))).sort();
  const firstPlanDate = allDates[0] ?? null;
  const lastPlanDate = allDates[allDates.length - 1] ?? null;
  let nifty500PeriodRetPct: number | null = null;
  if (firstPlanDate && lastPlanDate && firstPlanDate !== lastPlanDate) {
    const periodRes = await q(
      `
      SELECT trade_date::text AS td, close::float
      FROM daily_index_ohlcv
      WHERE index_name = 'NIFTY 500' AND trade_date IN ($1::date, $2::date)
      ORDER BY trade_date ASC;
      `,
      [firstPlanDate, lastPlanDate]
    );
    if (periodRes.rows.length >= 2) {
      const c0 = Number(periodRes.rows[0].close);
      const c1 = Number(periodRes.rows[periodRes.rows.length - 1].close);
      if (c0 > 0 && c1 > 0) {
        nifty500PeriodRetPct = Number((((c1 / c0) - 1) * 100).toFixed(2));
      }
    }
  }

  return {
    params,
    asOf: tradingDays[tradingDays.length - 1] ?? null,
    dataFreshnessDate,
    coverage: {
      planDatesCovered: Number(cov.plan_dates || 0),
      liveRows: Number(cov.live_rows || 0),
      backfillRows: Number(cov.backfill_rows || 0),
      rulesVersion: version,
      controlStartsDate: ctrlStartDate,
      maturedByHorizon: {
        1: Number(cov.h1 || 0),
        5: Number(cov.h5 || 0),
        10: Number(cov.h10 || 0),
        20: Number(cov.h20 || 0),
      },
    },
    summaries: [candSummary, ctrlSummary, ctrlTopAnySummary, allLiquidSummary],
    context: {
      planDatesCount: allDates.length,
      firstDate: firstPlanDate,
      lastDate: lastPlanDate,
      nifty500PeriodRetPct,
      capSegments,
    },
    distribution,
    recentPlans,
  };
}
