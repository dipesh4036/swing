"use client";

import React, { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from "lightweight-charts";
import { ExternalLink } from "lucide-react";

/**
 * Individual Mini Chart Card for Fast Scan Grid
 */
function GridChartCard({ stock, candles = [], onSelectStock }) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current || !candles || candles.length === 0) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const container = chartContainerRef.current;
    const isDark =
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");

    const chart = createChart(container, {
      width: container.clientWidth || 340,
      height: 200,
      layout: {
        background: { color: isDark ? "#18181B" : "#FFFFFF" },
        textColor: isDark ? "#A1A1AA" : "#71717A",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: {
          color: isDark ? "#27272A" : "#F4F4F5",
        },
      },
      crosshair: {
        mode: 0, // Crosshair disabled for fast scan performance
      },
      handleScroll: false,
      handleScale: false,
      rightPriceScale: {
        borderColor: isDark ? "#27272A" : "#E4E4E7",
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: isDark ? "#27272A" : "#E4E4E7",
        barSpacing: 4.5,
        rightOffset: 2,
      },
    });

    chartInstanceRef.current = chart;

    // 1. Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isDark ? "#10B981" : "#059669",
      downColor: isDark ? "#F43F5E" : "#E11D48",
      wickUpColor: isDark ? "#10B981" : "#059669",
      wickDownColor: isDark ? "#F43F5E" : "#E11D48",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candleData = candles.map((c) => ({
      time: c.date,
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // 2. Volume Series (Histogram at bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: isDark ? "#3F3F46" : "#D4D4D8",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const volumeData = candles.map((c, i) => {
      const prevClose = i > 0 ? candles[i - 1].close : c.open;
      const isUp = c.close >= prevClose;
      return {
        time: c.date,
        value: c.volume || 0,
        color: isUp
          ? isDark ? "rgba(16, 185, 129, 0.3)" : "rgba(5, 150, 105, 0.3)"
          : isDark ? "rgba(244, 63, 94, 0.3)" : "rgba(225, 29, 72, 0.3)",
      };
    });
    volumeSeries.setData(volumeData);

    // 3. Moving Average Lines (EMA 10, 20, 50, 200)
    const addEMALine = (key, color) => {
      const lineData = candles
        .filter((c) => typeof c[key] === "number" && !isNaN(c[key]))
        .map((c) => ({ time: c.date, value: c[key] }));
      if (lineData.length > 0) {
        const lineSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSeries.setData(lineData);
      }
    };

    addEMALine("ema_10", "#06B6D4"); // Cyan
    addEMALine("ema_20", "#3B82F6"); // Blue
    addEMALine("ema_50", "#EAB308"); // Yellow
    addEMALine("ema_200", "#9333EA"); // Purple

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && chartInstanceRef.current) {
          chartInstanceRef.current.applyOptions({
            width: entry.contentRect.width,
          });
        }
      }
    });
    ro.observe(container);

    // Theme mutation observer
    const mo = new MutationObserver(() => {
      if (!chartInstanceRef.current) return;
      const darkNow = document.documentElement.classList.contains("dark");
      chartInstanceRef.current.applyOptions({
        layout: {
          background: { color: darkNow ? "#18181B" : "#FFFFFF" },
          textColor: darkNow ? "#A1A1AA" : "#71717A",
        },
        grid: {
          horzLines: { color: darkNow ? "#27272A" : "#F4F4F5" },
        },
        rightPriceScale: {
          borderColor: darkNow ? "#27272A" : "#E4E4E7",
        },
        timeScale: {
          borderColor: darkNow ? "#27272A" : "#E4E4E7",
        },
      });
      candleSeries.applyOptions({
        upColor: darkNow ? "#10B981" : "#059669",
        downColor: darkNow ? "#F43F5E" : "#E11D48",
        wickUpColor: darkNow ? "#10B981" : "#059669",
        wickDownColor: darkNow ? "#F43F5E" : "#E11D48",
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [candles]);

  const hasCandles = candles && candles.length > 0;

  return (
    <div className="bg-surface rounded-lg border border-border flex flex-col overflow-hidden hover:border-primary/50 transition-colors shadow-sm">
      {/* Card Header */}
      <div className="p-2.5 border-b border-border bg-bg-secondary/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => onSelectStock(stock)}
            className="font-bold text-xs text-text hover:text-primary transition-colors truncate text-left"
            title="Click to view interactive chart"
          >
            {stock.symbol}
          </button>
          {stock.rs_rank !== null && stock.rs_rank !== undefined && (
            <span
              className={`text-[9px] font-mono px-1 py-0.2 rounded-[3px] font-semibold shrink-0 ${
                stock.rs_rank >= 80
                  ? "bg-bullish-bg text-bullish border border-bullish-border"
                  : stock.rs_rank >= 70
                  ? "bg-warning-bg text-warning border border-warning/30"
                  : "bg-neutral-bg text-text-secondary border border-border"
              }`}
            >
              RS {stock.rs_rank}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs font-semibold text-text">
            {stock.close !== null && stock.close !== undefined
              ? `₹${stock.close.toLocaleString("en-IN")}`
              : "—"}
          </span>
          <span
            className={`font-mono text-[11px] font-medium ${
              stock.ret_1d_pct !== null && stock.ret_1d_pct !== undefined
                ? stock.ret_1d_pct >= 0
                  ? "text-bullish"
                  : "text-bearish"
                : "text-text-muted"
            }`}
          >
            {stock.ret_1d_pct !== null && stock.ret_1d_pct !== undefined
              ? `${stock.ret_1d_pct > 0 ? "+" : ""}${stock.ret_1d_pct}%`
              : "—"}
          </span>
        </div>
      </div>

      {/* Meta Bar */}
      <div className="px-2.5 py-1 text-[10px] font-mono text-text-muted border-b border-border/50 flex items-center justify-between bg-surface">
        <span title={stock.extra?.vol_ratio_basis === "listing_avg" ? "vs average since listing" : "vs 50-day average"}>
          Vol {stock.vol_ratio !== null && stock.vol_ratio !== undefined ? `${stock.vol_ratio}x` : "—"}
        </span>
        {stock.dist_to_pivot_pct !== null && stock.dist_to_pivot_pct !== undefined ? (
          <span>Pivot: {(stock.dist_to_pivot_pct * 100).toFixed(1)}%</span>
        ) : stock.stage ? (
          <span>Stage {stock.stage}</span>
        ) : (
          <span>Database candles</span>
        )}
      </div>

      {/* Chart Canvas Area */}
      <div className="relative w-full h-[200px] bg-surface">
        {hasCandles ? (
          <div ref={chartContainerRef} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-text-muted text-xs p-4 text-center">
            <span>No candle data in database</span>
          </div>
        )}
      </div>

      {/* Card Action Footer */}
      <button
        type="button"
        onClick={() => onSelectStock(stock)}
        className="w-full py-1.5 px-2 bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-primary text-[11px] font-medium border-t border-border flex items-center justify-center gap-1 transition-colors"
      >
        <span>Open Interactive Chart</span>
        <ExternalLink size={11} />
      </button>
    </div>
  );
}

/**
 * Main Screener Chart Grid View for Fast Scanning
 */
export function ScreenerGrid({
  stocks = [],
  candlesByToken = {},
  loading = false,
  activeScreener = "",
  onSelectStock,
}) {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg">
      {/* Legend & Summary Sub-Header */}
      <div className="px-4 py-2 border-b border-border bg-surface flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-text">
            Chart View (Fast Scan)
          </span>
          <span className="text-text-muted text-[11px] font-mono">
            {stocks.length} candidates · powered by database data
          </span>
        </div>

        {/* Moving Average Color Legend */}
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded-full bg-[#06B6D4]" />
            <span className="text-text-muted">10 EMA</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded-full bg-[#3B82F6]" />
            <span className="text-text-muted">20 EMA</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded-full bg-[#EAB308]" />
            <span className="text-text-muted">50 EMA</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded-full bg-[#9333EA]" />
            <span className="text-text-muted">200 EMA</span>
          </div>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: Math.min(stocks.length || 8, 12) }).map((_, i) => (
              <div
                key={i}
                className="bg-surface rounded-lg border border-border h-[280px] p-3 animate-pulse flex flex-col justify-between"
              >
                <div className="h-4 bg-bg-secondary rounded w-1/3" />
                <div className="h-44 bg-bg-secondary rounded" />
                <div className="h-4 bg-bg-secondary rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : stocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-muted text-sm">
            <span>No candidate stocks match the current filter.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {stocks.map((stock) => (
              <GridChartCard
                key={stock.token}
                stock={stock}
                candles={candlesByToken[stock.token] || []}
                onSelectStock={onSelectStock}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScreenerGrid;
