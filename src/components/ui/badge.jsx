"use client";

import React from "react";

export function StatusBadge({
  status, // 'positive' | 'negative' | 'neutral' | 'warning' | 'info'
  children,
  showDot = false,
  className = "",
}) {
  const styles = {
    positive: "bg-bullish-bg text-bullish border-bullish-border",
    bullish: "bg-bullish-bg text-bullish border-bullish-border",
    negative: "bg-bearish-bg text-bearish border-bearish-border",
    bearish: "bg-bearish-bg text-bearish border-bearish-border",
    neutral: "bg-neutral-bg text-text-secondary border-border",
    warning: "bg-warning-bg text-warning border-warning/30",
    info: "bg-primary-subtle text-primary border-accent-border",
  }[status] || "bg-neutral-bg text-text-secondary border-border";

  const dotColors = {
    positive: "bg-bullish",
    bullish: "bg-bullish",
    negative: "bg-bearish",
    bearish: "bg-bearish",
    neutral: "bg-text-muted",
    warning: "bg-warning",
    info: "bg-primary",
  }[status] || "bg-text-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] border text-xs font-medium leading-tight tabular-nums transition-colors ${styles} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors}`} />}
      {children}
    </span>
  );
}

export function PillBadge({ children, active = false, onClick, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
        active
          ? "bg-primary text-text-inverse font-semibold"
          : "bg-neutral-bg text-text-secondary hover:text-text hover:bg-bg-hover"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export default StatusBadge;

