/**
 * Centralized Recharts Visual Configuration
 * Single source of truth for all charts across the platform.
 */

import { TOKENS } from "./design-tokens";

export const CHART_THEME = {
  colors: {
    primary: "var(--color-primary, #4F46E5)",
    primaryFill: "rgba(79, 70, 229, 0.12)",
    primaryGradient: {
      from: "rgba(79, 70, 229, 0.25)",
      to: "rgba(79, 70, 229, 0.01)",
    },
    benchmark: "var(--color-text-muted, #A1A1AA)",
    benchmarkFill: "rgba(161, 161, 170, 0.12)",

    bullish: "var(--color-bullish, #059669)",
    bullishFill: "rgba(5, 150, 105, 0.15)",

    bearish: "var(--color-bearish, #E11D48)",
    bearishFill: "rgba(225, 29, 72, 0.15)",

    largeCap: "var(--color-primary, #4F46E5)",
    midCap: "#F97316",
    smallCap: "var(--color-bullish, #059669)",
  },

  grid: {
    stroke: "var(--color-border-subtle, #F4F4F5)",
    strokeDasharray: "3 3",
    vertical: false,
    horizontal: true,
  },

  axis: {
    tick: {
      fill: "var(--color-text-secondary, #71717A)",
      fontSize: 10,
      fontFamily: "'Inter', sans-serif",
    },
    line: false,
    tickLine: false,
  },

  referenceLine: {
    stroke: "var(--color-border, #E4E4E7)",
    strokeDasharray: "2 2",
    strokeWidth: 1,
  },

  line: {
    strokeWidth: 1.75,
    dot: false,
    activeDot: { r: 4, strokeWidth: 1.5, stroke: "#FFFFFF" },
  },

  bar: {
    radius: [2, 2, 0, 0],
    maxBarSize: 24,
  },

  tooltip: {
    wrapperStyle: { outline: "none", zIndex: 100 },
    contentStyle: {
      backgroundColor: "var(--color-surface, #FFFFFF)",
      border: "1px solid var(--color-border, #E4E4E7)",
      borderRadius: "6px",
      padding: "8px 12px",
      boxShadow: "none",
      fontSize: "12px",
      fontFamily: "'Inter', sans-serif",
      color: "var(--color-text, #18181B)",
    },
  },
};

export default CHART_THEME;

