"use client";

import React, { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

export default function FundamentalsPanel({ symbol }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [errorReason, setErrorReason] = useState(null);

  useEffect(() => {
    if (!expanded || !symbol) {
      return;
    }

    const controller = new AbortController();
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
          setErrorReason("upstream_error");
          setLoading(false);
          return;
        }

        const json = await res.json();
        if (json.available) {
          setData(json);
          setErrorReason(null);
        } else {
          setData(null);
          setErrorReason(json.reason || "upstream_error");
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setErrorReason("upstream_error");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchFundamentals();

    return () => {
      controller.abort();
    };
  }, [expanded, symbol]);

  if (!symbol) {
    return null;
  }

  const sourceUrl =
    data?.source_url || `https://tapetide.com/stocks/${encodeURIComponent(symbol)}`;

  const getReasonMessage = (reason) => {
    switch (reason) {
      case "not_found":
        return "Fundamentals not found for this symbol on Tapetide.";
      case "rate_limited":
        return "Rate limit reached. Please try again in a few moments.";
      case "timeout":
        return "Request to Tapetide timed out.";
      case "parse_error":
        return "Unable to parse fundamentals data from Tapetide.";
      default:
        return "Unable to load fundamentals from Tapetide.";
    }
  };

  return (
    <div className="border-t border-border bg-surface shrink-0 flex flex-col text-xs text-text transition-all">
      {/* Header / Collapse Toggle */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 hover:bg-bg-hover cursor-pointer select-none">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-2 font-semibold text-text text-left flex-1"
        >
          {expanded ? (
            <ChevronDown size={15} className="text-text-muted" />
          ) : (
            <ChevronRight size={15} className="text-text-muted" />
          )}
          <span>Fundamentals</span>
          <span className="text-[10px] font-normal text-text-muted">
            (Tapetide · {symbol})
          </span>
        </button>

        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open fundamentals on Tapetide (external)"
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-primary transition-colors ml-2"
        >
          <span>Tapetide</span>
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="p-3 max-h-[360px] overflow-y-auto space-y-4">
          {loading ? (
            /* Skeleton Loading State */
            <div className="space-y-3 animate-pulse py-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 bg-bg-secondary rounded p-2" />
                ))}
              </div>
              <div className="h-20 bg-bg-secondary rounded" />
              <div className="h-24 bg-bg-secondary rounded" />
            </div>
          ) : errorReason ? (
            /* Failure / Error Fallback Card */
            <div className="flex items-center justify-between p-3 rounded bg-bg-secondary border border-border text-xs">
              <div className="flex items-center gap-2 text-text-secondary">
                <AlertCircle size={15} className="text-warning shrink-0" />
                <span>{getReasonMessage(errorReason)}</span>
              </div>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline font-medium shrink-0 ml-3"
              >
                <span>View on Tapetide</span>
                <ExternalLink size={12} />
              </a>
            </div>
          ) : data ? (
            <>
              {/* 1. Snapshot Grid */}
              {data.snapshot && data.snapshot.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Key Snapshot
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {data.snapshot.map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-bg-secondary/40 border border-border/80 rounded px-2.5 py-1.5 flex flex-col justify-center"
                      >
                        <span className="text-[10px] text-text-muted truncate">
                          {item.label}
                        </span>
                        <span className="font-mono text-xs font-semibold text-text mt-0.5 truncate">
                          {item.value_text || "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Growth Rates */}
              {data.growth && data.growth.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Growth Rates
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                    {data.growth.map((g, idx) => {
                      const isPos = g.value_num !== null && g.value_num > 0;
                      const isNeg = g.value_num !== null && g.value_num < 0;
                      return (
                        <div
                          key={idx}
                          className="bg-bg-secondary/40 border border-border/80 rounded px-2.5 py-1.5 flex flex-col justify-center"
                        >
                          <span className="text-[10px] text-text-muted truncate">
                            {g.label} ({g.period})
                          </span>
                          <span
                            className={`font-mono text-xs font-semibold mt-0.5 truncate ${
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

              {/* 3. Quarterly Results Mini-Table */}
              {data.quarters && data.quarters.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Quarterly Results (₹ Cr)
                  </div>
                  <div className="overflow-x-auto border border-border/80 rounded bg-bg-secondary/20">
                    <table className="w-full text-left font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-border bg-bg-secondary/60 text-text-muted text-[10px]">
                          <th className="py-1 px-2.5 font-medium">Period</th>
                          <th className="py-1 px-2.5 font-medium text-right">Sales</th>
                          <th className="py-1 px-2.5 font-medium text-right">Net Profit</th>
                          <th className="py-1 px-2.5 font-medium text-right">OPM %</th>
                          <th className="py-1 px-2.5 font-medium text-right">EPS (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {data.quarters.map((q, idx) => (
                          <tr key={idx} className="hover:bg-bg-hover/40">
                            <td className="py-1 px-2.5 text-text font-medium">
                              {q.period || "—"}
                            </td>
                            <td className="py-1 px-2.5 text-right text-text">
                              {q.sales !== null && q.sales !== undefined ? q.sales : "—"}
                            </td>
                            <td className="py-1 px-2.5 text-right text-text">
                              {q.net_profit !== null && q.net_profit !== undefined
                                ? q.net_profit
                                : "—"}
                            </td>
                            <td className="py-1 px-2.5 text-right text-text">
                              {q.opm !== null && q.opm !== undefined ? `${q.opm}%` : "—"}
                            </td>
                            <td className="py-1 px-2.5 text-right text-text">
                              {q.eps !== null && q.eps !== undefined ? q.eps : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 4. Shareholding Pattern (Latest vs Previous with deltas) */}
              {data.shareholding?.latest && (
                <div>
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Shareholding Pattern ({data.shareholding.latest.period || "Latest"}
                    {data.shareholding.previous?.period
                      ? ` vs ${data.shareholding.previous.period}`
                      : ""}
                    )
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      {
                        label: "Promoters",
                        cur: data.shareholding.latest.promoters,
                        prev: data.shareholding.previous?.promoters,
                      },
                      {
                        label: "FIIs",
                        cur: data.shareholding.latest.fii,
                        prev: data.shareholding.previous?.fii,
                      },
                      {
                        label: "DIIs",
                        cur: data.shareholding.latest.dii,
                        prev: data.shareholding.previous?.dii,
                      },
                      {
                        label: "Public",
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
                          className="bg-bg-secondary/40 border border-border/80 rounded px-2.5 py-1.5 flex flex-col justify-center"
                        >
                          <span className="text-[10px] text-text-muted truncate">
                            {item.label}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5 font-mono text-xs font-semibold">
                            <span>
                              {item.cur !== null && item.cur !== undefined
                                ? `${item.cur}%`
                                : "—"}
                            </span>
                            {delta !== null && delta !== 0 && (
                              <span
                                className={`text-[10px] flex items-center ${
                                  delta > 0 ? "text-bullish" : "text-bearish"
                                }`}
                              >
                                {delta > 0 ? (
                                  <TrendingUp size={11} className="mr-0.5" />
                                ) : (
                                  <TrendingDown size={11} className="mr-0.5" />
                                )}
                                {delta > 0 ? `+${delta}%` : `${delta}%`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 5. Key Insights: Strengths & Weaknesses */}
              {((data.strengths && data.strengths.length > 0) ||
                (data.weaknesses && data.weaknesses.length > 0)) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Strengths */}
                  {data.strengths && data.strengths.length > 0 && (
                    <div className="border border-border/80 rounded p-2.5 bg-bg-secondary/20">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-bullish mb-1.5">
                        <ShieldCheck size={13} />
                        <span>Strengths</span>
                      </div>
                      <ul className="space-y-1 text-[11px] text-text-secondary list-disc pl-4">
                        {data.strengths.map((str, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {str}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Weaknesses */}
                  {data.weaknesses && data.weaknesses.length > 0 && (
                    <div className="border border-border/80 rounded p-2.5 bg-bg-secondary/20">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-bearish mb-1.5">
                        <ShieldAlert size={13} />
                        <span>Weaknesses</span>
                      </div>
                      <ul className="space-y-1 text-[11px] text-text-secondary list-disc pl-4">
                        {data.weaknesses.map((wk, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {wk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* 6. Technical Signals Summary */}
              {data.signals && (
                <div>
                  <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Technical Signals Summary
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {data.signals.overall && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-primary-subtle text-primary border border-primary/30">
                        Overall: {data.signals.overall}
                      </span>
                    )}
                    {data.signals.bullish !== undefined && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-bullish-bg text-bullish border border-bullish-border">
                        Bullish: {data.signals.bullish}
                      </span>
                    )}
                    {data.signals.neutral !== undefined && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-neutral-bg text-text-secondary border border-border">
                        Neutral: {data.signals.neutral}
                      </span>
                    )}
                    {data.signals.bearish !== undefined && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-bearish-bg text-bearish border border-bearish-border">
                        Bearish: {data.signals.bearish}
                      </span>
                    )}
                    {data.signals.oscillators && (
                      <span className="px-2 py-0.5 rounded text-[11px] text-text-muted border border-border">
                        Oscillators: {data.signals.oscillators}
                      </span>
                    )}
                    {data.signals.moving_averages && (
                      <span className="px-2 py-0.5 rounded text-[11px] text-text-muted border border-border">
                        MAs: {data.signals.moving_averages}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="pt-2 border-t border-border/60 text-[10px] text-text-muted flex items-center justify-between">
                <span>
                  As of {data.generated_at || "latest"}. Source:{" "}
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    Tapetide ↗
                  </a>{" "}
                  (third-party, not verified by this dashboard)
                </span>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

