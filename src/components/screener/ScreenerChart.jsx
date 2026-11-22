"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  LineStyle,
} from "lightweight-charts";
import { ExternalLink } from "lucide-react";
import { attachEMAs, aggregateWeekly } from "@/lib/indicators";
import { detectPatterns } from "@/lib/patterns";
import { PatternSeriesPrimitive } from "@/components/charts/patternLayers";
import { PatternLayersBar } from "@/components/charts/PatternLayersBar";
import { PatternDetailPanel } from "@/components/charts/PatternDetailPanel";

/**
 * Format volume into readable units: K, M, Cr
 */
function formatVolume(val) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  if (val >= 10000000) return (val / 10000000).toFixed(2) + "Cr";
  if (val >= 1000000) return (val / 1000000).toFixed(1) + "M";
  if (val >= 1000) return (val / 1000).toFixed(1) + "K";
  return Math.round(val).toString();
}

export default function ScreenerChart({
  stockData,
  screenerId,
  loading = false,
  error = null,
  showFundamentals = false,
  onToggleFundamentals = null,
}) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [timeframe, setTimeframe] = useState("D"); // "D" | "W"
  const [showRulesOverlay, setShowRulesOverlay] = useState(true);
  const [visibleMAs, setVisibleMAs] = useState({
    ema_10: true,
    ema_20: true,
    ema_50: true,
    ema_200: true,
  });
  const [hoveredCandle, setHoveredCandle] = useState(null);

  // Auto Chart Pattern Layer States
  const [focusedPatternId, setFocusedPatternId] = useState(null);
  const [patternLayers, setPatternLayers] = useState({
    patternLines: true,
    breakoutRetest: true,
    basePivot: true,
    ema_21: false,
  });

  // Pure JavaScript pattern detection on daily candles
  const patternResult = useMemo(() => {
    if (timeframe !== "D" || !stockData?.candles || stockData.candles.length === 0) {
      return {
        patterns: [],
        reason: timeframe !== "D" ? "Patterns are daily only" : "insufficient_history",
      };
    }
    return detectPatterns(stockData.candles);
  }, [stockData?.candles, timeframe]);

  // Default: top 3 patterns on
  const activePatterns = useMemo(() => {
    return patternResult.patterns.slice(0, 3);
  }, [patternResult.patterns]);

  // Pattern counts for chip row
  const patternCounts = useMemo(() => {
    return {
      patternLines: activePatterns.reduce((acc, p) => acc + (p.lines?.length || 1), 0),
      breakoutRetest: activePatterns.reduce((acc, p) => acc + (p.events?.length || 0), 0),
      basePivot: activePatterns.filter((p) => p.type === "base_pivot").length,
    };
  }, [activePatterns]);

  // Count patterns whose anchors begin off-screen
  const offscreenCount = useMemo(() => {
    if (!candles || candles.length === 0 || activePatterns.length === 0) return 0;
    // Consider anchors in the earliest 10% of history as potentially off-screen initially
    const cutoff = Math.floor(candles.length * 0.1);
    return activePatterns.filter((p) => (p.lines[0]?.idx1 ?? 0) <= cutoff).length;
  }, [candles, activePatterns]);

  // EMA configs (Only EMAs: 10, 20, 50, 200 - SMA 150 removed)
  const maConfigs = useMemo(() => [
    { key: "ema_10", color: "#F97316", label: "EMA 10" },
    { key: "ema_20", color: "#2563EB", label: "EMA 20" },
    { key: "ema_50", color: "#EAB308", label: "EMA 50" },
    { key: "ema_200", color: "#9333EA", label: "EMA 200" },
  ], []);

  // Aggregate candles and compute 20D volume SMA and EMAs
  const candles = useMemo(() => {
    if (!stockData?.candles || stockData.candles.length === 0) return [];
    const baseCandles = timeframe === "W"
      ? attachEMAs(aggregateWeekly(stockData.candles), [10, 20, 50, 200])
      : stockData.candles;

    return baseCandles.map((c, i, arr) => {
      let volSum = 0;
      const count = Math.min(20, i + 1);
      for (let j = i - count + 1; j <= i; j++) {
        volSum += (arr[j].volume || 0);
      }
      const vol_sma_20 = Math.round(volSum / count);
      return {
        ...c,
        vol_sma_20,
      };
    });
  }, [stockData, timeframe]);

  // Active candle for top bar display (hovered or last)
  const activeCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);

  // Day change calculation for active candle
  const dayChangePct = useMemo(() => {
    if (!activeCandle || activeCandle.close === null || activeCandle.close === undefined) return null;
    const idx = candles.findIndex((c) => c.date === activeCandle.date);
    if (idx > 0 && candles[idx - 1]?.close) {
      const prev = candles[idx - 1].close;
      return (((activeCandle.close - prev) / prev) * 100).toFixed(2);
    }
    if (activeCandle.open) {
      return (((activeCandle.close - activeCandle.open) / activeCandle.open) * 100).toFixed(2);
    }
    return null;
  }, [activeCandle, candles]);

  // Relative volume percentage
  const rVolPct = useMemo(() => {
    if (!activeCandle || !activeCandle.vol_sma_20 || activeCandle.vol_sma_20 <= 0) return null;
    const vol = activeCandle.volume || 0;
    return Math.round((vol / activeCandle.vol_sma_20) * 100);
  }, [activeCandle]);



  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Clean up any existing chart instance
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const container = chartContainerRef.current;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 480;
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: isDark ? "#18181B" : "#FFFFFF" },
        textColor: isDark ? "#A1A1AA" : "#71717A",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: isDark ? "#27272A" : "#F4F4F5", style: LineStyle.Solid },
      },
      crosshair: {
        mode: 1, // Normal
        vertLine: {
          color: isDark ? "#52525B" : "#A1A1AA",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isDark ? "#27272A" : "#18181B",
        },
        horzLine: {
          color: isDark ? "#52525B" : "#A1A1AA",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isDark ? "#27272A" : "#18181B",
        },
      },
      rightPriceScale: {
        borderColor: isDark ? "#27272A" : "#E4E4E7",
      },
      timeScale: {
        borderColor: isDark ? "#27272A" : "#E4E4E7",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 7,
      },
    });

    chartInstanceRef.current = chart;

    // 1. Candlestick Series (Pane 0)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isDark ? "#10B981" : "#059669",
      downColor: isDark ? "#F43F5E" : "#E11D48",
      wickUpColor: isDark ? "#10B981" : "#059669",
      wickDownColor: isDark ? "#F43F5E" : "#E11D48",
      borderVisible: false,
      priceLineVisible: false, // No dotted price line crossing the chart
      lastValueVisible: false, // No stacked price tag on right axis (only Pivot has axis tag)
    }, 0);

    const candleData = candles.map((c) => ({
      time: c.date,
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // Auto Chart Patterns Primitive (Daily only)
    if (timeframe === "D" && activePatterns.length > 0) {
      const patternPrimitive = new PatternSeriesPrimitive({
        patterns: activePatterns,
        focusedPatternId: focusedPatternId || activePatterns[0]?.id,
        layers: patternLayers,
        isDark,
      });
      candleSeries.attachPrimitive(patternPrimitive);
    }

    // 21 EMA Line (Toggleable pattern layer)
    if (patternLayers.ema_21 && candles.length > 0) {
      const candlesWith21 = attachEMAs(candles, [21]);
      const ema21Series = chart.addSeries(LineSeries, {
        color: "#3B82F6",
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 0);
      ema21Series.setData(
        candlesWith21
          .filter((c) => c.ema_21 !== null && c.ema_21 !== undefined)
          .map((c) => ({ time: c.date, value: c.ema_21 }))
      );
    }

    // 2. Volume Series (Pane 1)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1);

    const volumeData = candles.map((c) => {
      const isUp = c.close >= (c.open !== null && c.open !== undefined ? c.open : c.close);
      return {
        time: c.date,
        value: c.volume || 0,
        color: isUp ? "rgba(22, 163, 74, 0.6)" : "rgba(239, 68, 68, 0.6)",
      };
    });
    volumeSeries.setData(volumeData);

    // 3. 20-session Volume Moving Average Line (Pane 1)
    const volAvgSeries = chart.addSeries(LineSeries, {
      color: "#94A3B8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    }, 1);

    const volAvgData = [];
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].vol_sma_20 !== null && candles[i].vol_sma_20 !== undefined) {
        volAvgData.push({ time: candles[i].date, value: candles[i].vol_sma_20 });
      }
    }
    volAvgSeries.setData(volAvgData);

    // Set stretch factors: ~75% price, ~25% volume
    const panes = chart.panes();
    if (panes && panes.length > 1) {
      panes[0].setStretchFactor(75);
      panes[1].setStretchFactor(25);
    }

    // 4. Moving Average Lines (Pane 0 - EMAs only: 10, 20, 50, 200)
    for (const ma of maConfigs) {
      if (!visibleMAs[ma.key]) continue;
      const s = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 0);

      const maData = [];
      for (const c of candles) {
        if (c[ma.key] !== null && c[ma.key] !== undefined) {
          maData.push({ time: c.date, value: c[ma.key] });
        }
      }
      s.setData(maData);
    }

    // 5. Overlay Levels (Pane 0)
    const overlay = stockData?.overlay;
    const lastCandleDate = candles[candles.length - 1].date;

    if (overlay && overlay.levels && overlay.levels.length > 0) {
      for (const lvl of overlay.levels) {
        if (!lvl.price || !lvl.from_date) continue;
        const isPivot = lvl.id === "pivot" || lvl.id === "listing_high";

        // Skip non-pivot dashed rule levels if Rules Overlay is turned off
        if (!isPivot && !showRulesOverlay) continue;

        const s = chart.addSeries(LineSeries, {
          color: isPivot ? "#2563EB" : "#94A3B8",
          lineWidth: isPivot ? 1.5 : 1,
          lineStyle: isPivot ? LineStyle.Solid : LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: isPivot, // ONLY pivot-type level has right-axis tag
          title: isPivot ? (lvl.label || "Pivot") : "",
          crosshairMarkerVisible: false,
        }, 0);

        let fDate = (lvl.from_date >= candles[0].date && lvl.from_date <= lastCandleDate)
          ? lvl.from_date
          : candles[0].date;

        // If fDate equals lastCandleDate, extend slightly to the left so it renders as a valid line segment
        if (fDate >= lastCandleDate && candles.length > 1) {
          const fallbackIdx = Math.max(0, candles.length - 5);
          fDate = candles[fallbackIdx].date;
        }

        s.setData([
          { time: fDate, value: lvl.price },
          { time: lastCandleDate, value: lvl.price },
        ]);
      }
    }

    // 6. VCP Contraction Segments (Pane 0)
    if (showRulesOverlay && overlay && overlay.segments && overlay.segments.length > 0) {
      const vcpMarkers = [];
      for (const seg of overlay.segments) {
        if (seg.from && seg.to && seg.from.date && seg.to.date) {
          const segSeries = chart.addSeries(LineSeries, {
            color: "#2563EB",
            lineWidth: 1.5,
            lineStyle: LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }, 0);

          const d1 = seg.from.date;
          const d2 = seg.to.date;
          const isAsc = d1 < d2;
          const p1 = { time: isAsc ? d1 : d2, value: isAsc ? seg.from.price : seg.to.price };
          const p2 = { time: isAsc ? d2 : d1, value: isAsc ? seg.to.price : seg.from.price };

          // Only set data if endpoints have distinct dates
          if (p1.time < p2.time) {
            segSeries.setData([p1, p2]);
          }

          if (seg.label) {
            // Place marker near the lower price endpoint
            const markerDate = seg.from.price <= seg.to.price ? seg.from.date : seg.to.date;
            vcpMarkers.push({
              time: markerDate,
              position: "belowBar",
              shape: "circle",
              color: "#2563EB",
              text: seg.label,
              size: 0.5,
            });
          }
        }
      }
      if (vcpMarkers.length > 0) {
        vcpMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        createSeriesMarkers(candleSeries, vcpMarkers);
      }
    }

    // 7. Breakout Overlay Markers on Candles (if any)
    if (overlay && overlay.markers && overlay.markers.length > 0) {
      const boMarkers = [];
      for (const m of overlay.markers) {
        boMarkers.push({
          time: m.date,
          position: m.position === "aboveBar" ? "aboveBar" : "belowBar",
          color: m.text === "Breakout" ? "#16A34A" : "#2563EB",
          shape: m.shape === "arrowUp" ? "arrowUp" : "circle",
          text: m.text,
          size: 1,
        });
      }
      if (boMarkers.length > 0) {
        boMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        createSeriesMarkers(candleSeries, boMarkers);
      }
    }

    // 8. Volume Pane Markers (HVQ / HVY)
    const rawVolMarkers = [];
    for (let i = 0; i < candles.length; i++) {
      const vol = candles[i].volume || 0;
      if (vol <= 0) continue;

      // Check HVY (252 sessions)
      const start252 = Math.max(0, i - 251);
      let isHVY = true;
      for (let j = start252; j <= i; j++) {
        if (candles[j].volume > vol) {
          isHVY = false;
          break;
        }
      }
      if (isHVY && (i - start252) >= 30) {
        rawVolMarkers.push({
          time: candles[i].date,
          position: "aboveBar",
          color: "#9333EA",
          shape: "circle",
          text: "HVY",
          size: 0.8,
        });
        continue;
      }

      // Check HVQ (63 sessions)
      const start63 = Math.max(0, i - 62);
      let isHVQ = true;
      for (let j = start63; j <= i; j++) {
        if (candles[j].volume > vol) {
          isHVQ = false;
          break;
        }
      }
      if (isHVQ && (i - start63) >= 15) {
        rawVolMarkers.push({
          time: candles[i].date,
          position: "aboveBar",
          color: "#2563EB",
          shape: "circle",
          text: "HVQ",
          size: 0.8,
        });
      }
    }

    // Show only the 3 most recent HVQ/HVY markers
    const recentVolMarkers = rawVolMarkers.slice(-3);
    if (recentVolMarkers.length > 0) {
      recentVolMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      createSeriesMarkers(volumeSeries, recentVolMarkers);
    }

    // 9. Initial Zoom: Last 120 bars (60 for weekly) + 8 empty bars on right
    const totalBars = candles.length;
    const barsToShow = timeframe === "W" ? 60 : 120;
    const fromIndex = Math.max(0, totalBars - barsToShow);
    const toIndex = totalBars + 8;
    chart.timeScale().setVisibleLogicalRange({ from: fromIndex, to: toIndex });

    // 10. Crosshair Move Handler
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        setHoveredCandle(null);
        return;
      }
      const match = candles.find((c) => c.date === param.time);
      if (match) {
        setHoveredCandle(match);
      }
    });

    // 11. Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0 && chartInstanceRef.current) {
        const { width: newW, height: newH } = entries[0].contentRect;
        chartInstanceRef.current.applyOptions({ width: newW, height: newH });
      }
    });
    resizeObserver.observe(container);

    // 12. Theme Mutation Observer (S0-6: dynamically recolor chart and series on dark/light toggle)
    const updateThemeOptions = () => {
      if (!chartInstanceRef.current) return;
      const isDarkNow = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
      chartInstanceRef.current.applyOptions({
        layout: {
          background: { color: isDarkNow ? "#18181B" : "#FFFFFF" },
          textColor: isDarkNow ? "#A1A1AA" : "#71717A",
        },
        grid: {
          horzLines: { color: isDarkNow ? "#27272A" : "#F4F4F5" },
        },
        crosshair: {
          vertLine: {
            color: isDarkNow ? "#52525B" : "#A1A1AA",
            labelBackgroundColor: isDarkNow ? "#27272A" : "#18181B",
          },
          horzLine: {
            color: isDarkNow ? "#52525B" : "#A1A1AA",
            labelBackgroundColor: isDarkNow ? "#27272A" : "#18181B",
          },
        },
        rightPriceScale: {
          borderColor: isDarkNow ? "#27272A" : "#E4E4E7",
        },
        timeScale: {
          borderColor: isDarkNow ? "#27272A" : "#E4E4E7",
        },
      });
      if (candleSeries) {
        candleSeries.applyOptions({
          upColor: isDarkNow ? "#10B981" : "#059669",
          downColor: isDarkNow ? "#F43F5E" : "#E11D48",
          wickUpColor: isDarkNow ? "#10B981" : "#059669",
          wickDownColor: isDarkNow ? "#F43F5E" : "#E11D48",
        });
      }
    };

    const themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          updateThemeOptions();
        }
      }
    });
    if (typeof document !== "undefined" && document.documentElement) {
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [candles, visibleMAs, showRulesOverlay, maConfigs, stockData?.overlay, timeframe, activePatterns, focusedPatternId, patternLayers]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-surface text-text-secondary text-sm">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
        <span>Loading chart candles...</span>
      </div>
    );
  }

  if (error || !stockData) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-surface text-text-secondary text-sm p-6 text-center">
        <div className="text-sm font-semibold text-text mb-1">
          {error || "Select a stock from the candidate list"}
        </div>
        <div className="text-xs text-text-muted">
          Candles, moving averages, and pattern overlays will display here.
        </div>
      </div>
    );
  }

  const toggleMA = (key) => {
    setVisibleMAs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full bg-surface overflow-hidden">
      {/* ── Top Header Strip (Single Compact Line) ─────────────────── */}
      <div className="px-3 py-2 border-b border-border flex flex-wrap items-center justify-between gap-2.5 bg-surface shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-text tracking-tight">
              {stockData.symbol}
            </span>
            <a
              href={`https://www.tradingview.com/chart/?symbol=NSE:${stockData.symbol}`}
              target="_blank"
              rel="noreferrer"
              className="text-text-muted hover:text-primary transition-colors p-0.5 rounded-md"
              title="Open stock on TradingView"
            >
              <ExternalLink size={13} />
            </a>
            {onToggleFundamentals ? (
              <button
                type="button"
                onClick={onToggleFundamentals}
                className={`text-xs font-semibold px-2 py-0.5 rounded-md border transition-colors flex items-center gap-1 cursor-pointer ${
                  showFundamentals
                    ? "bg-primary text-text-inverse border-primary"
                    : "bg-surface border-border text-text hover:bg-bg-hover"
                }`}
                title="Toggle Fundamentals Panel"
              >
                <span>Fundamentals</span>
              </button>
            ) : (
              <a
                href={`https://tapetide.com/stocks/${encodeURIComponent(stockData.symbol)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-text-muted hover:text-primary transition-colors px-1.5 py-0.5 rounded-md hover:bg-bg-hover flex items-center gap-0.5"
                title="Open fundamentals on Tapetide (external)"
              >
                <span>Fundamentals ↗</span>
              </a>
            )}
          </div>

          {/* D / W Timeframe Toggle */}
          <div className="flex items-center rounded-md border border-border p-0.5 bg-bg-secondary text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setTimeframe("D")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${
                timeframe === "D"
                  ? "bg-primary text-text-inverse font-semibold"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              D
            </button>
            <button
              type="button"
              onClick={() => setTimeframe("W")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${
                timeframe === "W"
                  ? "bg-primary text-text-inverse font-semibold"
                  : "text-text-secondary hover:text-text"
              }`}
            >
              W
            </button>
          </div>

          {/* OHLC and Day Change */}
          {activeCandle && (
            <div className="flex items-center gap-2 text-[11px] text-text-secondary font-mono">
              <span>O: <strong className="text-text">{activeCandle.open !== null && activeCandle.open !== undefined ? activeCandle.open.toFixed(2) : "—"}</strong></span>
              <span>H: <strong className="text-text">{activeCandle.high !== null && activeCandle.high !== undefined ? activeCandle.high.toFixed(2) : "—"}</strong></span>
              <span>L: <strong className="text-text">{activeCandle.low !== null && activeCandle.low !== undefined ? activeCandle.low.toFixed(2) : "—"}</strong></span>
              <span>C: <strong className="text-text">{activeCandle.close !== null && activeCandle.close !== undefined ? activeCandle.close.toFixed(2) : "—"}</strong></span>
              {dayChangePct !== null && (
                <span className={`font-semibold ${Number(dayChangePct) >= 0 ? "text-bullish" : "text-bearish"}`}>
                  ({Number(dayChangePct) > 0 ? "+" : ""}{dayChangePct}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Stat Chips & Rules Overlay Switch */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border font-mono text-[11px] flex items-center gap-1">
            <span className="text-text-muted">1M</span>
            <span className={`font-semibold ${stockData.ret_1m_pct !== null && stockData.ret_1m_pct !== undefined ? (stockData.ret_1m_pct >= 0 ? "text-bullish" : "text-bearish") : "text-text-muted"}`}>
              {stockData.ret_1m_pct !== null && stockData.ret_1m_pct !== undefined ? `${stockData.ret_1m_pct > 0 ? "+" : ""}${stockData.ret_1m_pct}%` : "—"}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border font-mono text-[11px] flex items-center gap-1">
            <span className="text-text-muted">3M</span>
            <span className={`font-semibold ${stockData.ret_3m_pct !== null && stockData.ret_3m_pct !== undefined ? (stockData.ret_3m_pct >= 0 ? "text-bullish" : "text-bearish") : "text-text-muted"}`}>
              {stockData.ret_3m_pct !== null && stockData.ret_3m_pct !== undefined ? `${stockData.ret_3m_pct > 0 ? "+" : ""}${stockData.ret_3m_pct}%` : "—"}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border font-mono text-[11px] flex items-center gap-1">
            <span className="text-text-muted">RS</span>
            <span className="font-semibold text-text">
              {stockData.rs_rank !== null && stockData.rs_rank !== undefined ? stockData.rs_rank : "—"}
            </span>
          </div>

          <div
            title={stockData.extra?.vol_ratio_basis === "listing_avg" ? "vs average since listing" : "vs 50-day average"}
            className="px-2 py-0.5 rounded-md bg-bg-secondary border border-border font-mono text-[11px] flex items-center gap-1 cursor-help"
          >
            <span className="text-text-muted">Vol</span>
            <span className="font-semibold text-text">
              {stockData.vol_ratio !== null && stockData.vol_ratio !== undefined ? `${stockData.vol_ratio}x` : "—"}
            </span>
          </div>

          {/* Rules Overlay Toggle */}
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary cursor-pointer ml-1 select-none">
            <input
              type="checkbox"
              checked={showRulesOverlay}
              onChange={(e) => setShowRulesOverlay(e.target.checked)}
              className="rounded-xs text-primary focus:ring-0 cursor-pointer w-3.5 h-3.5"
            />
            <span>Rules overlay</span>
          </label>
        </div>
      </div>

      {/* ── Pattern Layers Bar (Daily Only) ───────────────────────── */}
      <PatternLayersBar
        layers={patternLayers}
        onToggleLayer={(layerKey) => setPatternLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }))}
        counts={patternCounts}
        timeframe={timeframe}
        offscreenCount={offscreenCount}
      />

      {/* ── Chart Container with Absolute Overlays ────────────────── */}
      <div className="flex-1 w-full min-h-0 relative overflow-hidden bg-surface">
        {/* Top-Left MA Legend Inside the Chart Canvas (EMAs only) */}
        <div className="absolute top-2 left-3 z-10 flex items-center gap-2 text-[11px] font-mono select-none bg-surface/90 backdrop-blur-xs px-2.5 py-1 rounded-md border border-border flex-wrap text-text">
          {maConfigs.map((ma) => {
            const val = activeCandle?.[ma.key];
            const isVisible = visibleMAs[ma.key];
            return (
              <button
                key={ma.key}
                type="button"
                onClick={() => toggleMA(ma.key)}
                className={`flex items-center gap-1 transition-opacity ${
                  isVisible ? "opacity-100 hover:opacity-80" : "opacity-35 line-through"
                }`}
                title={`Toggle ${ma.label}`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 inline-block"
                  style={{ backgroundColor: ma.color }}
                />
                <span>
                  {ma.label} {val !== null && val !== undefined ? Number(val).toFixed(2) : "—"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Volume Pane Info Header (Positioned at 75% height) */}
        <div className="absolute top-[75%] left-3 pt-1 z-10 pointer-events-none text-[11px] font-mono text-text-secondary flex items-center gap-2.5 bg-surface/80 backdrop-blur-2xs px-1.5 rounded-sm">
          <span>Vol <strong className="text-text">{formatVolume(activeCandle?.volume)}</strong></span>
          <span>Avg 20D <strong className="text-text">{formatVolume(activeCandle?.vol_sma_20)}</strong></span>
          <span>
            RVol <strong className={rVolPct !== null ? (rVolPct >= 150 ? "text-bullish" : rVolPct <= 70 ? "text-text-secondary" : "text-text") : "text-text-muted"}>
              {rVolPct !== null ? `${rVolPct}%` : "—"}
            </strong>
          </span>
        </div>

        {/* Lightweight Charts Canvas Root */}
        <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* ── Auto Chart Pattern Detail Panel (Daily Only) ─────────── */}
      {timeframe === "D" && (
        <PatternDetailPanel
          patterns={activePatterns}
          focusedPatternId={focusedPatternId || activePatterns[0]?.id}
          onSelectPattern={setFocusedPatternId}
          reason={patternResult.reason}
        />
      )}

      {/* ── Legend Footer ─────────────────────────────────────────── */}
      <div className="px-3 py-1.5 border-t border-border flex items-center justify-between text-[10px] text-text-muted bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <span>{candles.length} bars</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            HVQ: 63D high
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9333EA]" />
            HVY: 252D high
          </span>
        </div>
      </div>
    </div>
  );
}
