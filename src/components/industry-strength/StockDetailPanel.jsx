"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { X, ExternalLink, RefreshCw, Star } from "lucide-react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
} from "lightweight-charts";
import { detectPatterns } from "@/lib/patterns";
import { PatternSeriesPrimitive } from "@/components/charts/patternLayers";
import { PatternLayersBar } from "@/components/charts/PatternLayersBar";
import { PatternDetailPanel as PatternDetailView } from "@/components/charts/PatternDetailPanel";

/**
 * StockDetailPanel: Side drawer / bottom sheet for selected sector stock (T10.6)
 */
export function StockDetailPanel({
  stock,
  onClose,
  onShowSector,
  source = "sector",
  isDark = false,
}) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [chartCandles, setChartCandles] = useState([]);

  // Auto Chart Pattern Layer States
  const [focusedPatternId, setFocusedPatternId] = useState(null);
  const [patternLayers, setPatternLayers] = useState({
    patternLines: true,
    breakoutRetest: true,
    basePivot: true,
    ema_21: false,
  });

  const patternResult = useMemo(() => {
    if (!chartCandles || chartCandles.length === 0) {
      return { patterns: [], reason: "insufficient_history" };
    }
    return detectPatterns(chartCandles);
  }, [chartCandles]);

  const activePatterns = useMemo(() => {
    return patternResult.patterns.slice(0, 3);
  }, [patternResult.patterns]);

  const patternCounts = useMemo(() => {
    return {
      patternLines: activePatterns.reduce((acc, p) => acc + (p.lines?.length || 1), 0),
      breakoutRetest: activePatterns.reduce((acc, p) => acc + (p.events?.length || 0), 0),
      basePivot: activePatterns.filter((p) => p.type === "base_pivot").length,
    };
  }, [activePatterns]);

  // Close on Esc key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Fetch candles for sector stock
  useEffect(() => {
    if (!stock?.token) return;
    let isCancelled = false;

    async function loadCandles() {
      setLoadingChart(true);
      setChartError(null);
      try {
        const res = await fetch(
          `/api/terminal/screener/chart?token=${stock.token}&source=${encodeURIComponent(source)}`
        );
        if (!res.ok) {
          if (res.status === 404) {
            setChartError("Chart unavailable");
          } else {
            setChartError("Failed to load chart");
          }
          setChartCandles([]);
          return;
        }
        const data = await res.json();
        if (!isCancelled) {
          setChartCandles(data.candles || []);
        }
      } catch (err) {
        if (!isCancelled) {
          setChartError("Chart unavailable");
          setChartCandles([]);
        }
      } finally {
        if (!isCancelled) {
          setLoadingChart(false);
        }
      }
    }

    loadCandles();
    return () => {
      isCancelled = true;
    };
  }, [stock?.token, source]);

  // Render lightweight-chart
  useEffect(() => {
    if (!chartContainerRef.current || chartCandles.length === 0) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 360,
      height: 220,
      layout: {
        background: { color: isDark ? "#18181B" : "#FFFFFF" },
        textColor: isDark ? "#A1A1AA" : "#71717A",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: isDark ? "#27272A" : "#F4F4F5" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: isDark ? "#27272A" : "#E4E4E7" },
      timeScale: { borderColor: isDark ? "#27272A" : "#E4E4E7" },
    });
    chartInstanceRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isDark ? "#10B981" : "#059669",
      downColor: isDark ? "#F43F5E" : "#E11D48",
      wickUpColor: isDark ? "#10B981" : "#059669",
      wickDownColor: isDark ? "#F43F5E" : "#E11D48",
      borderVisible: false,
    });
    candleSeries.setData(
      chartCandles.map((c) => ({
        time: c.date,
        open: c.open ?? c.close,
        high: c.high ?? c.close,
        low: c.low ?? c.close,
        close: c.close,
      }))
    );

    // Auto Chart Pattern Series Primitive
    if (activePatterns.length > 0) {
      const patternPrimitive = new PatternSeriesPrimitive({
        patterns: activePatterns,
        focusedPatternId: focusedPatternId || activePatterns[0]?.id,
        layers: patternLayers,
        isDark,
      });
      candleSeries.attachPrimitive(patternPrimitive);
    }

    // EMAs 20 & 50
    const addLine = (key, color) => {
      const data = chartCandles
        .filter((c) => typeof c[key] === "number" && !isNaN(c[key]))
        .map((c) => ({ time: c.date, value: c[key] }));
      if (data.length > 0) {
        const line = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false });
        line.setData(data);
      }
    };
    addLine("ema_20", "#3B82F6");
    addLine("ema_50", "#EAB308");

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && chartInstanceRef.current) {
          chartInstanceRef.current.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [chartCandles, isDark, activePatterns, focusedPatternId, patternLayers]);

  const [isExpandedFull, setIsExpandedFull] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (isExpandedFull) setIsExpandedFull(false);
        else onClose?.();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsExpandedFull((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpandedFull, onClose]);

  if (!stock) return null;

  const hasScreenerHits = stock.screeners && stock.screeners.length > 0;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-50 bg-surface border-l border-border shadow-2xl flex flex-col overflow-y-auto ${
        isExpandedFull ? "inset-0 w-full" : "w-full sm:w-[520px]"
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-border bg-bg-secondary/40 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text">{stock.symbol}</h2>
            {stock.leader && (
              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-xs bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300">
                <Star size={10} className="fill-amber-400" />
                <span>Sector Leader</span>
              </span>
            )}
            {!stock.in_universe && (
              <span className="text-xs text-text-secondary italic">(illiquid)</span>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5">{stock.name}</p>
          <div className="text-xs tabular-nums text-text-secondary mt-1">
            Sector: <strong className="text-text">{stock.sector}</strong>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsExpandedFull((v) => !v)}
            className="px-2 py-1 rounded border border-border text-xs font-medium text-text-secondary hover:text-text hover:bg-bg-hover cursor-pointer"
            title="Toggle full screen (F)"
          >
            {isExpandedFull ? "Exit full screen" : "F full screen"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-secondary hover:text-text hover:bg-bg-hover transition-colors"
            title="Close panel (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="p-4 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2 rounded bg-bg-secondary border border-border flex flex-col">
          <span className="text-text-secondary text-xs">Close</span>
          <span className="font-bold tabular-nums text-sm">₹{stock.close ?? "—"}</span>
        </div>
        <div className="p-2 rounded bg-bg-secondary border border-border flex flex-col">
          <span className="text-text-secondary text-xs">RS Rank</span>
          <span className="font-bold tabular-nums text-sm text-primary">{stock.rs_rank ?? "—"}</span>
        </div>
        <div className="p-2 rounded bg-bg-secondary border border-border flex flex-col">
          <span className="text-text-secondary text-xs">Stage</span>
          <span className="font-bold tabular-nums text-sm">{stock.stage ? `S${stock.stage}` : "—"}</span>
        </div>
        <div className="p-2 rounded bg-bg-secondary border border-border flex flex-col">
          <span className="text-text-secondary text-xs">Vol Ratio</span>
          <span className="font-bold tabular-nums text-sm">{stock.vol_ratio != null ? `${stock.vol_ratio}x` : "—"}</span>
        </div>
      </div>

      {/* Multi-Window Returns */}
      <div className="p-4 border-b border-border">
        <span className="text-xs font-semibold text-text uppercase tracking-wider block mb-2">
          Returns
        </span>
        <div className="grid grid-cols-5 gap-1.5 text-center tabular-nums text-xs">
          <div className="p-1.5 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary text-xs block">1D</span>
            <span className={stock.ret_1d >= 0 ? "text-bullish font-medium" : "text-bearish font-medium"}>
              {stock.ret_1d != null ? `${stock.ret_1d >= 0 ? "+" : ""}${stock.ret_1d}%` : "—"}
            </span>
          </div>
          <div className="p-1.5 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary text-xs block">1W</span>
            <span className={stock.ret_1w >= 0 ? "text-bullish font-medium" : "text-bearish font-medium"}>
              {stock.ret_1w != null ? `${stock.ret_1w >= 0 ? "+" : ""}${stock.ret_1w}%` : "—"}
            </span>
          </div>
          <div className="p-1.5 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary text-xs block">1M</span>
            <span className={stock.ret_1m >= 0 ? "text-bullish font-medium" : "text-bearish font-medium"}>
              {stock.ret_1m != null ? `${stock.ret_1m >= 0 ? "+" : ""}${stock.ret_1m}%` : "—"}
            </span>
          </div>
          <div className="p-1.5 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary text-xs block">3M</span>
            <span className={stock.ret_3m >= 0 ? "text-bullish font-medium" : "text-bearish font-medium"}>
              {stock.ret_3m != null ? `${stock.ret_3m >= 0 ? "+" : ""}${stock.ret_3m}%` : "—"}
            </span>
          </div>
          <div className="p-1.5 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary text-xs block">6M</span>
            <span className={stock.ret_6m >= 0 ? "text-bullish font-medium" : "text-bearish font-medium"}>
              {stock.ret_6m != null ? `${stock.ret_6m >= 0 ? "+" : ""}${stock.ret_6m}%` : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Moving Averages & 52w High */}
      <div className="p-4 border-b border-border">
        <span className="text-xs font-semibold text-text uppercase tracking-wider block mb-2">
          Trend Indicators
        </span>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary">From 52W High:</span>
            <span className="tabular-nums font-medium">{stock.pct_from_52w_high != null ? `${stock.pct_from_52w_high}%` : "—"}</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary">vs 20 EMA:</span>
            <span className={`tabular-nums font-medium ${stock.above_20ema ? "text-bullish" : "text-bearish"}`}>
              {stock.above_20ema === true ? "▲ Above" : stock.above_20ema === false ? "▼ Below" : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary">vs 50 DMA:</span>
            <span className={`tabular-nums font-medium ${stock.above_50dma ? "text-bullish" : "text-bearish"}`}>
              {stock.above_50dma === true ? "▲ Above" : stock.above_50dma === false ? "▼ Below" : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-bg-secondary border border-border">
            <span className="text-text-secondary">vs 200 DMA:</span>
            <span className={`tabular-nums font-medium ${stock.above_200dma ? "text-bullish" : "text-bearish"}`}>
              {stock.above_200dma === true ? "▲ Above" : stock.above_200dma === false ? "▼ Below" : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Screener Tags */}
      {hasScreenerHits && (
        <div className="p-4 border-b border-border">
          <span className="text-xs font-semibold text-text uppercase tracking-wider block mb-2">
            Active Screener Setups
          </span>
          <div className="flex flex-wrap gap-1.5">
            {stock.screeners.map((scr) => (
              <span
                key={scr}
                className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary tabular-nums border border-primary/20"
              >
                {scr.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Chart Section */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text uppercase tracking-wider block">
            Daily Price Chart
          </span>
          {chartCandles.length > 0 && chartCandles.length < 60 && (
            <span className="text-xs text-warning font-medium">
              Only {chartCandles.length} sessions (&lt; 60)
            </span>
          )}
        </div>

        {/* Pattern Layers Bar */}
        <PatternLayersBar
          layers={patternLayers}
          onToggleLayer={(k) => setPatternLayers((prev) => ({ ...prev, [k]: !prev[k] }))}
          counts={patternCounts}
          timeframe="D"
        />

        <div className="relative w-full h-[220px] bg-bg-secondary/40 rounded border border-border flex items-center justify-center overflow-hidden">
          {loadingChart ? (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <RefreshCw size={14} className="animate-spin" />
              <span>Loading chart...</span>
            </div>
          ) : chartError ? (
            <div className="text-xs text-text-secondary italic">
              {chartError}
            </div>
          ) : (
            <div ref={chartContainerRef} className="w-full h-full" />
          )}
        </div>

        {/* Pattern Detail View */}
        <PatternDetailView
          patterns={activePatterns}
          focusedPatternId={focusedPatternId || activePatterns[0]?.id}
          onSelectPattern={setFocusedPatternId}
          reason={patternResult.reason}
        />
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-border bg-bg-secondary/50 flex items-center gap-2">
        {hasScreenerHits && (
          <a
            href={`/screener?stock=${stock.symbol}`}
            className="flex-1 py-2 px-3 rounded bg-primary text-text-inverse font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-primary-hover transition-colors"
          >
            <span>Open in Screener</span>
            <ExternalLink size={12} />
          </a>
        )}
        <button
          type="button"
          onClick={() => onShowSector && onShowSector(stock.sector)}
          className="flex-1 py-2 px-3 rounded border border-border bg-surface text-text font-semibold text-xs hover:bg-bg-hover transition-colors"
        >
          Show Sector ({stock.sector})
        </button>
      </div>
    </div>
  );
}

export default StockDetailPanel;
