"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageContainer from "@/components/shared/PageContainer";
import { BaseCard } from "@/components/ui/card";
import { SignedReturn } from "@/components/industry-strength/RankPrimitives";

interface GroupSummary {
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

interface DistBin {
  label: string;
  candidates: number;
  baseline: number;
}

interface RecentPlanCandidate {
  token: number;
  symbol: string;
  industryLabel: string;
  rank: number | null;
  horizons: Record<number, { ret: number | null; status: string }>;
}

interface RecentPlanRow {
  planDate: string;
  candidates: RecentPlanCandidate[];
}

interface TrackRecordPayload {
  params: {
    horizon: 1 | 5 | 10 | 20;
    ref: "close" | "open";
    source: "live" | "all";
    dedupe: "first" | "all";
    candidate_set: "filter_only" | "displayed";
    include_superseded: "0" | "1";
    version: string;
  };
  asOf: string | null;
  dataFreshnessDate: string | null;
  coverage: {
    planDatesCovered: number;
    liveRows: number;
    backfillRows: number;
    rulesVersion: string;
    controlStartsDate: string | null;
    maturedByHorizon: Record<string, number>;
  };
  summaries: GroupSummary[];
  context?: {
    planDatesCount: number;
    firstDate: string | null;
    lastDate: string | null;
    nifty500PeriodRetPct: number | null;
    capSegments: GroupSummary[];
  };
  distribution: DistBin[];
  recentPlans: RecentPlanRow[];
}

function fmtSigned(v: number | null, suffix = "%"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
}

export default function TrackRecordView() {
  const [horizon, setHorizon] = useState<1 | 5 | 10 | 20>(5);
  const [refPrice, setRefPrice] = useState<"open" | "close">("open");
  const [liveOnly, setLiveOnly] = useState(false);
  const [firstOnly, setFirstOnly] = useState(true);
  const [candidateSet, setCandidateSet] = useState<"filter_only" | "displayed">("filter_only");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

  const [data, setData] = useState<TrackRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const fetchTrackRecord = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        horizon: String(horizon),
        ref: refPrice,
        source: liveOnly ? "live" : "all",
        dedupe: firstOnly ? "first" : "all",
        candidate_set: candidateSet,
        include_superseded: includeSuperseded ? "1" : "0",
      });
      const res = await fetch(`/api/track-record?${qs.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as TrackRecordPayload;
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Track Record");
    } finally {
      setLoading(false);
    }
  }, [horizon, refPrice, liveOnly, firstOnly, candidateSet, includeSuperseded]);

  useEffect(() => {
    fetchTrackRecord();
  }, [fetchTrackRecord]);

  const candSummary = data?.summaries.find((s) => s.key === "candidates");
  const medianExcess = candSummary?.median_excess ?? null;

  return (
    <PageContainer className="py-4 sm:py-6 space-y-4">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold text-text">
              Track record of the Daily Plan
            </h1>
            {data?.asOf && (
              <span className="text-xs text-text-secondary tabular-nums">
                As of {data.asOf}
              </span>
            )}
          </div>
          {data && (
            <p className="text-xs text-text-secondary tabular-nums">
              {data.coverage.planDatesCovered} plan dates · Live {data.coverage.liveRows} / Backfill{" "}
              {data.coverage.backfillRows} · Rules {data.coverage.rulesVersion} · Matured rows: 1D{" "}
              {data.coverage.maturedByHorizon["1"] ?? 0} · 5D {data.coverage.maturedByHorizon["5"] ?? 0} · 10D{" "}
              {data.coverage.maturedByHorizon["10"] ?? 0} · 20D {data.coverage.maturedByHorizon["20"] ?? 0}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={fetchTrackRecord}
          aria-label="Refresh track record"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface text-xs font-medium text-text-secondary hover:text-text cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* 2. Sticky Controls */}
      <div className="sticky top-0 z-20 py-2 bg-bg-page/95 backdrop-blur-xs border-y border-border overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 min-w-max">
          <div className="flex items-center gap-1" role="group" aria-label="Horizon sessions">
            {([1, 5, 10, 20] as const).map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={horizon === h}
                onClick={() => setHorizon(h)}
                className={`h-7 px-2.5 rounded-md border text-xs font-medium tabular-nums cursor-pointer ${
                  horizon === h
                    ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                    : "bg-surface border-border text-text-secondary hover:text-text"
                }`}
              >
                {h}D
              </button>
            ))}
          </div>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <div className="flex items-center gap-1" role="group" aria-label="Reference price">
            <button
              type="button"
              aria-pressed={refPrice === "open"}
              onClick={() => setRefPrice("open")}
              className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
                refPrice === "open"
                  ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              From next open
            </button>
            <button
              type="button"
              aria-pressed={refPrice === "close"}
              onClick={() => setRefPrice("close")}
              className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
                refPrice === "close"
                  ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              From plan-date close
            </button>
          </div>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <button
            type="button"
            aria-pressed={liveOnly}
            onClick={() => setLiveOnly((v) => !v)}
            className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
              liveOnly
                ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
          >
            Live only
          </button>

          <button
            type="button"
            aria-pressed={firstOnly}
            onClick={() => setFirstOnly((v) => !v)}
            className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
              firstOnly
                ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
          >
            First appearance only
          </button>

          <span className="h-4 w-px bg-border" aria-hidden="true" />

          <div className="flex items-center gap-1" role="group" aria-label="Candidate set">
            <button
              type="button"
              aria-pressed={candidateSet === "filter_only"}
              onClick={() => setCandidateSet("filter_only")}
              className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
                candidateSet === "filter_only"
                  ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              Filter only
            </button>
            <button
              type="button"
              aria-pressed={candidateSet === "displayed"}
              onClick={() => setCandidateSet("displayed")}
              className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
                candidateSet === "displayed"
                  ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                  : "bg-surface border-border text-text-secondary hover:text-text"
              }`}
            >
              Displayed (live)
            </button>
          </div>

          <button
            type="button"
            aria-pressed={includeSuperseded}
            onClick={() => setIncludeSuperseded((v) => !v)}
            className={`h-7 px-2.5 rounded-md border text-xs font-medium cursor-pointer ${
              includeSuperseded
                ? "bg-primary-subtle border-accent-border text-primary dark:text-indigo-300 font-semibold"
                : "bg-surface border-border text-text-secondary hover:text-text"
            }`}
          >
            Include superseded backfill
          </button>
        </div>
      </div>

      {error && (
        <BaseCard padding="p-4" className="border-bearish-border flex items-center justify-between gap-3">
          <span className="text-xs text-bearish">{error}</span>
          <button
            type="button"
            onClick={fetchTrackRecord}
            className="px-3 py-1 rounded border border-border bg-surface text-xs font-medium text-text cursor-pointer"
          >
            Retry
          </button>
        </BaseCard>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <div className="h-36 rounded-xl border border-border bg-bg-secondary" />
          <div className="h-56 rounded-xl border border-border bg-bg-secondary" />
        </div>
      )}

      {data && (
        <>
          {/* 3. Summary Table */}
          <BaseCard padding="p-0" className="overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Summary ({horizon} trading sessions · {refPrice === "open" ? "from next open" : "from plan-date close"})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-bg-secondary/50 text-xs uppercase tracking-wider text-text-secondary">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Group</th>
                    <th className="px-3 py-2.5 text-right">n (rows)</th>
                    <th className="px-3 py-2.5 text-right">Unique</th>
                    <th className="px-3 py-2.5 text-right">Above NIFTY 500</th>
                    <th className="px-3 py-2.5 text-right">Median Return</th>
                    <th className="px-3 py-2.5 text-right">Median Excess</th>
                    <th className="px-3 py-2.5 text-right">Middle Range (25th–75th)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.summaries.map((row) => {
                    const smallSample = row.n_rows < 30;
                    const valCls = smallSample ? "text-text-secondary" : "text-text";
                    return (
                      <tr key={row.key}>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold text-text">{row.label}</span>
                            {row.key === "all_liquid" && (
                              <span className="px-2 py-0.5 rounded bg-bg-secondary border border-border text-xs text-text-secondary">
                                per plan-date median
                              </span>
                            )}
                            {(row.key === "control" || row.key === "control_top_any") && row.n_rows === 0 && (
                              <span className="px-2 py-0.5 rounded bg-bg-secondary border border-border text-xs text-text-secondary">
                                {row.starts_at ? `starts ${row.starts_at}` : "starts from next live run"}
                              </span>
                            )}
                            {smallSample && row.n_rows > 0 && (
                              <span className="px-2 py-0.5 rounded bg-warning-bg text-warning text-xs font-medium">
                                Too few to judge (n={row.n_rows})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] ${valCls}`}>
                          {row.n_rows}
                          {row.n_missing > 0 ? ` (${row.n_missing} missing)` : ""}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] ${valCls}`}>
                          {row.n_unique_stocks}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] ${valCls}`}>
                          {row.n_rows > 0
                            ? `${row.n_beat_bench} of ${row.n_rows} (${row.pct_beat_bench?.toFixed(1) ?? "0.0"}%)`
                            : "—"}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] font-medium ${valCls}`}>
                          {fmtSigned(row.median_ret)}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] font-medium ${valCls}`}>
                          {fmtSigned(row.median_excess)}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums text-[13px] ${valCls}`}>
                          {row.p25_excess !== null && row.p75_excess !== null
                            ? `${fmtSigned(row.p25_excess)} to ${fmtSigned(row.p75_excess)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </BaseCard>

          {/* 3b. Context & Cap-Segment Breakdown */}
          {data.context && (
            <BaseCard padding="p-0" className="overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Context
                </h2>
                <span className="text-xs text-text-secondary tabular-nums">
                  {data.context.planDatesCount} plan dates
                  {data.context.firstDate && data.context.lastDate
                    ? ` (${data.context.firstDate} to ${data.context.lastDate})`
                    : ""}
                  {data.context.nifty500PeriodRetPct !== null
                    ? ` · NIFTY 500 period return: ${fmtSigned(data.context.nifty500PeriodRetPct)}`
                    : ""}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-border bg-bg-secondary/50 text-xs uppercase tracking-wider text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">Cap Segment (Plan candidates)</th>
                      <th className="px-3 py-2 text-right">n (rows)</th>
                      <th className="px-3 py-2 text-right">Unique</th>
                      <th className="px-3 py-2 text-right">Above NIFTY 500</th>
                      <th className="px-3 py-2 text-right">Median Return</th>
                      <th className="px-3 py-2 text-right">Median Excess</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {data.context.capSegments.map((seg) => {
                      const smallSample = seg.n_rows < 30;
                      const valCls = smallSample ? "text-text-secondary" : "text-text";
                      return (
                        <tr key={seg.key}>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-text">{seg.label}</span>
                              {smallSample && (
                                <span className="px-2 py-0.5 rounded bg-warning-bg text-warning text-xs font-medium">
                                  Too few to judge (n={seg.n_rows})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums text-[13px] ${valCls}`}>
                            {seg.n_rows}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums text-[13px] ${valCls}`}>
                            {seg.n_unique_stocks}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums text-[13px] ${valCls}`}>
                            {seg.n_rows > 0
                              ? `${seg.n_beat_bench} of ${seg.n_rows} (${seg.pct_beat_bench?.toFixed(1) ?? "0.0"}%)`
                              : "—"}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums text-[13px] font-medium ${valCls}`}>
                            {fmtSigned(seg.median_ret)}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums text-[13px] font-medium ${valCls}`}>
                            {fmtSigned(seg.median_excess)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </BaseCard>
          )}

          {/* 4. Distribution Chart */}
          <BaseCard padding="p-3.5" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Excess Return Distribution vs NIFTY 500 ({horizon}D, count per bin)
              </h2>
              {medianExcess !== null && (
                <span className="text-xs text-text-secondary tabular-nums">
                  Zero reference: 0.00% · Candidate median excess: {fmtSigned(medianExcess)}
                </span>
              )}
            </div>
            {data.distribution.every((d) => d.candidates === 0 && d.baseline === 0) ? (
              <div className="py-8 text-center text-xs text-text-secondary">
                Not available: no matured outcomes for this filter combination yet.
              </div>
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.distribution} margin={{ top: 10, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                      label={{ value: "Excess return vs NIFTY 500 (%)", position: "insideBottom", offset: -10, fill: "var(--color-text-secondary)", fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }}
                      label={{ value: "Count", angle: -90, position: "insideLeft", fill: "var(--color-text-secondary)", fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-surface)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text)",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <ReferenceLine x="0 to +2%" stroke="var(--color-text-secondary)" strokeDasharray="3 3" />
                    <Bar dataKey="candidates" name="Plan candidates" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="baseline" name="All liquid windows" fill="var(--color-text-muted)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </BaseCard>

          {/* 5. Recent Plan Dates (last 30) */}
          <BaseCard padding="p-0" className="overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border bg-bg-secondary flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Recent Plan Dates (last {data.recentPlans.length})
              </h2>
              <span className="text-xs text-text-secondary">
                Tap a date to inspect candidate returns
              </span>
            </div>
            {data.recentPlans.length === 0 ? (
              <div className="p-6 text-center text-xs text-text-secondary">
                No stored plan outcomes available yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.recentPlans.map((pd) => {
                  const isOpen = expandedDate === pd.planDate;
                  return (
                    <div key={pd.planDate}>
                      <button
                        type="button"
                        onClick={() => setExpandedDate(isOpen ? null : pd.planDate)}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-bg-hover text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-text-secondary" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-secondary" />
                          )}
                          <span className="text-[13px] font-semibold text-text tabular-nums">
                            {pd.planDate}
                          </span>
                        </div>
                        <span className="text-xs text-text-secondary tabular-nums">
                          {pd.candidates.length} candidates
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-border bg-bg-secondary/30 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="border-b border-border text-xs uppercase tracking-wider text-text-secondary">
                              <tr>
                                <th className="px-3 py-2 text-left">#</th>
                                <th className="px-3 py-2 text-left">Symbol</th>
                                <th className="px-3 py-2 text-left">Industry</th>
                                <th className="px-3 py-2 text-right">1D</th>
                                <th className="px-3 py-2 text-right">5D</th>
                                <th className="px-3 py-2 text-right">10D</th>
                                <th className="px-3 py-2 text-right">20D</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                              {pd.candidates.map((c) => (
                                <tr key={c.token}>
                                  <td className="px-3 py-2 tabular-nums text-[13px] text-text-secondary">
                                    {c.rank ?? "—"}
                                  </td>
                                  <td className="px-3 py-2 text-[13px] font-semibold text-text">
                                    {c.symbol}
                                  </td>
                                  <td className="px-3 py-2 text-text-secondary">{c.industryLabel}</td>
                                  {([1, 5, 10, 20] as const).map((h) => {
                                    const cell = c.horizons[h];
                                    if (!cell) {
                                      return (
                                        <td key={h} className="px-3 py-2 text-right text-xs text-text-secondary">
                                          — not yet
                                        </td>
                                      );
                                    }
                                    if (cell.status === "missing") {
                                      return (
                                        <td key={h} className="px-3 py-2 text-right text-xs text-warning">
                                          no data
                                        </td>
                                      );
                                    }
                                    return (
                                      <td key={h} className="px-3 py-2 text-right text-[13px]">
                                        <SignedReturn value={cell.ret} size="sm" />
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </BaseCard>

          {/* 6. Fixed Definition Box */}
          <BaseCard padding="p-4" bg="bg-bg-secondary" className="space-y-1.5 text-xs text-text-secondary">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text">
              How this is measured
            </h2>
            <p>
              Horizons (1, 5, 10, 20) count stored trading sessions after the plan date. Two reference prices are tracked:
              plan-date close and the next session&apos;s open. Excess return compares each stock against NIFTY 500 over the exact same dates.
            </p>
            <p>
              First-appearance mode counts a stock once per 10-session rolling window. Filter thresholds are fixed before measuring and grouped by rules version.
              Live rows begin after backfill; historical backfill uses only data on or before each plan date.
            </p>
            <p className="font-medium text-text">
              Past results of a fixed filter. Not a forecast. Overlapping dates are not independent.
            </p>
          </BaseCard>
        </>
      )}
    </PageContainer>
  );
}
