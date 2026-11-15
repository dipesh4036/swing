/**
 * Application & design tokens for the Market Breadth Dashboard.
 */

export const THEME_COLORS = {
  bgPage: "#F8FAFC",
  bgCard: "#FFFFFF",
  textPrimary: "#0F172A", // Dark navy / slate-900
  textSecondary: "#64748B", // Slate-500
  textMuted: "#94A3B8", // Slate-400
  border: "#E2E8F0", // Slate-200
  borderLight: "#F1F5F9",

  // Chart specific
  primaryBlue: "#2563EB", // Primary line / accent
  primaryBlueFill: "#DBEAFE", // Area gradient
  pinkRed: "#F43F5E", // Bearish / Stage 4 / Lows / Negative
  pinkRedFill: "#FFE4E6",
  greenBullish: "#10B981", // Bullish / Positives
  greenFill: "#D1FAE5",
  benchmarkGrey: "#94A3B8", // Nifty 500 line
  amberWarning: "#F59E0B",
  orangeMid: "#F97316", // Midcap
};

export const STOCK_UNIVERSES = [
  { id: "nifty500", label: "Nifty 500", count: 501 },
  { id: "nifty200", label: "Nifty 200", count: 200 },
  { id: "nifty100", label: "Nifty 100", count: 100 },
  { id: "nifty_midcap150", label: "Midcap 150", count: 150 },
  { id: "nifty_smallcap250", label: "Smallcap 250", count: 251 },
  { id: "all", label: "All stocks", count: 2599 },
];

export const PERIOD_OPTIONS = [
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "1Y", label: "1Y" },
  { id: "YTD", label: "YTD" },
  { id: "ALL", label: "ALL" },
];
