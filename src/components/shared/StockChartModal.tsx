"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
} from "lightweight-charts";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { detectPatterns } from "@/lib/patterns";
import { PatternSeriesPrimitive } from "@/components/charts/patternLayers";

export interface ChartStockItem {
  token: number;
  symbol: string;
  name?: string | null;
  industry?: string | null;
  industryRank?: number | null;
  close?: number | null;
  ret1dPct?: number | null;
  source?: "industry" | "search";
}

interface CandlePoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume?: number | null;
}

function computeSmaSeries(candles: CandlePoint[], period: number) {
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({ time: candles[i].date, value: sum / period });
    }
  }
  return out;
}

export default function StockChartModal({
  stock,
  items,
  onSelectStock,
  onClose,
}: {
  stock: ChartStockItem;
  items?: ChartStockItem[];
  onSelectStock?: (next: ChartStockItem) => void;
  onClose: () => void;
}) {
  const [range, setRange] = useState<"6M" | "1Y">("6M");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [candles, setCandles] = useState<CandlePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("chart_range");
      if (saved === "6M" || saved === "1Y") setRange(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const handleRangeChange = (next: "6M" | "1Y") => {
    setRange(next);
    try {
      window.localStorage.setItem("chart_range", next);
    } catch {
      /* ignore */
    }
  };

  const currentIdx = useMemo(() => {
    if (!items || items.length <= 1) return -1;
    return items.findIndex((x) => x.token === stock.token);
  }, [items, stock.token]);

  const canPrev = currentIdx > 0;
  const canNext = currentIdx >= 0 && items !== undefined && currentIdx < items.length - 1;

  const goPrev = useCallback(() => {
    if (canPrev && items && onSelectStock) onSelectStock(items[currentIdx - 1]);
  }, [canPrev, items, currentIdx, onSelectStock]);

  const goNext = useCallback(() => {
    if (canNext && items && onSelectStock) onSelectStock(items[currentIdx + 1]);
  }, [canNext, items, currentIdx, onSelectStock]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && modalRef.current?.requestFullscreen) {
        await modalRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        setIsFullscreen((v) => !v);
      }
    } catch {
      setIsFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else {
          onClose();
        }
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "ArrowRight") {
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, toggleFullscreen, goPrev, goNext]);

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const src = stock.source || "industry";
      const res = await fetch(
        `/api/terminal/screener/chart?token=${encodeURIComponent(String(stock.token))}&source=${encodeURIComponent(src)}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setCandles(Array.isArray(json.candles) ? json.candles : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load candles");
    } finally {
      setLoading(false);
    }
  }, [stock.token, stock.source]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  const slicedCandles = useMemo(() => {
    const bars = range === "1Y" ? 252 : 126;
    return candles.slice(-bars);
  }, [candles, range]);

  const activePatterns = useMemo(() => {
    if (slicedCandles.length < 30) return [];
    const normalized = slicedCandles.map((c) => ({
      date: c.date,
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close,
      volume: c.volume ?? undefined,
    }));
    const det = detectPatterns(normalized);
    return ((det?.patterns || []) as { id?: string; status?: string; label?: string; type?: string }[]).filter(
      (p) => p.status !== "historical"
    );
  }, [slicedCandles]);

  useEffect(() => {
    if (!chartContainerRef.current || slicedCandles.length === 0) return;

    const isDark = document.documentElement.classList.contains("dark");
    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: Math.max(320, container.clientHeight || 420),
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#18181B" : "#FFFFFF" },
        textColor: isDark ? "#A1A1AA" : "#52525B",
      },
      grid: {
        vertLines: { color: isDark ? "#27272A" : "#F4F4F5" },
        horzLines: { color: isDark ? "#27272A" : "#F4F4F5" },
      },
      rightPriceScale: { borderColor: isDark ? "#27272A" : "#E4E4E7" },
      timeScale: { borderColor: isDark ? "#27272A" : "#E4E4E7" },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isDark ? "#10B981" : "#047857",
      downColor: isDark ? "#F43F5E" : "#BE123C",
      wickUpColor: isDark ? "#10B981" : "#047857",
      wickDownColor: isDark ? "#F43F5E" : "#BE123C",
      borderVisible: false,
    });
    candleSeries.setData(
      slicedCandles.map((c) => ({
        time: c.date,
        open: c.open ?? c.close,
        high: c.high ?? c.close,
        low: c.low ?? c.close,
        close: c.close,
      }))
    );

    if (activePatterns.length > 0) {
      candleSeries.attachPrimitive(
        new PatternSeriesPrimitive({
          patterns: activePatterns,
          focusedPatternId: activePatterns[0]?.id,
          layers: { trendlines: true, labels: true, breakouts: true },
          isDark,
        })
      );
    }

    const volData = slicedCandles
      .filter((c) => typeof c.volume === "number" && c.volume >= 0)
      .map((c) => ({
        time: c.date,
        value: c.volume as number,
        color:
          (c.open ?? c.close) <= c.close
            ? isDark
              ? "rgba(16,185,129,0.28)"
              : "rgba(4,120,87,0.25)"
            : isDark
              ? "rgba(244,63,94,0.28)"
              : "rgba(190,18,60,0.25)",
      }));
    if (volData.length > 0) {
      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(volData);
    }

    const sma50 = computeSmaSeries(candles, 50).filter((p) => p.time >= slicedCandles[0].date);
    if (sma50.length > 0) {
      const s50 = chart.addSeries(LineSeries, { color: "#3B82F6", lineWidth: 1, priceLineVisible: false });
      s50.setData(sma50);
    }
    const sma200 = computeSmaSeries(candles, 200).filter((p) => p.time >= slicedCandles[0].date);
    if (sma200.length > 0) {
      const s200 = chart.addSeries(LineSeries, { color: "#D97706", lineWidth: 1, priceLineVisible: false });
      s200.setData(sma200);
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({
            width: entry.contentRect.width,
            height: Math.max(320, entry.contentRect.height || 420),
          });
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, slicedCandles, activePatterns]);

  const latestCandle = candles[candles.length - 1];
  const displayClose = stock.close ?? latestCandle?.close ?? null;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 bg-bg-page flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`${stock.symbol} chart`}
    >
      {/* Header & Toolbar */}
      <div className="px-4 py-3 border-b border-border bg-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-text">{stock.symbol}</h2>
            {stock.name && (
              <span className="text-sm text-text-secondary truncate max-w-[260px]">{stock.name}</span>
            )}
            {stock.industry && (
              <span className="px-2 py-0.5 rounded bg-bg-secondary border border-border text-xs text-text-secondary">
                {stock.industry}
                {stock.industryRank ? ` #${stock.industryRank}` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs tabular-nums">
            {displayClose !== null && (
              <span className="font-semibold text-text text-[13px]">
                ₹{displayClose.toFixed(2)}
              </span>
            )}
            {stock.ret1dPct !== null && stock.ret1dPct !== undefined && (
              <span className={stock.ret1dPct >= 0 ? "text-bullish font-semibold" : "text-bearish font-semibold"}>
                {stock.ret1dPct > 0 ? "+" : ""}
                {stock.ret1dPct.toFixed(2)}%
              </span>
            )}
            {activePatterns.length > 0 && (
              <span className="px-2 py-0.5 rounded bg-primary-subtle text-primary font-medium">
                {String((activePatterns[0] as { label?: string; type?: string }).label || (activePatterns[0] as { type?: string }).type)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {items && items.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrev}
                disabled={!canPrev}
                aria-label="Previous stock"
                className="p-1.5 rounded border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                aria-label="Next stock"
                className="p-1.5 rounded border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
            {(["6M", "1Y"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => handleRangeChange(r)}
                className={`px-2.5 py-1 font-medium cursor-pointer ${
                  range === r ? "bg-primary text-white" : "bg-surface text-text-secondary hover:text-text"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-surface text-xs font-medium text-text-secondary hover:text-text cursor-pointer"
            title="Toggle full screen (F)"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>F full screen</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close chart"
            className="p-1.5 rounded-md border border-border bg-surface text-text-secondary hover:text-text cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="flex-1 min-h-0 p-3 sm:p-4 flex flex-col gap-2">
        {candles.length > 0 && candles.length < 60 && (
          <div className="px-3 py-2 rounded-md bg-warning-bg text-warning text-xs">
            Only {candles.length} trading sessions available (new listing or limited stored history).
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-sm text-text-secondary">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Loading chart candles…</span>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-bearish">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchCandles}
              className="px-3 py-1.5 rounded border border-border bg-surface text-text text-xs font-medium cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : candles.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-text-secondary">
            No candle history stored for {stock.symbol}.
          </div>
        ) : (
          <div
            ref={chartContainerRef}
            className="flex-1 min-h-[340px] w-full rounded-lg border border-border bg-surface overflow-hidden"
          />
        )}
      </div>
    </div>
  );
}
