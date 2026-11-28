"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  HelpCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { DailyPlanResponse, PlanCandidateRow } from "@/lib/daily-plan";
import { detectPatterns } from "@/lib/patterns";
import PageContainer, { SectionHeader } from "@/components/shared/PageContainer";
import { BaseCard } from "@/components/ui/card";
import TopGroupsStrip from "@/components/industry-strength/TopGroupsStrip";
import BottomSheet from "@/components/industry-strength/BottomSheet";
import { SignedReturn } from "@/components/industry-strength/RankPrimitives";
import StockChartModal, { ChartStockItem } from "@/components/shared/StockChartModal";

const PATTERN_CONCURRENCY = 4;

function stateBadgeCls(state?: string) {
  if (state === "Strong") return "bg-success-bg text-success border-success/30";
  if (state === "Weak") return "bg-danger-bg text-danger border-danger/30";
  return "bg-warning-bg text-warning border-warning/30";
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export default function DailyPlanView() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [data, setData] = useState<DailyPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedStock, setSelectedStock] = useState<PlanCandidateRow | null>(null);

  const [patternsByToken, setPatternsByToken] = useState<Record<number, string>>({});
  const [checkingPatterns, setCheckingPatterns] = useState(false);

  const fetchPlan = useCallback(async (dateStr: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = dateStr ? `?date=${encodeURIComponent(dateStr)}` : "";
      const res = await fetch(`/api/plan${qs}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as DailyPlanResponse;
      setData(json);
      if (!dateStr && json.planDate) {
        setSelectedDate(json.planDate);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load Daily Plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlan(selectedDate);
  }, [fetchPlan, selectedDate]);

  // P4: Lazy client-side chart pattern detection (max 20 candidates, concurrency 4)
  useEffect(() => {
    const cands = data?.candidates || [];
    if (cands.length === 0) {
      setPatternsByToken({});
      setCheckingPatterns(false);
      return;
    }

    let cancelled = false;
    setPatternsByToken({});
    setCheckingPatterns(true);

    const queue = cands.slice(0, 20);
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length && !cancelled) {
        const idx = cursor++;
        const cand = queue[idx];
        try {
          const res = await fetch(
            `/api/terminal/screener/chart?token=${encodeURIComponent(String(cand.token))}&source=industry`
          );
          if (!res.ok) continue;
          const json = await res.json();
          const candles = Array.isArray(json?.candles) ? json.candles : [];
          if (candles.length < 30 || cancelled) continue;
          const det = detectPatterns(candles);
          const active = ((det?.patterns || []) as { status?: string; label?: string; type?: string }[]).find(
            (p) => p.status !== "historical"
          );
          if (active && !cancelled) {
            const label = String(active.label || active.type || "").trim();
            if (label) {
              setPatternsByToken((prev) => ({ ...prev, [cand.token]: label }));
            }
          }
        } catch {
          // non-fatal per candidate
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(PATTERN_CONCURRENCY, queue.length) },
      () => worker()
    );
    Promise.all(workers).finally(() => {
      if (!cancelled) setCheckingPatterns(false);
    });

    return () => {
      cancelled = true;
    };
  }, [data?.planDate, data?.candidates]);

  const handleCopy = async () => {
    if (!data?.candidates?.length) return;
    const text = data.candidates
      .map((c) => `${c.rank}. ${c.symbol} (${c.industryLabel}) · RS ${c.rsRank.toFixed(0)} · ${c.reasons.join(" · ")}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore clipboard error */
    }
  };

  const handleCsv = () => {
    if (!data?.candidates?.length) return;
    const header = ["Rank", "Symbol", "Industry", "RS", "Stage", "Hits", "Pattern", "Reasons", "Close", "1D %", "Off 52W High %"];
    const rows = data.candidates.map((c) => [
      c.rank,
      c.symbol,
      c.industryLabel,
      c.rsRank,
      c.stage,
      c.screenerHits.join("; "),
      patternsByToken[c.token] || "",
      c.reasons.join("; "),
      c.close ?? "",
      c.ret1dPct ?? "",
      c.pctFrom52wHigh ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-plan-${data.planDate || "latest"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="max-w-[1280px] mx-auto space-y-3">
          <div className="h-14 rounded-lg bg-bg-secondary border border-border" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 rounded-xl bg-bg-secondary border border-border" />
            ))}
          </div>
          <div className="h-44 rounded-xl bg-bg-secondary border border-border" />
          <div className="h-72 rounded-xl bg-bg-secondary border border-border" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="max-w-[1280px] mx-auto space-y-4 pb-10">
        {/* 1. Header + Date Picker + P3 Summary */}
        <SectionHeader
          title="Daily Plan"
          info="Automated top-down market, cap, breakout, industry, and candidate filter"
          subtitle={
            data?.planDate
              ? `Plan ${data.planDate} · Market ${data.market.as_of ?? "—"} · Caps ${data.caps.as_of ?? "—"} · Breakouts ${data.breakouts.as_of ?? "—"} · Top 3 ${data.topIndustries.as_of ?? "—"}`
              : "No stored plan available"
          }
          action={
            <div className="flex items-center gap-2">
              {data && data.availableDates.length > 0 && (
                <select
                  aria-label="Select plan date"
                  value={selectedDate || data.planDate || ""}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-7 px-2 rounded-md border border-border bg-surface text-xs tabular-nums text-text cursor-pointer"
                >
                  {data.availableDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => fetchPlan(selectedDate)}
                disabled={loading}
                aria-label="Refresh Daily Plan"
                className="p-1.5 rounded-md border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          }
        />

        {error && (
          <BaseCard padding="p-3" bg="bg-warning-bg" className="text-warning text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchPlan(selectedDate)}
              className="px-2.5 py-1 rounded bg-surface border border-border text-text font-medium cursor-pointer"
            >
              Retry
            </button>
          </BaseCard>
        )}

        {data && (
          <>
            {/* Summary banner */}
            <BaseCard padding="p-3.5" bg="bg-surface">
              <p className="text-xs sm:text-[13px] text-text leading-relaxed">{data.summaryText}</p>
              {data.summarySource === "gemini" && (
                <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-text-secondary">
                  <Sparkles className="w-3 h-3" />
                  <span>AI-written from the numbers</span>
                </div>
              )}
            </BaseCard>

            {/* 2. Market, 3. Caps, 4. Breakouts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Block 1: Market */}
              <BaseCard padding="p-3.5" className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    1. Market State
                  </h2>
                  <Link href="/" className="text-xs font-medium text-primary dark:text-indigo-300 hover:underline">
                    Open Breadth
                  </Link>
                </div>

                {data.market.status !== "available" ? (
                  <p className="text-xs text-text-secondary">
                    Not available: {data.market.reason || "missing breadth data"}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${stateBadgeCls(
                          data.market.state
                        )}`}
                      >
                        {data.market.state}
                      </span>
                      {data.market.delta_50sma_5d !== null && data.market.delta_50sma_5d !== undefined && (
                        <span className="text-xs tabular-nums text-text-secondary tabular-nums">
                          5D &Delta;50SMA: {data.market.delta_50sma_5d >= 0 ? "+" : ""}
                          {data.market.delta_50sma_5d.toFixed(1)} pp
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs tabular-nums">
                      <div className="rounded bg-bg-secondary p-2">
                        <div className="text-xs text-text-secondary">&gt;50 SMA</div>
                        <div className="text-[13px] font-semibold text-text">{data.market.pct_above_50sma?.toFixed(1)}%</div>
                      </div>
                      <div className="rounded bg-bg-secondary p-2">
                        <div className="text-xs text-text-secondary">&gt;200 SMA</div>
                        <div className="text-[13px] font-semibold text-text">{data.market.pct_above_200sma?.toFixed(1)}%</div>
                      </div>
                      <div className="rounded bg-bg-secondary p-2">
                        <div className="text-xs text-text-secondary">Net 20D H/L</div>
                        <div className="text-[13px] font-semibold text-text">
                          {(data.market.net_highs_20d ?? 0) > 0 ? `+${data.market.net_highs_20d}` : data.market.net_highs_20d}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </BaseCard>

              {/* Block 2: Where money is going */}
              <BaseCard padding="p-3.5" className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    2. Where Money Is Going
                  </h2>
                  <span className="text-[13px] font-semibold text-text">
                    {data.caps.status === "available" ? data.caps.leader : "Not available"}
                  </span>
                </div>

                {data.caps.status !== "available" || !data.caps.segments ? (
                  <p className="text-xs text-text-secondary">
                    Not available: {data.caps.reason || "insufficient index history"}
                  </p>
                ) : (
                  <div className="divide-y divide-border text-xs">
                    {data.caps.segments.map((seg) => (
                      <div key={seg.key} className="py-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-text flex items-center gap-1.5">
                            <span>{seg.label}</span>
                            {data.caps.leader === seg.label && (
                              <span className="px-1.5 py-0.2 rounded bg-primary-subtle text-primary dark:text-indigo-300 text-xs font-semibold">
                                Leading
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-secondary tabular-nums">
                            &gt;50 SMA {seg.pct_above_50sma !== null ? `${seg.pct_above_50sma.toFixed(0)}%` : "—"}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 tabular-nums text-[13px]">
                          <div className="text-right">
                            <div className="text-xs text-text-secondary">5D</div>
                            <SignedReturn value={seg.ret_5d} size="sm" />
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-text-secondary">20D</div>
                            <SignedReturn value={seg.ret_20d} size="sm" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </BaseCard>

              {/* Block 3: Breakouts & Stage 2 */}
              <BaseCard padding="p-3.5" className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    3. Breakouts &amp; Stage 2
                  </h2>
                  <Link href="/screener" className="text-xs font-medium text-primary dark:text-indigo-300 hover:underline">
                    Open Screener
                  </Link>
                </div>

                {data.breakouts.status !== "available" || !data.breakouts.counts ? (
                  <p className="text-xs text-text-secondary">
                    Not available: {data.breakouts.reason || "missing screener counts"}
                  </p>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="divide-y divide-border tabular-nums">
                      {[
                        { key: "stage2_breakout", label: "Stage 2 BO" },
                        { key: "vcp", label: "VCP" },
                        { key: "near_pivot", label: "Near Pivot" },
                      ].map((row) => {
                        const c = data.breakouts.counts?.[row.key];
                        return (
                          <div key={row.key} className="py-1 flex items-center justify-between">
                            <span className="font-sans text-text">{row.label}</span>
                            <span className="text-text-secondary">
                              <strong className="text-[13px] text-text">{c?.today ?? 0}</strong>{" "}
                              <span className="text-xs text-text-secondary">
                                (1D: {c?.prev_1d ?? "—"}, 5D: {c?.prev_5d ?? "—"})
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-1 border-t border-border flex items-center justify-between text-xs tabular-nums">
                      <span className="text-text-secondary">
                        Stage 2 (close &gt; SMA150 &amp; 20D slope &ge; 1%):{" "}
                        <strong className="text-[13px] text-text">
                          N500 {data.breakouts.stage2_pct?.nifty500?.toFixed(1) ?? "—"}% · Liq{" "}
                          {data.breakouts.stage2_pct?.liquid?.toFixed(1) ?? "—"}%
                        </strong>
                      </span>
                    </div>
                    <div className="text-xs text-text-secondary">
                      5D Follow-through:{" "}
                      <strong className="text-[13px] tabular-nums text-text">
                        {data.breakouts.follow_through?.label ?? "too few to judge"}
                      </strong>
                    </div>
                  </div>
                )}
              </BaseCard>
            </div>

            {/* 5. Top 3 Industries (reusing TopGroupsStrip from UX3) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    4. Top 3 Industries ({data.topIndustries.level})
                  </span>
                  {data.topIndustries.as_of && data.topIndustries.as_of !== data.planDate && (
                    <span className="px-2 py-0.5 rounded bg-warning-bg text-warning text-xs font-medium">
                      Industries as of {data.topIndustries.as_of}
                    </span>
                  )}
                </div>
                <Link href="/sectors" className="text-xs font-medium text-primary dark:text-indigo-300 hover:underline">
                  Open Industries
                </Link>
              </div>
              {data.topIndustries.status !== "available" ? (
                <BaseCard padding="p-3.5" className="text-xs text-text-secondary">
                  Top 3 industries not available for {data.planDate}:{" "}
                  {data.topIndustries.reason || "no stored rows"}
                </BaseCard>
              ) : (
                <TopGroupsStrip
                  topGroups={data.topIndustries.groups}
                  topGroupsAsOf={data.topIndustries.as_of}
                  loading={false}
                  onSelectGroup={() => router.push("/sectors")}
                />
              )}
            </div>

            {/* 6. Final Candidates */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                      5. Final Candidates ({data.candidates.length}
                      {data.totalCandidates > data.candidates.length
                        ? ` · ${data.totalCandidates - data.candidates.length} more`
                        : ""}
                      )
                    </h2>
                    {data.topIndustries.as_of && data.topIndustries.as_of !== data.planDate && (
                      <span className="px-2 py-0.5 rounded bg-warning-bg text-warning text-xs font-medium">
                        Industries as of {data.topIndustries.as_of}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    Candidates = Stage 2 (close &gt; SMA150 &amp; 20D slope &ge; 1%), RS &ge; 70, max 5 per top-3 industry. A filter result, not advice.
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {checkingPatterns && (
                    <span className="text-xs text-text-secondary mr-1">checking patterns…</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRulesOpen(true)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-surface text-xs font-medium text-text-secondary hover:text-text cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>How this is built</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={data.candidates.length === 0}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-surface text-xs font-medium text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCsv}
                    disabled={data.candidates.length === 0}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-surface text-xs font-medium text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {data.candidates.length === 0 ? (
                <BaseCard padding="p-6" className="text-center text-xs text-text-secondary">
                  No qualifying candidates for {data.planDate}.
                </BaseCard>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const groupsMeta = data.topIndustries.groups || [];
                    const grouped: Array<{
                      label: string;
                      pos: number | null;
                      worstRank: number | null;
                      hiddenCandidates: number;
                      rows: typeof data.candidates;
                    }> = [];
                    const seenInd = new Set<string>();
                    for (const g of groupsMeta) {
                      const rows = data.candidates.filter((c) => c.industryLabel === g.label);
                      const hidden = Number((g as { hiddenCandidates?: number }).hiddenCandidates || 0);
                      if (rows.length > 0 || hidden > 0) {
                        seenInd.add(g.label);
                        grouped.push({
                          label: g.label,
                          pos: g.pos,
                          worstRank: g.worstRank,
                          hiddenCandidates: hidden,
                          rows,
                        });
                      }
                    }
                    for (const c of data.candidates) {
                      if (!seenInd.has(c.industryLabel)) {
                        seenInd.add(c.industryLabel);
                        grouped.push({
                          label: c.industryLabel,
                          pos: null,
                          worstRank: null,
                          hiddenCandidates: 0,
                          rows: data.candidates.filter((x) => x.industryLabel === c.industryLabel),
                        });
                      }
                    }

                    return grouped.map((grp) => (
                      <div key={grp.label} className="rounded-xl border border-border bg-surface overflow-hidden">
                        <div className="px-3.5 py-2.5 bg-bg-secondary border-b border-border flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {grp.pos !== null && (
                              <span className="px-2 py-0.5 rounded bg-primary-subtle text-primary dark:text-indigo-300 text-xs font-semibold tabular-nums">
                                Top #{grp.pos}
                              </span>
                            )}
                            <span className="text-[13px] font-semibold text-text truncate">{grp.label}</span>
                            {grp.worstRank !== null && (
                              <span className="text-xs text-text-secondary tabular-nums">
                                Worst #{grp.worstRank}
                              </span>
                            )}
                          </div>
                          {grp.hiddenCandidates > 0 && (
                            <span className="text-xs text-text-secondary">
                              +{grp.hiddenCandidates} more in {grp.label} (not shown)
                            </span>
                          )}
                        </div>

                        {/* Mobile ~64px rows */}
                        <div className="lg:hidden divide-y divide-border">
                          {grp.rows.map((c) => {
                            const pat = patternsByToken[c.token];
                            return (
                              <button
                                key={c.token}
                                type="button"
                                onClick={() => setSelectedStock(c)}
                                className="w-full text-left px-3 py-2.5 min-h-[64px] hover:bg-bg-secondary/40 cursor-pointer space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="tabular-nums text-[13px] text-text-secondary">#{c.rank}</span>
                                    <span className="text-[13px] font-semibold text-text truncate">{c.symbol}</span>
                                  </div>
                                  <div className="flex items-center gap-2.5 shrink-0 tabular-nums text-[13px]">
                                    <span className="font-semibold text-text">RS {c.rsRank.toFixed(0)}</span>
                                    {c.close !== null && (
                                      <span className="text-text-secondary">₹{c.close.toFixed(2)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1 text-xs">
                                  <span className="text-text-secondary">{c.reasons.join(" · ")}</span>
                                  {pat && (
                                    <span className="px-1.5 py-0.2 rounded bg-primary-subtle text-primary dark:text-indigo-300 font-medium">
                                      {pat}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Desktop table */}
                        <div className="hidden lg:block overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-bg-secondary/60 border-b border-border text-xs uppercase tracking-wider text-text-secondary">
                              <tr>
                                <th className="px-3 py-2 text-left">#</th>
                                <th className="px-3 py-2 text-left">Symbol</th>
                                <th className="px-3 py-2 text-right">RS</th>
                                <th className="px-3 py-2 text-right">Close</th>
                                <th className="px-3 py-2 text-right">1D %</th>
                                <th className="px-3 py-2 text-left">Hits &amp; Pattern</th>
                                <th className="px-3 py-2 text-left">Reasons</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                              {grp.rows.map((c) => {
                                const pat = patternsByToken[c.token];
                                return (
                                  <tr
                                    key={c.token}
                                    onClick={() => setSelectedStock(c)}
                                    className="hover:bg-bg-hover cursor-pointer"
                                  >
                                    <td className="px-3 py-2.5 tabular-nums text-[13px] text-text-secondary">{c.rank}</td>
                                    <td className="px-3 py-2.5 text-[13px] font-semibold text-text">{c.symbol}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-[13px] font-semibold text-text">
                                      {c.rsRank.toFixed(0)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-[13px] text-text">
                                      {c.close !== null ? `₹${c.close.toFixed(2)}` : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-[13px]">
                                      <SignedReturn value={c.ret1dPct} size="sm" />
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <div className="flex flex-wrap gap-1">
                                        {c.screenerHits.map((h) => (
                                          <span key={h} className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-xs tabular-nums text-text">
                                            {h}
                                          </span>
                                        ))}
                                        {pat && (
                                          <span className="px-1.5 py-0.5 rounded bg-primary-subtle border border-accent-border text-xs font-medium text-primary dark:text-indigo-300">
                                            {pat}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-text-secondary">{c.reasons.join(" · ")}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <BottomSheet open={rulesOpen} onClose={() => setRulesOpen(false)} title={`How this is built (${data?.rulesVersion || "plan_v1"})`}>
        <div className="space-y-2.5 text-xs text-text-secondary">
          <p>
            <strong className="text-text">Market State (Nifty 500):</strong> Strong if &gt;50 SMA &ge; 60%, &gt;200 SMA &ge; 50%, and net 20D highs &gt; 0; Weak if &gt;50 SMA &lt; 40% or &gt;200 SMA &lt; 35%; else Mixed.
          </p>
          <p>
            <strong className="text-text">Cap Leadership:</strong> Highest 20-session index return across Large (Nifty 50 / Nifty 100 breadth), Mid (Nifty Midcap 150), and Small (Nifty Smallcap 250) when leading by &ge; 1.0 percentage point; else &ldquo;no clear leader&rdquo;.
          </p>
          <p>
            <strong className="text-text">Candidate Filter:</strong> Liquid stocks in today&apos;s Top 3 industries (industry level, minimax across 1D/1W/1M/3M), RS &ge; 70, Stage 2 (our definition: close &gt; SMA150 and 20-day SMA150 slope &ge; 1%), and within 25% of 52W high. Ordered by screener hit priority, RS descending, and industry rank. Capped at 5 per industry and 20 rows total.
          </p>
          <p className="text-text-secondary">
            Deterministic filter output defined in docs/PLAN_RULES.md; not advice.
          </p>
        </div>
      </BottomSheet>

      {selectedStock && (
        <StockChartModal
          stock={{
            token: selectedStock.token,
            symbol: selectedStock.symbol,
            name: selectedStock.symbol,
            industry: selectedStock.industryLabel,
            close: selectedStock.close,
            ret1dPct: selectedStock.ret1dPct,
            source: "industry",
          }}
          items={data?.candidates.map((c): ChartStockItem => ({
            token: c.token,
            symbol: c.symbol,
            name: c.symbol,
            industry: c.industryLabel,
            close: c.close,
            ret1dPct: c.ret1dPct,
            source: "industry",
          }))}
          onSelectStock={(next) => {
            const found = data?.candidates.find((c) => c.token === next.token);
            if (found) setSelectedStock(found);
          }}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </PageContainer>
  );
}
