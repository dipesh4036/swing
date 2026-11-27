"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { StockSearchResult } from "@/lib/stock-search";
import StockChartModal, { ChartStockItem } from "./StockChartModal";

export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el.isContentEditable);
}

export default function GlobalSearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedStock, setSelectedStock] = useState<ChartStockItem | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stock-search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setResults(Array.isArray(json.results) ? json.results : []);
        setActiveIdx(0);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, open]);

  const handleSelect = (item: StockSearchResult) => {
    onOpenChange(false);
    setSelectedStock({
      token: item.token,
      symbol: item.symbol,
      name: item.name,
      industry: item.industry,
      industryRank: item.industryRank,
      close: item.close,
      ret1dPct: item.ret1dPct,
      source: "search",
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (results.length > 0 ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (results.length > 0 ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[activeIdx]) {
      e.preventDefault();
      handleSelect(results[activeIdx]);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-3 bg-black/45"
          role="dialog"
          aria-modal="true"
          aria-label="Global stock search"
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <div className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
              <Search className="w-4 h-4 text-text-secondary shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search NSE liquid stocks by symbol or name..."
                aria-label="Search NSE liquid stocks"
                maxLength={30}
                className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close search"
                className="p-1 rounded text-text-secondary hover:text-text cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-border-subtle">
              {loading && (
                <div className="px-4 py-3 text-xs text-text-secondary">Searching…</div>
              )}
              {error && (
                <div className="px-4 py-3 text-xs text-bearish">{error}</div>
              )}
              {!loading && !error && query.trim() && results.length === 0 && (
                <div className="px-4 py-4 text-xs text-text-secondary">
                  No liquid stocks match &ldquo;{query.trim()}&rdquo;.
                </div>
              )}
              {!loading &&
                results.map((item, idx) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => handleSelect(item)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer ${
                      idx === activeIdx ? "bg-bg-selected" : "hover:bg-bg-hover"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">{item.symbol}</span>
                        {item.industry && (
                          <span className="text-xs text-text-secondary truncate">
                            {item.industry}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-secondary truncate">{item.name}</div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-[13px] font-semibold text-text">
                        {item.close !== null ? `₹${item.close.toFixed(2)}` : ""}
                      </div>
                      {item.ret1dPct !== null && (
                        <div
                          className={`text-xs font-medium ${
                            item.ret1dPct > 0
                              ? "text-bullish"
                              : item.ret1dPct < 0
                                ? "text-bearish"
                                : "text-text-secondary"
                          }`}
                        >
                          {item.ret1dPct > 0 ? "+" : ""}
                          {item.ret1dPct.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </button>
                ))}
            </div>

            <div className="px-3.5 py-2 bg-bg-secondary border-t border-border flex items-center justify-between text-xs text-text-secondary">
              <span>&uarr;&darr; navigate &middot; Enter open chart</span>
              <span>Esc close</span>
            </div>
          </div>
        </div>
      )}

      {selectedStock && (
        <StockChartModal
          stock={selectedStock}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </>
  );
}
