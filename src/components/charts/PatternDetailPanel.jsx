"use client";

import React from "react";
import { formatPatternDate } from "@/lib/patterns/explain";

/**
 * Status Chip with neutral styling
 */
function PatternStatusChip({ status }) {
  let label = "Forming";
  let classes = "bg-muted text-muted-foreground border-border";

  switch (status) {
    case "at_line":
      label = "At the line";
      classes = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
      break;
    case "broke_out":
      label = "Broke out";
      classes = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
      break;
    case "broke_down":
      label = "Broke down";
      classes = "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30";
      break;
    default:
      label = "Forming";
      classes = "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/30";
      break;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${classes}`}>
      {label}
    </span>
  );
}

/**
 * Pattern panel under the chart
 */
export function PatternDetailPanel({
  patterns = [],
  focusedPatternId = null,
  onSelectPattern,
  reason = null,
}) {
  // Empty state handling
  if (!patterns || patterns.length === 0) {
    let emptyMsg = "No pattern found on the daily chart";
    if (reason === "insufficient_history") {
      emptyMsg = "Not enough daily history";
    }

    return (
      <div className="p-4 border-t border-border bg-card/50 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{emptyMsg}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Pattern detection requires at least 60 daily trading sessions.
        </p>
        <div className="mt-3 pt-2 border-t border-border/40 text-[10px] text-muted-foreground">
          Pattern finder only. It names a pattern and where the close sits against its line. It gives no score, target, entry or stop.
        </div>
      </div>
    );
  }

  const focusedPattern =
    patterns.find((p) => p.id === focusedPatternId) || patterns[0];

  const { title, status, window, metrics, rule_text } = focusedPattern;
  const startFmt = formatPatternDate(window?.start_date);
  const endFmt = formatPatternDate(window?.end_date);
  const foundFmt = formatPatternDate(window?.found_date);

  const atrBeyond = metrics?.atr_beyond ?? 0;
  const atrSign = atrBeyond >= 0 ? "+" : "";
  const atrFormatted = `${atrSign}${atrBeyond.toFixed(2)} ATR`;

  return (
    <div className="p-3 border-t border-border bg-card/50 text-xs space-y-2.5">
      {/* Header Block: Title & Status Chip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
          <PatternStatusChip status={status} />
        </div>

        {/* Other patterns on this chart chips */}
        {patterns.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
            <span className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider whitespace-nowrap">
              Other patterns:
            </span>
            {patterns.map((p) => {
              const isSelected = p.id === focusedPattern.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelectPattern?.(p.id)}
                  className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors border ${
                    isSelected
                      ? "bg-primary text-primary-foreground font-semibold border-primary"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted border-border/60"
                  }`}
                >
                  {p.title}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Facts Line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground font-mono">
        <span>
          Span: <strong className="text-foreground font-sans font-medium">{startFmt}</strong> to{" "}
          <strong className="text-foreground font-sans font-medium">{endFmt}</strong>
        </span>
        <span>
          Found: <strong className="text-foreground font-sans font-medium">{foundFmt}</strong>
        </span>
        <span>
          Close vs line:{" "}
          <strong
            className={`font-semibold ${
              atrBeyond > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : atrBeyond < 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-foreground"
            }`}
          >
            {atrFormatted}
          </strong>
        </span>
        {metrics?.touches && (
          <span>
            Touches: <strong className="text-foreground">{metrics.touches}</strong>
          </span>
        )}
        {metrics?.volume_ratio && (
          <span>
            Vol ratio: <strong className="text-foreground">{metrics.volume_ratio}×</strong>
          </span>
        )}
      </div>

      {/* Rule Text */}
      {rule_text && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {rule_text}
        </p>
      )}

      {/* Muted Legend */}
      <div className="text-[10px] text-muted-foreground/80 leading-normal border-t border-border/30 pt-1.5">
        <span className="font-semibold text-muted-foreground">Legend:</span> Red: line broken upward; blue: line broken downward; grey wash: retest band; small circles: swing points; filled dot: breakout close; ring: close back at the line; cross: close back inside
      </div>

      {/* Exact Required Footer */}
      <div className="pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground italic">
        Pattern finder only. It names a pattern and where the close sits against its line. It gives no score, target, entry or stop.
      </div>
    </div>
  );
}
