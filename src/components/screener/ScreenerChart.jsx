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

/**
 * Aggregates daily candles into weekly candles (Monday-start).
 */
function aggregateWeekly(dailyCandles) {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  const weeks = [];
  let currWeek = null;

  for (const c of dailyCandles) {
    const d = new Date(c.date);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
    const weekKey = monday.toISOString().split("T")[0];

    if (!currWeek || currWeek.weekKey !== weekKey) {
      if (currWeek) {
        weeks.push(currWeek);
      }
      currWeek = {
        weekKey,
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        sma_10: c.sma_10,
        sma_20: c.sma_20,
        sma_50: c.sma_50,
        sma_150: c.sma_150,
        sma_200: c.sma_200,
        ema_50: c.ema_50,
      };
    } else {
      currWeek.date = c.date;
      currWeek.high = Math.max(currWeek.high, c.high !== null && c.high !== undefined ? c.high : c.close);
      currWeek.low = Math.min(currWeek.low, c.low !== null && c.low !== undefined ? c.low : c.close);
      currWeek.close = c.close;
      currWeek.volume += (c.volume || 0);
      currWeek.sma_10 = c.sma_10;
      currWeek.sma_20 = c.sma_20;
      currWeek.sma_50 = c.sma_50;
      currWeek.sma_150 = c.sma_150;
      currWeek.sma_200 = c.sma_200;
      currWeek.ema_50 = c.ema_50;
    }
  }
  if (currWeek) weeks.push(currWeek);
  return weeks;
}

export default function ScreenerChart({
  stockData,
  screenerId,
  loading = false,
  error = null,
}) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [timeframe, setTimeframe] = useState("D"); // "D" | "W"
  const [showRulesOverlay, setShowRulesOverlay] = useState(true);
  const [visibleMAs, setVisibleMAs] = useState({
    sma_10: true,
    sma_20: true,
    sma_50: true,
    sma_150: screenerId === "stage2_breakout" || screenerId === "vcp",
    sma_200: true,
    ema_50: screenerId === "ema50_pullback",
  });
  const [hoveredCandle, setHoveredCandle] = useState(null);

  // Available MAs based on active screener
  const availableMAs = useMemo(() => ({
    sma_10: true,
    sma_20: true,
    sma_50: true,
    sma_150: screenerId === "stage2_breakout" || screenerId === "vcp",
    sma_200: true,
    ema_50: screenerId === "ema50_pullback",
  }), [screenerId]);

  // Aggregate candles and compute 20D volume SMA
  const candles = useMemo(() => {
    if (!stockData?.candles || stockData.candles.length === 0) return [];
    const baseCandles = timeframe === "W"
      ? aggregateWeekly(stockData.candles)
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

  const maConfigs = useMemo(() => [
    { key: "sma_10", color: "#F97316", label: "SMA 10" },
    { key: "sma_20", color: "#2563EB", label: "SMA 20" },
    { key: "sma_50", color: "#EAB308", label: "SMA 50" },
    { key: "sma_150", color: "#06B6D4", label: "SMA 150" },
    { key: "sma_200", color: "#9333EA", label: "SMA 200" },
    { key: "ema_50", color: "#F43F5E", label: "EMA 50" },
  ], []);

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

    const chart = createChart(container, {
      width,
      height,
      layout: {
        background: { color: "#FFFFFF" },
        textColor: "#64748B",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#F1F5F9", style: LineStyle.Solid },
      },
      crosshair: {
        mode: 1, // Normal
        vertLine: {
          color: "#94A3B8",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#17233B",
        },
        horzLine: {
          color: "#94A3B8",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#17233B",
        },
      },
      rightPriceScale: {
        borderColor: "#E2E8F0",
      },
      timeScale: {
        borderColor: "#E2E8F0",
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 7,
      },
    });

    chartInstanceRef.current = chart;

    // 1. Candlestick Series (Pane 0)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16A34A",
      downColor: "#EF4444",
      wickUpColor: "#16A34A",
      wickDownColor: "#EF4444",
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

    // 4. Moving Average Lines (Pane 0)
    const highlightLines = stockData?.overlay?.highlight_lines || [];
    for (const ma of maConfigs) {
      if (!availableMAs[ma.key] || !visibleMAs[ma.key]) continue;
      const isHighlighted = highlightLines.includes(ma.key);
      const s = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: isHighlighted ? 2 : 1,
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

    return () => {
      resizeObserver.disconnect();
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [candles, visibleMAs, availableMAs, showRulesOverlay, maConfigs, stockData?.overlay, timeframe]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white text-[#64748B] text-sm">
        <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3" />
        <span>Loading chart candles...</span>
      </div>
    );
  }

  if (error || !stockData) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white text-[#64748B] text-sm p-6 text-center">
        <div className="text-sm font-semibold text-[#17233B] mb-1">
          {error || "Select a stock from the candidate list"}
        </div>
        <div className="text-xs text-[#94A3B8]">
          Candles, moving averages, and pattern overlays will display here.
        </div>
      </div>
    );
  }

  const toggleMA = (key) => {
    setVisibleMAs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Top Header Strip (Single Compact Line) ─────────────────── */}
      <div className="px-3 py-2 border-b border-[#E5EAF2] flex flex-wrap items-center justify-between gap-2.5 bg-white shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-base font-bold text-[#17233B] tracking-tight">
              {stockData.symbol}
            </span>
            <a
              href={`https://www.tradingview.com/chart/?symbol=NSE:${stockData.symbol}`}
              target="_blank"
              rel="noreferrer"
              className="text-[#94A3B8] hover:text-[#2563EB] transition-colors p-0.5 rounded-[4px]"
              title="Open stock on TradingView"
            >
              <ExternalLink size={13} />
            </a>
          </div>

          {/* D / W Timeframe Toggle */}
          <div className="flex items-center rounded-[4px] border border-[#CBD5E1] p-0.5 bg-[#F8FAFC] text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setTimeframe("D")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${
                timeframe === "D"
                  ? "bg-[#2563EB] text-white shadow-2xs"
                  : "text-[#64748B] hover:text-[#17233B]"
              }`}
            >
              D
            </button>
            <button
              type="button"
              onClick={() => setTimeframe("W")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${
                timeframe === "W"
                  ? "bg-[#2563EB] text-white shadow-2xs"
                  : "text-[#64748B] hover:text-[#17233B]"
              }`}
            >
              W
            </button>
          </div>

          {/* OHLC and Day Change */}
          {activeCandle && (
            <div className="flex items-center gap-2 text-[11px] text-[#64748B] font-mono">
              <span>O: <strong className="text-[#17233B]">{activeCandle.open !== null && activeCandle.open !== undefined ? activeCandle.open.toFixed(2) : "—"}</strong></span>
              <span>H: <strong className="text-[#17233B]">{activeCandle.high !== null && activeCandle.high !== undefined ? activeCandle.high.toFixed(2) : "—"}</strong></span>
              <span>L: <strong className="text-[#17233B]">{activeCandle.low !== null && activeCandle.low !== undefined ? activeCandle.low.toFixed(2) : "—"}</strong></span>
              <span>C: <strong className="text-[#17233B]">{activeCandle.close !== null && activeCandle.close !== undefined ? activeCandle.close.toFixed(2) : "—"}</strong></span>
              {dayChangePct !== null && (
                <span className={`font-semibold ${Number(dayChangePct) >= 0 ? "text-[#16A34A]" : "text-[#EF4444]"}`}>
                  ({Number(dayChangePct) > 0 ? "+" : ""}{dayChangePct}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Stat Chips & Rules Overlay Switch */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="px-2 py-0.5 rounded-[4px] bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-[11px] flex items-center gap-1">
            <span className="text-[#94A3B8]">1M</span>
            <span className={`font-semibold ${stockData.ret_1m_pct !== null && stockData.ret_1m_pct !== undefined ? (stockData.ret_1m_pct >= 0 ? "text-[#16A34A]" : "text-[#EF4444]") : "text-[#94A3B8]"}`}>
              {stockData.ret_1m_pct !== null && stockData.ret_1m_pct !== undefined ? `${stockData.ret_1m_pct > 0 ? "+" : ""}${stockData.ret_1m_pct}%` : "—"}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-[4px] bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-[11px] flex items-center gap-1">
            <span className="text-[#94A3B8]">3M</span>
            <span className={`font-semibold ${stockData.ret_3m_pct !== null && stockData.ret_3m_pct !== undefined ? (stockData.ret_3m_pct >= 0 ? "text-[#16A34A]" : "text-[#EF4444]") : "text-[#94A3B8]"}`}>
              {stockData.ret_3m_pct !== null && stockData.ret_3m_pct !== undefined ? `${stockData.ret_3m_pct > 0 ? "+" : ""}${stockData.ret_3m_pct}%` : "—"}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-[4px] bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-[11px] flex items-center gap-1">
            <span className="text-[#94A3B8]">RS</span>
            <span className="font-semibold text-[#17233B]">
              {stockData.rs_rank !== null && stockData.rs_rank !== undefined ? stockData.rs_rank : "—"}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-[4px] bg-[#F8FAFC] border border-[#E2E8F0] font-mono text-[11px] flex items-center gap-1">
            <span className="text-[#94A3B8]">Vol</span>
            <span className="font-semibold text-[#17233B]">
              {stockData.vol_ratio !== null && stockData.vol_ratio !== undefined ? `${stockData.vol_ratio}x` : "—"}
            </span>
          </div>

          {/* Rules Overlay Toggle */}
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#64748B] cursor-pointer ml-1 select-none">
            <input
              type="checkbox"
              checked={showRulesOverlay}
              onChange={(e) => setShowRulesOverlay(e.target.checked)}
              className="rounded-xs text-[#2563EB] focus:ring-0 cursor-pointer w-3.5 h-3.5"
            />
            <span>Rules overlay</span>
          </label>
        </div>
      </div>

      {/* ── Chart Container with Absolute Overlays ────────────────── */}
      <div className="flex-1 w-full min-h-0 relative overflow-hidden">
        {/* Top-Left MA Legend Inside the Chart Canvas */}
        <div className="absolute top-2 left-3 z-10 flex items-center gap-2 text-[11px] font-mono select-none bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-[4px] border border-[#E5EAF2] shadow-2xs flex-wrap">
          {maConfigs.filter((ma) => availableMAs[ma.key]).map((ma) => {
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
        <div className="absolute top-[75%] left-3 pt-1 z-10 pointer-events-none text-[11px] font-mono text-[#64748B] flex items-center gap-2.5 bg-white/70 backdrop-blur-2xs px-1.5 rounded-xs">
          <span>Vol <strong className="text-[#17233B]">{formatVolume(activeCandle?.volume)}</strong></span>
          <span>Avg 20D <strong className="text-[#17233B]">{formatVolume(activeCandle?.vol_sma_20)}</strong></span>
          <span>
            RVol <strong className={rVolPct !== null ? (rVolPct >= 150 ? "text-[#16A34A]" : rVolPct <= 70 ? "text-[#64748B]" : "text-[#17233B]") : "text-[#94A3B8]"}>
              {rVolPct !== null ? `${rVolPct}%` : "—"}
            </strong>
          </span>
        </div>

        {/* Lightweight Charts Canvas Root */}
        <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* ── Clean Attribution Footer ───────────────────────────────── */}
      <div className="px-3 py-1.5 border-t border-[#E5EAF2] flex items-center justify-between text-[10px] text-[#94A3B8] bg-[#FAFAFA] shrink-0">
        <div className="flex items-center gap-3">
          <span>{candles.length} bars</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
            HVQ: 63D high
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9333EA]" />
            HVY: 252D high
          </span>
        </div>
        <div>
          Powered by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#17233B] underline transition-colors"
          >
            TradingView Lightweight Charts™
          </a>
        </div>
      </div>
    </div>
  );
}
