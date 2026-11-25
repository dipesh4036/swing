"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Search, X } from "lucide-react";
import {
  ConstituentStockRow,
  GroupConstituentsResponse,
  StrengthUniverse,
} from "@/lib/industry-types";
import { SectionCard } from "@/components/ui/card";

interface GroupDetailsProps {
  groupId: string;
  universe: StrengthUniverse;
  onClose: () => void;
  onSelectStock?: (stock: ConstituentStockRow) => void;
}

function fmtSigned(val: number | null, dec = 2) {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return <span className="text-text-muted">—</span>;
  }
  const cls = val > 0 ? "text-bullish font-medium" : val < 0 ? "text-bearish font-medium" : "text-text-secondary";
  return <span className={`tabular-nums ${cls}`}>{`${val > 0 ? "+" : ""}${val.toFixed(dec)}%`}</span>;
}

function emaPill(flag: boolean | null, label: string) {
  if (flag === null) {
    return (
      <span className="px-1.5 py-0.5 rounded-[4px] bg-bg-secondary text-text-muted text-[10px] tabular-nums" title="Insufficient history">
        {label}:—
      </span>
    );
  }
  return (
    <span
      className={`px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold tabular-nums ${
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
  onClose,
  onSelectStock,
}: GroupDetailsProps) {
  const [page, setPage] = useState(1);
  const [stockSearch, setStockSearch] = useState("");
  const [onlyAbove50, setOnlyAbove50] = useState(false);
  const [data, setData] = useState<GroupConstituentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setStockSearch("");
  }, [groupId, universe]);

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    fetch(
      `/api/industry-strength/${encodeURIComponent(groupId)}?page=${page}&limit=50&universe=${universe}`,
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
  }, [groupId, page, universe]);

  const filteredStocks = useMemo(() => {
    if (!data?.stocks) return [];
    const q = stockSearch.trim().toLowerCase();
    return data.stocks.filter((st) => {
      if (onlyAbove50 && st.above50dma !== true) return false;
      if (q && !st.symbol.toLowerCase().includes(q) && !st.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, stockSearch, onlyAbove50]);

  return (
    <SectionCard
      title={data ? `${data.group.label} (${data.totalCount} constituents)` : "Loading constituents..."}
      subtitle={data?.group.fullPath}
      info="Click any stock row to open full technical & price details"
      action={
        <div className="flex items-center gap-2">
          {data && (
            <Link
              href={`/screener?groupId=${encodeURIComponent(groupId)}&groupLabel=${encodeURIComponent(
                data.group.label
              )}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-primary-subtle border border-accent-border text-primary text-[11px] font-semibold hover:bg-bg-selected transition-colors"
            >
              <span>View in Screener</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close group details"
            className="p-1.5 rounded-[6px] border border-border text-text-muted hover:text-text hover:bg-bg-hover cursor-pointer transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      }
    >
      {loading && !data ? (
        <div className="py-10 flex items-center justify-center gap-2 text-xs text-text-muted">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>Loading constituents...</span>
        </div>
      ) : error ? (
        <div className="p-3 rounded-md bg-bearish-bg text-bearish text-xs">{error}</div>
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
                className="w-full h-7 pl-8 pr-3 text-[11px] rounded-[6px] bg-bg-secondary border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyAbove50((v) => !v)}
              className={`h-7 px-2.5 rounded-[6px] text-[11px] font-medium border cursor-pointer transition-colors ${
                onlyAbove50
                  ? "bg-bullish-bg border-bullish-border text-bullish"
                  : "bg-bg-secondary border-border text-text-secondary hover:text-text"
              }`}
            >
              Above 50 DMA only
            </button>
          </div>

          <div className="overflow-x-auto max-h-[420px] rounded-md border border-border">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-bg-secondary border-b border-border text-[11px] text-text-secondary uppercase tracking-[0.04em]">
                <tr>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-right">Close</th>
                  <th className="px-3 py-2 text-right">RS_STS</th>
                  <th className="px-3 py-2 text-right">RS Rank</th>
                  <th className="px-3 py-2 text-right">1D</th>
                  <th className="px-3 py-2 text-right">1W</th>
                  <th className="px-3 py-2 text-right">1M</th>
                  <th className="px-3 py-2 text-right">3M</th>
                  <th className="px-3 py-2 text-right">Off 52W</th>
                  <th className="px-3 py-2 text-right">ADR%</th>
                  <th className="px-3 py-2 text-center">EMAs</th>
                  <th className="px-3 py-2 text-right">Turnover (Cr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredStocks.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-text-muted text-xs">
                      No matching constituents on this page.
                    </td>
                  </tr>
                ) : (
                  filteredStocks.map((st) => (
                    <tr
                      key={st.token}
                      onClick={() => onSelectStock?.(st)}
                      className="hover:bg-bg-hover cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-text">{st.symbol}</span>
                          {st.isNewListing && (
                            <span className="px-1.5 py-0.5 rounded-[4px] bg-warning-bg text-warning text-[10px] font-semibold">
                              IPO ({st.listingSessions}d)
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-text-muted truncate max-w-[180px]">
                          {st.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text">
                        {st.close !== null ? `₹${st.close.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text">
                        {st.rsSts !== null ? `${st.rsSts.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {st.rsRating !== null ? st.rsRating : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtSigned(st.ret1d)}</td>
                      <td className="px-3 py-2 text-right">{fmtSigned(st.ret1w)}</td>
                      <td className="px-3 py-2 text-right">{fmtSigned(st.ret1m)}</td>
                      <td className="px-3 py-2 text-right">{fmtSigned(st.ret3m)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {st.pctFrom52wHigh !== null ? `${st.pctFrom52wHigh.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {st.adrPct !== null ? `${st.adrPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          {emaPill(st.above20ema, "20")}
                          {emaPill(st.above50dma, "50")}
                          {emaPill(st.above200dma, "200")}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {st.avgTurnoverCr !== null ? `₹${st.avgTurnoverCr.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between text-[11px] text-text-secondary pt-1">
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
  );
}
