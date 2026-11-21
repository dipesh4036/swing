"use client";

import React, { useEffect, useRef } from "react";
import { createChart, LineSeries, LineStyle } from "lightweight-charts";

export default function SectorRSChart({ rsSeries = [], sectorName = "", quadrant = null }) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Determine line color by quadrant
    let lineColor = "#6366F1"; // default indigo
    if (quadrant === "leading") lineColor = "#10B981"; // green
    else if (quadrant === "improving") lineColor = "#3B82F6"; // blue
    else if (quadrant === "weakening") lineColor = "#F59E0B"; // amber
    else if (quadrant === "lagging") lineColor = "#EF4444"; // red

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94A3B8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        timeVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      crosshair: {
        vertLine: { color: "rgba(148, 163, 184, 0.3)", style: LineStyle.Dotted },
        horzLine: { color: "rgba(148, 163, 184, 0.3)", style: LineStyle.Dotted },
      },
      handleScroll: true,
      handleScale: true,
    });

    chartInstanceRef.current = chart;

    const lineSeries = chart.addSeries(LineSeries, {
      color: lineColor,
      lineWidth: 2,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
    });

    if (rsSeries && rsSeries.length > 0) {
      lineSeries.setData(rsSeries);

      // Horizontal baseline line at 100
      lineSeries.createPriceLine({
        price: 100,
        color: "rgba(148, 163, 184, 0.4)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Base 100",
      });

      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartInstanceRef.current = null;
    };
  }, [rsSeries, quadrant]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between text-xs px-3 py-2 border-b border-border/50 text-text-secondary">
        <span>RS vs Nifty 500 (Rebased to 100, 120 Sessions)</span>
        {rsSeries.length > 0 && (
          <span className="font-mono text-[11px] font-semibold text-text">
            Latest: {rsSeries[rsSeries.length - 1].value.toFixed(2)}
          </span>
        )}
      </div>
      <div ref={chartContainerRef} className="flex-1 w-full min-h-[180px]" />
    </div>
  );
}
