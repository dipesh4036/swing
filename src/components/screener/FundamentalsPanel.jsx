"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  BarChart3,
  PieChart,
  Activity,
  Layers,
} from "lucide-react";

export default function FundamentalsPanel({ symbol, isOpen, onClose, stockInfo }) {
  const [activeTab, setActiveTab] = useState("summary"); // "summary" | "financials" | "shareholding"
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [errorReason, setErrorReason] = useState(null);

  useEffect(() => {
    if (!isOpen || !symbol) {
      return;
    }

    const controller = new AbortController();
    let isAborted = false;

    // Debounce fundamentals fetch 400ms after stock selection settles (R13d)
    const timerId = setTimeout(() => {
      setLoading(true);
      setErrorReason(null);
      setData(null);

      async function fetchFundamentals() {
        try {
          const res = await fetch(
            `/api/terminal/screener/fundamentals?symbol=${encodeURIComponent(symbol)}`,
            { signal: controller.signal }
          );

          if (!res.ok) {
            if (!isAborted) {
              setErrorReason("upstream_error");
              setLoading(false);
            }
            return;
          }

          const json = await res.json();
          if (!isAborted) {
            if (json.available) {
              setData(json);
              setErrorReason(null);
            } else {
              setData(null);
              setErrorReason(json.reason || "upstream_error");
            }
          }
        } catch (err) {
          if (!isAborted && err.name !== "AbortError") {
            setErrorReason("upstream_error");
          }
        } finally {
          if (!isAborted) {
            setLoading(false);
          }
        }
      }

      fetchFundamentals();
    }, 400);

    return () => {
      isAborted = true;
      clearTimeout(timerId);
      controller.abort();
    };
  }, [isOpen, symbol]);

  if (!isOpen || !symbol) {
    return null;
  }

  const sourceUrl =
    data?.source_url || `https://tapetide.com/stocks/${encodeURIComponent(symbol)}`;

  const getReasonMessage = (reason) => {
    switch (reason) {
      case "not_found":
        return "Fundamentals not found for this symbol on Tapetide.";
      case "rate_limited":
        return "Rate limit reached. Please try again shortly.";
      case "timeout":
        return "Tapetide request timed out.";
      case "parse_error":
        return "Unable to parse fundamentals data.";
      default:
        return "Unable to load fundamentals from Tapetide.";
    }
  };

  // Helper to extract snapshot value by label
  const getSnap = (labels) => {
    if (!data?.snapshot) return null;
    const lowerLabels = labels.map((l) => l.toLowerCase());
    return data.snapshot.find((s) => lowerLabels.includes(s.label.toLowerCase()));
  };

  const mcap = getSnap(["Market Cap"]);
  const pe = getSnap(["P/E (TTM)", "P/E"]);
  const roce = getSnap(["ROCE"]);
  const roe = getSnap(["ROE"]);
  const debtToEq = getSnap(["Debt to Equity"]);
  const promoter = getSnap(["Promoter Holding"]);

  return (
    <div className="fixed lg:static inset-y-0 right-0 z-30 lg:z-10 w-full max-w-[420px] xl:max-w-[460px] h-full flex flex-col bg-surface border-l border-border shrink-0 text-xs text-text shadow-2xl lg:shadow-none overflow-hidden transition-all duration-200">
      {/* ── Top Header ────────────────────────────────────────── */}
      <div className="p-3 border-b border-border bg-bg-secondary/40 shrink-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-text tracking-tight">
                {symbol}
              </span>
              {stockInfo?.rs_rank !== null && stockInfo?.rs_rank !== undefined && (
                <span className="text-xs tabular-nums px-1.5 py-0.2 rounded font-semibold bg-primary-subtle text-primary border border-primary/20">
                  RS {stockInfo.rs_rank}
                </span>
              )}
            </div>
            <div className="text-xs text-text-secondary truncate mt-0.5 font-medium">
              {data?.company || stockInfo?.company || symbol}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full fundamentals on Tapetide"
              className="p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-bg-hover transition-colors flex items-center gap-1 text-xs"
            >
              <span>Tapetide</span>
              <ExternalLink size={12} />
            </a>
            <button
              type="button"
              onClick={onClose}
              title="Close fundamentals panel"
              className="p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-bg-hover transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Sector & Industry Pills */}
        {(data?.sector || data?.industry) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {data.sector && (
              <span className="px-2 py-0.5 rounded text-xs bg-bg-secondary text-text-secondary font-medium border border-border/60 truncate max-w-[180px]">
                {data.sector}
              </span>
            )}
            {data.industry && (
              <span className="px-2 py-0.5 rounded text-xs bg-bg-secondary text-text-secondary font-medium border border-border/60 truncate max-w-[220px]">
                {data.industry}
              </span>
            )}
          </div>
        )}

        {/* Core KPI Strip (Always visible) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-1">
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">MCap</span>
            <span className="tabular-nums text-xs font-bold text-text truncate">
              {mcap?.value_text || "—"}
            </span>
          </div>
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">P/E</span>
            <span className="tabular-nums text-xs font-bold text-text truncate">
              {pe?.value_text || "—"}
            </span>
          </div>
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">ROCE</span>
            <span className="tabular-nums text-xs font-bold text-bullish truncate">
              {roce?.value_text || "—"}
            </span>
          </div>
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">ROE</span>
            <span className="tabular-nums text-xs font-bold text-text truncate">
              {roe?.value_text || "—"}
            </span>
          </div>
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">D/E</span>
            <span className="tabular-nums text-xs font-bold text-text truncate">
              {debtToEq?.value_text || "—"}
            </span>
          </div>
          <div className="bg-surface border border-border/80 rounded p-1.5 flex flex-col">
            <span className="text-xs text-text-secondary uppercase tracking-wider">Promoter</span>
            <span className="tabular-nums text-xs font-bold text-text truncate">
              {promoter?.value_text || "—"}
            </span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 p-0.5 bg-bg-secondary rounded-md border border-border/60">
          <button
            type="button"
            onClick={() => setActiveTab("summary")}
            className={`flex-1 py-1 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "summary"
                ? "bg-surface text-primary shadow-xs"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <Activity size={12} />
            <span>Overview</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("financials")}
            className={`flex-1 py-1 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "financials"
                ? "bg-surface text-primary shadow-xs"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <BarChart3 size={12} />
            <span>Financials</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("shareholding")}
            className={`flex-1 py-1 px-2 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === "shareholding"
                ? "bg-surface text-primary shadow-xs"
                : "text-text-secondary hover:text-text"
            }`}
          >
            <PieChart size={12} />
            <span>Ownership</span>
          </button>
        </div>
      </div>

      {/* ── Scrollable Body Area ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading ? (
          /* Loading State */
          <div className="space-y-3 animate-pulse py-2">
            <div className="grid grid-cols-2 gap-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 bg-bg-secondary rounded p-2" />
              ))}
            </div>
            <div className="h-28 bg-bg-secondary rounded" />
            <div className="h-32 bg-bg-secondary rounded" />
          </div>
        ) : errorReason ? (
          /* Error Fallback Card */
          <div className="p-4 rounded-lg bg-bg-secondary border border-border text-center space-y-3 my-6">
            <AlertCircle size={24} className="text-warning mx-auto" />
            <div className="text-xs text-text-secondary leading-relaxed">
              {getReasonMessage(errorReason)}
            </div>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
            >
              <span>View details on Tapetide</span>
              <ExternalLink size={13} />
            </a>
          </div>
        ) : data ? (
          <>
            {/* ── TAB 1: SUMMARY / OVERVIEW ────────────────────── */}
            {activeTab === "summary" && (
              <div className="space-y-3.5">
                {/* Strengths & Weaknesses (Qualitative Insights) */}
                {((data.strengths && data.strengths.length > 0) ||
                  (data.weaknesses && data.weaknesses.length > 0)) && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                      <Layers size={12} />
                      <span>Key Insights & Fundamentals</span>
                    </div>

                    {data.strengths && data.strengths.length > 0 && (
                      <div className="border border-border/80 rounded-md p-2.5 bg-bullish-bg/20">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-bullish mb-1">
                          <ShieldCheck size={14} className="shrink-0" />
                          <span>Strengths</span>
                        </div>
                        <ul className="space-y-1 text-xs text-text-secondary list-disc pl-4">
                          {data.strengths.map((str, idx) => (
                            <li key={idx} className="leading-snug">
                              {str}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {data.weaknesses && data.weaknesses.length > 0 && (
                      <div className="border border-border/80 rounded-md p-2.5 bg-bearish-bg/20">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-bearish mb-1">
                          <ShieldAlert size={14} className="shrink-0" />
                          <span>Weaknesses / Risks</span>
                        </div>
                        <ul className="space-y-1 text-xs text-text-secondary list-disc pl-4">
                          {data.weaknesses.map((wk, idx) => (
                            <li key={idx} className="leading-snug">
                              {wk}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Technical Consensus / Bias */}
                {data.signals && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                      Technical Indicator Consensus
                    </div>
                    <div className="p-2.5 rounded-md border border-border/80 bg-bg-secondary/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-secondary font-medium">Overall Bias</span>
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary-subtle text-primary border border-primary/30">
                          {data.signals.overall || "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-center tabular-nums text-xs">
                        <div className="bg-bullish-bg/50 border border-bullish-border/60 rounded py-1 px-1.5">
                          <span className="block text-xs text-bullish uppercase font-sans">Bullish</span>
                          <span className="font-bold text-bullish">{data.signals.bullish !== null && data.signals.bullish !== undefined ? data.signals.bullish : "—"}</span>
                        </div>
                        <div className="bg-neutral-bg border border-border rounded py-1 px-1.5">
                          <span className="block text-xs text-text-secondary uppercase font-sans">Neutral</span>
                          <span className="font-bold text-text-secondary">{data.signals.neutral !== null && data.signals.neutral !== undefined ? data.signals.neutral : "—"}</span>
                        </div>
                        <div className="bg-bearish-bg/50 border border-bearish-border/60 rounded py-1 px-1.5">
                          <span className="block text-xs text-bearish uppercase font-sans">Bearish</span>
                          <span className="font-bold text-bearish">{data.signals.bearish !== null && data.signals.bearish !== undefined ? data.signals.bearish : "—"}</span>
                        </div>
                      </div>
                      {(data.signals.oscillators || data.signals.moving_averages) && (
                        <div className="flex items-center justify-between text-xs text-text-secondary pt-1 border-t border-border/60">
                          <span>Oscillators: <strong className="text-text">{data.signals.oscillators || "—"}</strong></span>
                          <span>Moving Averages: <strong className="text-text">{data.signals.moving_averages || "—"}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Detailed Ratios Grid */}
                {data.snapshot && data.snapshot.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                      Key Ratios & Valuation
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {data.snapshot.map((item, idx) => (
                        <div
                          key={idx}
                          className="bg-bg-secondary/40 border border-border/80 rounded px-2.5 py-1.5 flex items-center justify-between"
                        >
                          <span className="text-xs text-text-secondary truncate pr-1">
                            {item.label}
                          </span>
                          <span className="tabular-nums text-xs font-semibold text-text truncate">
                            {item.value_text || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB 2: FINANCIALS (QUARTERS & GROWTH) ────────── */}
            {activeTab === "financials" && (
              <div className="space-y-3.5">
                {/* Growth Rates CAGR Cards */}
                {data.growth && data.growth.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                      Compounded Growth Rates
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {data.growth.map((g, idx) => {
                        const isPos = g.value_num !== null && g.value_num > 0;
                        const isNeg = g.value_num !== null && g.value_num < 0;
                        return (
                          <div
                            key={idx}
                            className="bg-bg-secondary/40 border border-border/80 rounded px-2.5 py-1.5 flex flex-col justify-center"
                          >
                            <span className="text-xs text-text-secondary truncate">
                              {g.label} ({g.period})
                            </span>
                            <span
                              className={`tabular-nums text-xs font-semibold mt-0.5 truncate ${
                                isPos
                                  ? "text-bullish"
                                  : isNeg
                                  ? "text-bearish"
                                  : "text-text"
                              }`}
                            >
                              {g.value_text || "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quarterly Results Table */}
                {data.quarters && data.quarters.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                      Quarterly Statements (₹ Cr)
                    </div>
                    <div className="overflow-x-auto border border-border/80 rounded-md bg-bg-secondary/20">
                      <table className="w-full text-left tabular-nums text-xs">
                        <thead>
                          <tr className="border-b border-border bg-bg-secondary/60 text-text-secondary text-xs">
                            <th className="py-1 px-2 font-medium">Period</th>
                            <th className="py-1 px-2 font-medium text-right">Sales</th>
                            <th className="py-1 px-2 font-medium text-right">Net Profit</th>
                            <th className="py-1 px-2 font-medium text-right">OPM %</th>
                            <th className="py-1 px-2 font-medium text-right">EPS</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {data.quarters.map((q, idx) => (
                            <tr key={idx} className="hover:bg-bg-hover/40">
                              <td className="py-1.5 px-2 text-text font-medium">
                                {q.period || "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right text-text">
                                {q.sales !== null && q.sales !== undefined ? q.sales : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right text-text font-semibold">
                                {q.net_profit !== null && q.net_profit !== undefined
                                  ? q.net_profit
                                  : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right text-text">
                                {q.opm !== null && q.opm !== undefined ? `${q.opm}%` : "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right text-text">
                                {q.eps !== null && q.eps !== undefined ? `₹${q.eps}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TAB 3: SHAREHOLDING / OWNERSHIP ─────────────── */}
            {activeTab === "shareholding" && (
              <div className="space-y-3.5">
                {data.shareholding?.latest ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center justify-between">
                      <span>Ownership Pattern</span>
                      <span className="tabular-nums text-xs text-text-secondary">
                        {data.shareholding.latest.period || "Latest"}
                        {data.shareholding.previous?.period
                          ? ` vs ${data.shareholding.previous.period}`
                          : ""}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {[
                        {
                          label: "Promoters",
                          cur: data.shareholding.latest.promoters,
                          prev: data.shareholding.previous?.promoters,
                        },
                        {
                          label: "Foreign Institutions (FIIs)",
                          cur: data.shareholding.latest.fii,
                          prev: data.shareholding.previous?.fii,
                        },
                        {
                          label: "Domestic Institutions (DIIs)",
                          cur: data.shareholding.latest.dii,
                          prev: data.shareholding.previous?.dii,
                        },
                        {
                          label: "Public & Others",
                          cur: data.shareholding.latest.public,
                          prev: data.shareholding.previous?.public,
                        },
                      ].map((item, idx) => {
                        const delta =
                          item.cur !== null &&
                          item.cur !== undefined &&
                          item.prev !== null &&
                          item.prev !== undefined
                            ? Number((item.cur - item.prev).toFixed(2))
                            : null;
                        return (
                          <div
                            key={idx}
                            className="bg-bg-secondary/40 border border-border/80 rounded-md p-2.5 flex items-center justify-between"
                          >
                            <div>
                              <span className="text-xs font-medium text-text block">
                                {item.label}
                              </span>
                              <span className="tabular-nums text-sm font-bold text-text mt-0.5 block">
                                {item.cur !== null && item.cur !== undefined
                                  ? `${item.cur}%`
                                  : "—"}
                              </span>
                            </div>

                            <div className="text-right">
                              {delta !== null ? (
                                <span
                                  className={`tabular-nums text-xs font-semibold inline-flex items-center ${
                                    delta > 0
                                      ? "text-bullish"
                                      : delta < 0
                                      ? "text-bearish"
                                      : "text-text-secondary"
                                  }`}
                                >
                                  {delta > 0 ? (
                                    <TrendingUp size={13} className="mr-0.5" />
                                  ) : delta < 0 ? (
                                    <TrendingDown size={13} className="mr-0.5" />
                                  ) : null}
                                  {delta > 0 ? `+${delta}%` : `${delta}%`}
                                </span>
                              ) : (
                                <span className="text-text-muted text-xs">—</span>
                              )}
                              <span className="block text-xs text-text-secondary">
                                vs prior quarter
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center text-text-secondary text-xs">
                    Shareholding pattern not reported for this symbol.
                  </div>
                )}
              </div>
            )}

            {/* ── Footer ──────────────────────────────────────── */}
            <div className="pt-2 border-t border-border/60 text-xs text-text-secondary flex items-center justify-between">
              <span>
                As of {data.generated_at || "latest"}. Source:{" "}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Tapetide ↗
                </a>
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
