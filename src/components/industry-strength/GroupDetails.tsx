"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import {
  ConstituentStockRow,
  GroupConstituentsResponse,
  StrengthUniverse,
} from "@/lib/industry-types";
import { formatPriceInr, formatSignedPct, formatUnsignedPct } from "@/lib/industry-formatters";
import { SectionCard } from "@/components/ui/card";

interface GroupDetailsProps {
  groupId: string;
  universe: StrengthUniverse;
  groupRank?: number | null;
  groupRankChange?: number | null;
  onClose: () => void;
  onSelectStock?: (stock: ConstituentStockRow) => void;
}

function signedCls(val: number | null) {
  if (val === null || val === undefined || !Number.isFinite(val)) return "text-text-secondary";
  return val > 0 ? "text-bullish font-medium" : val < 0 ? "text-bearish font-medium" : "text-text-secondary";
}

function emaPill(flag: boolean | null, label: string) {
  if (flag === null) {
    return (
      <span className="px-1.5 py-0.5 rounded-[4px] bg-bg-secondary text-text-secondary text-xs tabular-nums">
        {label}:—
      </span>
    );
  }
  return (
    <span
      className={`px-1.5 py-0.5 rounded-[4px] text-xs font-semibold tabular-nums ${
        flag ? "bg-bullish-bg text-bullish" : "bg-bearish-bg text-bearish"
      }`}
    >
      {label}
    </span>
  );
}

export default function GroupDetails({
  groupId,
  universe,
  groupRank,
  groupRankChange,
  onClose,
  onSelectStock,
}: GroupDetailsProps) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("rs_sts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [stockSearch, setStockSearch] = useState("");
  const [onlyAbove50, setOnlyAbove50] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [data, setData] = useState<GroupConstituentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setStockSearch("");
  }, [groupId, universe]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(
      `/api/industry-strength/${encodeURIComponent(groupId)}?page=${page}&limit=50&universe=${universe}&sortBy=${sortBy}&sortDir=${sortDir}`,
      { signal: ctrl.signal }
    )
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (active && json) setData(json);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") {
          setError(err.message || "Failed to load constituents");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [groupId, page, universe, sortBy, sortDir, reloadTick]);

  const filteredStocks = useMemo(() => {
    if (!data?.stocks) return [];
    const q = stockSearch.trim().toLowerCase();
    return data.stocks.filter((st) => {
      if (onlyAbove50 && st.above50dma !== true) return false;
      if (q && !st.symbol.toLowerCase().includes(q) && !st.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, stockSearch, onlyAbove50]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "symbol" ? "asc" : "desc");
    }
  };

  const buildCsvRows = () => {
    const header = ["Symbol", "Name", "Close", "RS_STS", "RS_Rank", "1D%", "1W%", "1M%", "3M%", "20H", "Turnover_Cr"];
    const lines = [header.join(",")];
    for (const st of filteredStocks) {
      lines.push(
        [
          st.symbol,
          `"${(st.name || "").replace(/"/g, '""')}"`,
          st.close ?? "",
          st.rsSts ?? "",
          st.rsRating ?? "",
          st.ret1d ?? "",
          st.ret1w ?? "",
          st.ret1m ?? "",
          st.ret3m ?? "",
          st.at20dHigh ? "20H" : "",
          st.avgTurnoverCr ?? "",
        ].join(",")
      );
    }
    return lines.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filteredStocks.map((s) => s.symbol).join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore clipboard denial */
    }
  };

  const handleDownloadCsv = () => {
    const blob = new Blob([buildCsvRows()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data?.group.label || groupId).replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_stocks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rankTag =
    groupRank != null
      ? ` · Rank #${groupRank}${
          groupRankChange != null && groupRankChange !== 0
            ? ` (${groupRankChange > 0 ? `+${groupRankChange}` : groupRankChange})`
            : ""
        }`
      : "";

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label={data ? `${data.group.label} details` : "Group details"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full h-full lg:w-[580px] bg-bg-page overflow-y-auto p-3 sm:p-4 border-l border-border shadow-2xl">
        <SectionCard
        title={data ? `${data.group.label} (${data.totalCount} stocks)${rankTag}` : "Loading group..."}
        subtitle={data?.group.fullPath}
        info="Sorted by RS strongest first. Click any stock row for price chart & technicals."
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {data && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border border-border bg-surface text-text-secondary hover:text-text text-xs font-medium cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-bullish" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border border-border bg-surface text-text-secondary hover:text-text text-xs font-medium cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>CSV</span>
                </button>
                <Link
                  href={`/screener?groupId=${encodeURIComponent(groupId)}&groupLabel=${encodeURIComponent(
                    data.group.label
                  )}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-primary-subtle border border-accent-border text-primary dark:text-indigo-300 text-xs font-semibold hover:bg-bg-selected"
                >
                  <span>Screener</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close group details"
              className="p-1.5 rounded-[6px] border border-border text-text-secondary hover:text-text hover:bg-bg-hover cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        }
      >
        {loading && !data ? (
          <div className="space-y-2 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 rounded bg-bg-secondary border border-border-subtle" />
            ))}
          </div>
        ) : error ? (
          <div className="p-4 rounded-md bg-bearish-bg text-bearish text-xs flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface border border-border text-text font-medium cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        ) : data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Filter symbol or name..."
                  className="w-full h-7 pl-8 pr-3 text-xs rounded-[6px] bg-bg-secondary border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyAbove50((v) => !v)}
                className={`h-7 px-2.5 rounded-[6px] text-xs font-medium border cursor-pointer ${
                  onlyAbove50
                    ? "bg-bullish-bg border-bullish-border text-bullish"
                    : "bg-bg-secondary border-border text-text-secondary hover:text-text"
                }`}
              >
                Above 50 SMA only
              </button>
            </div>

            <div className="overflow-x-auto max-h-[420px] rounded-md border border-border">
              <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 bg-bg-secondary border-b border-border text-xs text-text-secondary uppercase tracking-[0.04em]">
                  <tr>
                    <th onClick={() => handleSort("symbol")} className="px-3 py-2 text-left cursor-pointer hover:text-text">Symbol</th>
                    <th className="px-3 py-2 text-right">Close</th>
                    <th onClick={() => handleSort("rs_sts")} className="px-3 py-2 text-right cursor-pointer hover:text-text">RS_STS</th>
                    <th onClick={() => handleSort("rs_rating")} className="px-3 py-2 text-right cursor-pointer hover:text-text">RS Rank</th>
                    <th onClick={() => handleSort("ret_1d")} className="px-3 py-2 text-right cursor-pointer hover:text-text">1D</th>
                    <th onClick={() => handleSort("ret_1w")} className="px-3 py-2 text-right cursor-pointer hover:text-text">1W</th>
                    <th onClick={() => handleSort("ret_1m")} className="px-3 py-2 text-right cursor-pointer hover:text-text">1M</th>
                    <th onClick={() => handleSort("ret_3m")} className="px-3 py-2 text-right cursor-pointer hover:text-text">3M</th>
                    <th onClick={() => handleSort("pct_from_52w_high")} className="px-3 py-2 text-right cursor-pointer hover:text-text">Off 52W</th>
                    <th onClick={() => handleSort("adr_pct")} className="px-3 py-2 text-right cursor-pointer hover:text-text">ADR%</th>
                    <th className="px-3 py-2 text-center">EMAs</th>
                    <th onClick={() => handleSort("avg_turnover_cr")} className="px-3 py-2 text-right cursor-pointer hover:text-text">Turnover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {filteredStocks.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-text-secondary text-xs">
                        {data.stocks.length === 0
                          ? "No active constituents for this universe filter."
                          : "No constituents match your search or SMA filter."}
                      </td>
                    </tr>
                  ) : (
                    filteredStocks.map((st) => (
                      <tr
                        key={st.token}
                        onClick={() => onSelectStock?.(st)}
                        className="hover:bg-bg-hover cursor-pointer"
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-text">{st.symbol}</span>
                            {st.at20dHigh && (
                              <span className="px-1.5 py-0.2 rounded-[4px] bg-bullish-bg text-bullish text-xs font-semibold">
                                20H
                              </span>
                            )}
                            {st.isNewListing && (
                              <span className="px-1.5 py-0.2 rounded-[4px] bg-warning-bg text-warning text-xs font-semibold">
                                IPO ({st.listingSessions}d)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-secondary truncate max-w-[180px]">
                            {st.name}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text">
                          {formatPriceInr(st.close)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text">
                          {formatUnsignedPct(st.rsSts, 1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {st.rsRating !== null ? st.rsRating : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${signedCls(st.ret1d)}`}>
                          {formatSignedPct(st.ret1d, 2)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${signedCls(st.ret1w)}`}>
                          {formatSignedPct(st.ret1w, 2)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${signedCls(st.ret1m)}`}>
                          {formatSignedPct(st.ret1m, 2)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${signedCls(st.ret3m)}`}>
                          {formatSignedPct(st.ret3m, 2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {formatUnsignedPct(st.pctFrom52wHigh, 1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {formatUnsignedPct(st.adrPct, 1)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            {emaPill(st.above20ema, "20")}
                            {emaPill(st.above50dma, "50")}
                            {emaPill(st.above200dma, "200")}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {st.avgTurnoverCr !== null ? `₹${st.avgTurnoverCr.toFixed(1)} Cr` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {data.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-text-secondary pt-1">
                <span className="tabular-nums">
                  Page {data.page} of {data.totalPages} ({data.totalCount} total)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-[6px] border border-border disabled:opacity-40 hover:bg-bg-hover cursor-pointer"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={data.page >= data.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2.5 py-1 rounded-[6px] border border-border disabled:opacity-40 hover:bg-bg-hover cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SectionCard>
      </div>
    </div>
  );
}
