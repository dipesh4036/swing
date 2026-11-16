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
import { Calendar, Eye, EyeOff } from "lucide-react";

/**
 * Aggregates daily candles into weekly candles (Monday-start).
 */
function aggregateWeekly(dailyCandles) {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  const weeks = [];
  let currWeek = null;

  for (const c of dailyCandles) {
    const d = new Date(c.date);
    // Calculate Monday of the week
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
        date: c.date, // display Friday / last trade date of the week
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
      currWeek.high = Math.max(currWeek.high, c.high !== null ? c.high : c.close);
      currWeek.low = Math.min(currWeek.low, c.low !== null ? c.low : c.close);
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
  const [visibleMAs, setVisibleMAs] = useState({
    sma_10: true,
    sma_20: true,
    sma_50: true,
    sma_150: screenerId === "stage2_breakout" || screenerId === "vcp",
    sma_200: true,
    ema_50: screenerId === "ema50_pullback",
  });
  const [hoveredCandle, setHoveredCandle] = useState(null);

  // Determine which MA lines are available for this screener
  const showSMA150 = screenerId === "stage2_breakout" || screenerId === "vcp";
  const showEMA50 = screenerId === "ema50_pullback";

  // Daily or Weekly candles
  const candles = useMemo(() => {
    if (!stockData?.candles) return [];
    if (timeframe === "W") {
      return aggregateWeekly(stockData.candles);
    }
    return stockData.candles;
  }, [stockData, timeframe]);

  // Active candle for top bar display
  const activeCandle = hoveredCandle || (candles.length > 0 ? candles[candles.length - 1] : null);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    // Clean up previous instance
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
      },
      grid: {
        vertLines: { color: "#F1F5F9" },
        horzLines: { color: "#F1F5F9" },
      },
      crosshair: {
        mode: 1, // Normal
      },
      rightPriceScale: {
        borderColor: "#E2E8F0",
        scaleMargins: {
          top: 0.1,
          bottom: 0.25, // space for volume histogram below
        },
      },
      timeScale: {
        borderColor: "#E2E8F0",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartInstanceRef.current = chart;

    // 1. Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16A878",
      downColor: "#EF4444",
      borderVisible: false,
      wickUpColor: "#16A878",
      wickDownColor: "#EF4444",
    });

    const candleData = candles.map((c) => ({
      time: c.date,
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // 2. Volume Histogram (Bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.8, // volume occupies bottom 20%
        bottom: 0,
      },
    });

    const volumeData = candles.map((c) => {
      const isUp = c.close >= (c.open !== null ? c.open : c.close);
      return {
        time: c.date,
        value: c.volume || 0,
        color: isUp ? "#A7F3D0" : "#FECACA", // softer bars
      };
    });
    volumeSeries.setData(volumeData);

    // 3. 20-session Volume Moving Average Line
    const volAvgSeries = chart.addSeries(LineSeries, {
      color: "#94A3B8",
      lineWidth: 1,
      priceScaleId: "volume",
      crosshairMarkerVisible: false,
    });
    const volAvgData = [];
    for (let i = 0; i < candles.length; i++) {
      if (i >= 19) {
        let sum = 0;
        for (let j = i - 19; j <= i; j++) sum += (candles[j].volume || 0);
        volAvgData.push({ time: candles[i].date, value: Math.round(sum / 20) });
      }
    }
    volAvgSeries.setData(volAvgData);

    // 4. Moving Average Lines
    const highlightLines = stockData?.overlay?.highlight_lines || [];

    const maConfigs = [
      { key: "sma_10", color: "#F97316", label: "SMA 10" },
      { key: "sma_20", color: "#2563EB", label: "SMA 20" },
      { key: "sma_50", color: "#EAB308", label: "SMA 50" },
      { key: "sma_150", color: "#06B6D4", label: "SMA 150" },
      { key: "sma_200", color: "#9333EA", label: "SMA 200" },
      { key: "ema_50", color: "#F43F5E", label: "EMA 50" },
    ];

    for (const ma of maConfigs) {
      if (!visibleMAs[ma.key]) continue;
      const isHighlighted = highlightLines.includes(ma.key);
      const s = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: isHighlighted ? 3 : 1.5,
        title: ma.label,
        crosshairMarkerVisible: false,
      });
      const data = [];
      for (const c of candles) {
        if (c[ma.key] !== null && c[ma.key] !== undefined) {
          data.push({ time: c.date, value: c[ma.key] });
        }
      }
      s.setData(data);
    }

    // 5. Overlay Levels & Segments from Pipeline
    const overlay = stockData?.overlay;
    if (overlay && overlay.levels && overlay.levels.length > 0) {
      const lastCandleDate = candles[candles.length - 1].date;
      for (const lvl of overlay.levels) {
        if (lvl.price && lvl.from_date) {
          const lvlSeries = chart.addSeries(LineSeries, {
            color: lvl.id === "pivot" ? "#2563EB" : "#64748B",
            lineWidth: lvl.id === "pivot" ? 2 : 1.5,
            lineStyle: lvl.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
            crosshairMarkerVisible: false,
            title: lvl.label,
          });
          // Draw line from from_date to right edge (last candle)
          const fDate = lvl.from_date <= lastCandleDate ? lvl.from_date : candles[0].date;
          lvlSeries.setData([
            { time: fDate, value: lvl.price },
            { time: lastCandleDate, value: lvl.price },
          ]);
        }
      }
    }

    // Segments (e.g. VCP contractions c1, c2, c3)
    if (overlay && overlay.segments && overlay.segments.length > 0) {
      for (const seg of overlay.segments) {
        if (seg.from && seg.to) {
          const segSeries = chart.addSeries(LineSeries, {
            color: "#6366F1",
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            title: seg.label || "Contraction",
          });
          segSeries.setData([
            { time: seg.from.date, value: seg.from.price },
            { time: seg.to.date, value: seg.to.price },
          ]);
        }
      }
    }

    // 6. Markers (Overlay Markers + Volume Tags HVQ / HVY)
    const allMarkers = [];

    // Pipeline Overlay Markers
    if (overlay && overlay.markers && overlay.markers.length > 0) {
      for (const m of overlay.markers) {
        allMarkers.push({
          time: m.date,
          position: m.position === "aboveBar" ? "aboveBar" : "belowBar",
          color: m.text === "Breakout" ? "#16A878" : "#2563EB",
          shape: m.shape === "arrowUp" ? "arrowUp" : "circle",
          text: m.text,
        });
      }
    }

    // Volume Tags: HVQ (last 63 sessions) and HVY (last 252 sessions)
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
        allMarkers.push({
          time: candles[i].date,
          position: "aboveBar",
          color: "#9333EA",
          shape: "circle",
          text: "HVY",
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
        allMarkers.push({
          time: candles[i].date,
          position: "aboveBar",
          color: "#2563EB",
          shape: "circle",
          text: "HVQ",
        });
      }
    }

    // Sort markers chronologically (required by lightweight-charts)
    allMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    if (allMarkers.length > 0) {
      createSeriesMarkers(candleSeries, allMarkers);
    }

    // 7. Crosshair Move Handler
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

    chart.timeScale().fitContent();

    // Resize Observer
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
  }, [candles, visibleMAs, stockData?.overlay]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white border border-[#E5EAF2] rounded-[8px] text-[#64748B] text-sm">
        <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3" />
        <span>Loading chart data...</span>
      </div>
    );
  }

  if (error || !stockData) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[420px] bg-white border border-[#E5EAF2] rounded-[8px] text-[#64748B] text-sm p-6 text-center">
        <div className="text-sm font-semibold text-[#17233B] mb-1">
          {error || "Select a stock to view chart"}
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
    <div className="flex flex-col h-full bg-white border border-[#E5EAF2] rounded-[8px] overflow-hidden shadow-xs">
      {/* Top Header Strip: SYMBOL, OHLC, Metrics */}
      <div className="p-3 border-b border-[#E5EAF2] flex flex-wrap items-center justify-between gap-3 bg-[#FAFAFA]">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[#17233B] tracking-tight">
                {stockData.symbol}
              </span>
              <a
                href={`https://www.tradingview.com/chart/?symbol=NSE:${stockData.symbol}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#2563EB] font-medium hover:underline flex items-center gap-0.5"
                title="Open TradingView chart"
              >
                TV ↗
              </a>
            </div>
            {activeCandle && (
              <div className="flex items-center gap-2 text-[11px] text-[#64748B] font-mono mt-0.5">
                <span>O: <strong className="text-[#17233B]">{activeCandle.open ?? "—"}</strong></span>
                <span>H: <strong className="text-[#17233B]">{activeCandle.high ?? "—"}</strong></span>
                <span>L: <strong className="text-[#17233B]">{activeCandle.low ?? "—"}</strong></span>
                <span>C: <strong className="text-[#17233B]">{activeCandle.close ?? "—"}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Stats Strip */}
        <div className="flex items-center gap-3 text-xs">
          <div className="text-center px-2 py-1 rounded-[4px] bg-white border border-[#E5EAF2]">
            <div className="text-[10px] text-[#94A3B8] font-medium">1M %</div>
            <div className={`font-semibold ${stockData.ret_1m_pct !== null ? (stockData.ret_1m_pct >= 0 ? "text-[#16A878]" : "text-[#EF4444]") : "text-[#94A3B8]"}`}>
              {stockData.ret_1m_pct !== null ? `${stockData.ret_1m_pct > 0 ? "+" : ""}${stockData.ret_1m_pct}%` : "—"}
            </div>
          </div>
          <div className="text-center px-2 py-1 rounded-[4px] bg-white border border-[#E5EAF2]">
            <div className="text-[10px] text-[#94A3B8] font-medium">3M %</div>
            <div className={`font-semibold ${stockData.ret_3m_pct !== null ? (stockData.ret_3m_pct >= 0 ? "text-[#16A878]" : "text-[#EF4444]") : "text-[#94A3B8]"}`}>
              {stockData.ret_3m_pct !== null ? `${stockData.ret_3m_pct > 0 ? "+" : ""}${stockData.ret_3m_pct}%` : "—"}
            </div>
          </div>
          <div className="text-center px-2 py-1 rounded-[4px] bg-white border border-[#E5EAF2]">
            <div className="text-[10px] text-[#94A3B8] font-medium">RS Rank</div>
            <div className="font-semibold text-[#17233B]">
              {stockData.rs_rank !== null ? stockData.rs_rank : "—"}
            </div>
          </div>
          <div className="text-center px-2 py-1 rounded-[4px] bg-white border border-[#E5EAF2]">
            <div className="text-[10px] text-[#94A3B8] font-medium">Vol Ratio</div>
            <div className="font-semibold text-[#17233B]">
              {stockData.vol_ratio !== null ? `${stockData.vol_ratio}x` : "—"}
            </div>
          </div>
        </div>

        {/* Controls: D/W toggle & MA filters */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-[6px] border border-[#CBD5E1] p-0.5 bg-white text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTimeframe("D")}
              className={`px-2 py-0.5 rounded-[4px] transition-colors ${timeframe === "D" ? "bg-[#2563EB] text-white" : "text-[#64748B] hover:text-[#17233B]"}`}
            >
              D
            </button>
            <button
              type="button"
              onClick={() => setTimeframe("W")}
              className={`px-2 py-0.5 rounded-[4px] transition-colors ${timeframe === "W" ? "bg-[#2563EB] text-white" : "text-[#64748B] hover:text-[#17233B]"}`}
            >
              W
            </button>
          </div>
        </div>
      </div>

      {/* MA Chips & Legend Bar */}
      <div className="px-3 py-1.5 border-b border-[#E5EAF2] flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[#94A3B8] font-medium">MAs:</span>
          <button
            type="button"
            onClick={() => toggleMA("sma_10")}
            className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.sma_10 ? "bg-[#FFF7ED] border-[#FDBA74] text-[#C2410C]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
          >
            <span className="w-2 h-0.5 bg-[#F97316] inline-block" />
            10 SMA
          </button>
          <button
            type="button"
            onClick={() => toggleMA("sma_20")}
            className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.sma_20 ? "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
          >
            <span className="w-2 h-0.5 bg-[#2563EB] inline-block" />
            20 SMA
          </button>
          <button
            type="button"
            onClick={() => toggleMA("sma_50")}
            className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.sma_50 ? "bg-[#FEFCE8] border-[#FEF08A] text-[#A16207]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
          >
            <span className="w-2 h-0.5 bg-[#EAB308] inline-block" />
            50 SMA
          </button>
          {showSMA150 && (
            <button
              type="button"
              onClick={() => toggleMA("sma_150")}
              className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.sma_150 ? "bg-[#ECFEFF] border-[#A5F3FC] text-[#0E7490]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
            >
              <span className="w-2 h-0.5 bg-[#06B6D4] inline-block" />
              150 SMA
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleMA("sma_200")}
            className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.sma_200 ? "bg-[#FAF5FF] border-[#E9D5FF] text-[#7E22CE]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
          >
            <span className="w-2 h-0.5 bg-[#9333EA] inline-block" />
            200 SMA
          </button>
          {showEMA50 && (
            <button
              type="button"
              onClick={() => toggleMA("ema_50")}
              className={`px-2 py-0.5 rounded-[4px] border flex items-center gap-1 transition-all ${visibleMAs.ema_50 ? "bg-[#FFF1F2] border-[#FECDD3] text-[#BE123C]" : "bg-white border-[#E2E8F0] text-[#94A3B8] line-through"}`}
            >
              <span className="w-2 h-0.5 bg-[#F43F5E] inline-block" />
              50 EMA
            </button>
          )}
        </div>

        {/* Volume tags key */}
        <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
            HVQ (63d Vol High)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9333EA]" />
            HVY (252d Vol High)
          </span>
        </div>
      </div>

      {/* Interactive Chart Canvas */}
      <div className="flex-1 w-full min-h-[380px] relative">
        <div ref={chartContainerRef} className="absolute inset-0 w-full h-full" />
      </div>

      {/* Attribution Footer required by Lightweight Charts */}
      <div className="px-3 py-1.5 border-t border-[#E5EAF2] flex items-center justify-between text-[10px] text-[#94A3B8] bg-[#FAFAFA]">
        <span>Candles: {candles.length} sessions (last 260d stored)</span>
        <span>
          Powered by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[#64748B] underline"
          >
            TradingView Lightweight Charts™
          </a>
        </span>
      </div>
    </div>
  );
}
