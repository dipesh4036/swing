"use client";

import React, { useState, useEffect, useId } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  AreaChart,
  Area,
} from "recharts";

export function SparklineChart({
  data = [],
  dataKey = "val",
  color = "#2563EB",
  fill = false,
  height = 28,
  width = "100%",
  className = "",
}) {
  const [mounted, setMounted] = useState(false);
  const rawId = useId();
  const uniqueId = rawId.replace(/[^a-zA-Z0-9-_]/g, "");

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        style={{ height, width }}
        className="w-full bg-[#F8FAFC] rounded-[2px] animate-pulse"
      />
    );
  }

  if (!data || data.length < 2) return null;

  return (
    <div
      style={{ height, width, minHeight: height }}
      className={`w-full min-w-0 relative ${className}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        {fill ? (
          <AreaChart data={data} margin={{ top: 2, right: 1, left: 1, bottom: 2 }}>
            <defs>
              <linearGradient
                id={`${uniqueId}-spark-${color.replace("#", "")}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <YAxis domain={["auto", "auto"]} hide />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#${uniqueId}-spark-${color.replace("#", "")})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 2, right: 1, left: 1, bottom: 2 }}>
            <YAxis domain={["auto", "auto"]} hide />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default SparklineChart;
