"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, ShieldAlert, Clock, Database, Info, FileText } from "lucide-react";
import { BaseCard } from "@/components/ui/card";
import PageContainer from "@/components/shared/PageContainer";

interface AuditCheckRow {
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

interface FreshnessRow {
  table_name: string;
  latest_date: string | null;
  row_count: number;
  hours_since_update: number | null;
}

interface DataTrustPayload {
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

const PROVENANCE_ROWS = [
  {
    table: "stock_candles",
    source: "NSE CM Bhavcopy (daily) / Angel SmartAPI (3Y backfill)",
    fetch: "bhavcopy.py & ingest.py",
    adjusted: "Raw / unadjusted (split jumps >40% flagged downstream)",
    step: "Daily step 6",
  },
  {
    table: "daily_index_ohlcv",
    source: "NSE Index Closing Files / Angel SmartAPI",
    fetch: "indices_macro.py",
    adjusted: "Raw (price index closes)",
    step: "Daily step 2",
  },
  {
    table: "daily_market_breadth",
    source: "Derived (stock_candles + index_constituents)",
    fetch: "compute.py",
    adjusted: "Derived from raw closes",
    step: "Daily step 7",
  },
  {
    table: "instruments (classification)",
    source: "Seed CSV + NSE Quote API + manual overrides",
    fetch: "classification_fetch.py (nse_quote)",
    adjusted: "Categorical 4-level hierarchy",
    step: "Daily 20/day + D3 targeted",
  },
  {
    table: "stock_mcap",
    source: "NSE PR Bhavcopy Zip",
    fetch: "cli.py sync-mcap",
    adjusted: "Raw market cap (₹)",
    step: "Daily step 6b",
  },
  {
    table: "daily_industry_strength / top_groups",
    source: "Derived (stock_candles + instruments)",
    fetch: "industry_strength.py & industry_top_groups.py",
    adjusted: "RS break-adjusted at >40% 1D jumps",
    step: "Daily step 8 / 8b",
  },
  {
    table: "daily_screener_results",
    source: "Derived (stock_candles)",
    fetch: "screeners.py",
    adjusted: "Derived from raw OHLCV",
    step: "Daily step 7b",
  },
  {
    table: "daily_plan / daily_plan_candidates",
    source: "Derived (breadth, caps, top groups, screeners)",
    fetch: "plan.py",
    adjusted: "Deterministic rules (plan_v3 forward)",
    step: "Daily step 9",
  },
  {
    table: "plan_outcomes / plan_outcomes_control",
    source: "Derived (plan candidates + stock_candles + NIFTY 500)",
    fetch: "plan_outcomes.py",
    adjusted: "1D jumps >40% marked missing",
    step: "Daily step 9b",
  },
];

const KNOWN_LIMITS = [
  "RS-STS is a group's own relative-strength percentile over its last 26 sessions (0–100, steps of 4%), not a cross-sectional rank against other groups.",
  "Liquidity rule (plan_v3): close ≥ ₹20, 50-session average volume ≥ 25,000 shares, and 20-session median rupee turnover (close × volume) ≥ ₹5 crore.",
  "Stage 2 is our simplified definition: close > 150-day SMA and 20-day slope of 150-day SMA ≥ 1%.",
  "Backfilled Daily Plan history (backfill_v1) is an approximation without historical screener hits; live Daily Plan candidates include screener priority.",
  "Chart patterns (VCP, Double Bottom, Cup & Handle, etc.) are detected by our own rules and are not independently verified against an external pattern provider.",
];

export default function DataTrustView() {
  const [data, setData] = useState<DataTrustPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrust = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-trust");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DataTrustPayload;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Data Trust");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrust();
  }, [fetchTrust]);

  return (
    <PageContainer className="py-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text tracking-tight">Data Trust</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Stored verification checks against NSE official files, Angel SmartAPI, and independent recomputation.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchTrust}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface text-xs font-medium text-text hover:bg-hover disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <BaseCard padding="p-3" bg="bg-bearish-bg" className="text-bearish text-xs">
          {error}
        </BaseCard>
      )}

      {data && (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <BaseCard padding="p-3.5">
              <div className="text-xs text-text-secondary">Overall Audit Status</div>
              <div className="mt-1 flex items-center gap-2">
                {data.chip.status === "passing" ? (
                  <ShieldCheck className="w-4 h-4 text-bullish shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
                )}
                <span className="text-sm font-semibold text-text">{data.chip.label}</span>
              </div>
              <div className="text-xs text-text-secondary mt-1">
                {data.chip.days_since_audit !== null
                  ? `Newest run ${data.chip.days_since_audit} day(s) ago`
                  : "No stored audit runs yet"}
              </div>
            </BaseCard>

            <BaseCard padding="p-3.5">
              <div className="text-xs text-text-secondary">NSE-Verified Classification (Count)</div>
              <div className="mt-1 text-sm font-semibold text-text tabular-nums">
                {data.nse_verified.verified_count.toLocaleString("en-IN")} of{" "}
                {data.nse_verified.total_active.toLocaleString("en-IN")} ({data.nse_verified.verified_pct}%)
              </div>
              <div className="text-xs text-text-secondary mt-1">
                Active NSE EQ/BE instruments with classification_source = nse_quote
              </div>
            </BaseCard>

            <BaseCard padding="p-3.5">
              <div className="text-xs text-text-secondary">NSE-Verified Share (Market Cap)</div>
              <div className="mt-1 text-sm font-semibold text-text tabular-nums">
                {data.nse_verified.mcap_verified_pct}% of ₹
                {data.nse_verified.mcap_total_cr.toLocaleString("en-IN")} Cr
              </div>
              <div className="text-xs text-text-secondary mt-1">
                ₹{data.nse_verified.mcap_verified_cr.toLocaleString("en-IN")} Cr verified via NSE quote
              </div>
            </BaseCard>
          </div>

          {/* Audit Checks Table */}
          <BaseCard padding="p-0" className="overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Verification Checks (from data_audit)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-bg-secondary/50 text-xs uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Check</th>
                    <th className="px-3 py-2.5 text-left">Measurement</th>
                    <th className="px-3 py-2.5 text-right">Gate</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="px-3 py-2.5 text-left">Last Run</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.checks.map((chk) => {
                    const hasRun = chk.run_at !== null;
                    const isFidelity = chk.check_id === "backfill_fidelity";
                    return (
                      <tr key={chk.check_id}>
                        <td className="px-3 py-2.5 font-medium text-text">
                          <div>{chk.label}</div>
                          {isFidelity && hasRun && (
                            <div className="text-xs text-text-secondary font-normal mt-0.5">
                              Based on {data.backfill_fidelity_live_dates} live date(s)
                              {chk.detail?.rs_spearman !== undefined &&
                                ` · RS Spearman ${String(chk.detail.rs_spearman)}`}
                              {chk.detail?.jaccard !== undefined &&
                                ` · Jaccard ${String(chk.detail.jaccard)}`}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-text-secondary">
                          {!hasRun ? (
                            <span>Not run yet</span>
                          ) : (
                            <span>
                              matched {chk.matched_n ?? 0} of {chk.sample_n ?? 0} ({chk.match_pct ?? 0}%) against{" "}
                              {chk.source ?? "source"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                          {chk.gate_pct !== null ? `≥ ${chk.gate_pct}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {!hasRun ? (
                            <span className="px-2 py-0.5 rounded bg-bg-secondary border border-border text-xs text-text-secondary">
                              Not run yet
                            </span>
                          ) : chk.passed ? (
                            <span className="px-2 py-0.5 rounded bg-bullish-bg text-bullish text-xs font-medium">
                              Pass
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-bearish-bg text-bearish text-xs font-medium">
                              Fail
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-text-secondary tabular-nums whitespace-nowrap">
                          {chk.run_at ? `${chk.run_at.slice(0, 16).replace("T", " ")} (${chk.run_kind ?? "—"})` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </BaseCard>

          {/* Table Freshness */}
          <BaseCard padding="p-0" className="overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-text-secondary" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Table Freshness
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-bg-secondary/50 text-xs uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Table</th>
                    <th className="px-3 py-2 text-left">Latest Date</th>
                    <th className="px-3 py-2 text-right">Rows</th>
                    <th className="px-3 py-2 text-right">Hours Since Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.freshness.map((f) => (
                    <tr key={f.table_name}>
                      <td className="px-3 py-2 font-medium text-text">{f.table_name}</td>
                      <td className="px-3 py-2 text-text-secondary tabular-nums">{f.latest_date ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-text tabular-nums">
                        {f.row_count.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-right text-text-secondary tabular-nums">
                        {f.hours_since_update !== null ? `${f.hours_since_update}h` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BaseCard>

          {/* Data Provenance */}
          <BaseCard padding="p-0" className="overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-text-secondary" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Data Provenance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-bg-secondary/50 text-xs uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Table</th>
                    <th className="px-3 py-2 text-left">Source System</th>
                    <th className="px-3 py-2 text-left">Fetch / Build</th>
                    <th className="px-3 py-2 text-left">Adjusted / Raw</th>
                    <th className="px-3 py-2 text-left">Workflow Step</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {PROVENANCE_ROWS.map((p) => (
                    <tr key={p.table}>
                      <td className="px-3 py-2 font-medium text-text">{p.table}</td>
                      <td className="px-3 py-2 text-text-secondary">{p.source}</td>
                      <td className="px-3 py-2 text-text-secondary">{p.fetch}</td>
                      <td className="px-3 py-2 text-text-secondary">{p.adjusted}</td>
                      <td className="px-3 py-2 text-text-secondary">{p.step}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BaseCard>

          {/* Known Limits & How to Verify Yourself */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BaseCard padding="p-4" className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <Info className="w-3.5 h-3.5" />
                <span>Known Limits</span>
              </div>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-text-secondary">
                {KNOWN_LIMITS.map((lim, i) => (
                  <li key={i}>{lim}</li>
                ))}
              </ul>
            </BaseCard>

            <BaseCard padding="p-4" className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <FileText className="w-3.5 h-3.5" />
                <span>How to Verify Yourself</span>
              </div>
              <p className="text-xs text-text-secondary">
                To spot-check displayed numbers against public market sources (NSE India, Kite, TradingView):
              </p>
              <ol className="list-decimal pl-4 space-y-1.5 text-xs text-text-secondary">
                <li>Pick any stock-day from the local verification pack (<code className="text-text">probe_output/verify_pack.md</code>) and compare OHLCV against NSE Bhavcopy or TradingView daily candles.</li>
                <li>Compare the 4 index closes (NIFTY 50, 500, Midcap 150, Smallcap 250) and 20-session returns against NSE historical index data.</li>
                <li>Cross-check any Top-3 industry group&apos;s constituent list against NSE quote pages and inspect the 5 chart pattern screenshots by eye.</li>
              </ol>
            </BaseCard>
          </div>
        </>
      )}
    </PageContainer>
  );
}
