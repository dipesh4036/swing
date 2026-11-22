"use client";

import React from "react";

/**
 * Chip row for toggling pattern layers on chart.
 */
export function PatternLayersBar({
  layers,
  onToggleLayer,
  counts = {},
  timeframe = "D",
  offscreenCount = 0,
}) {
  const isDaily = timeframe === "D";

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1 px-2 text-xs border-b border-border/40 bg-muted/20">
      {/* Pattern Lines Chip */}
      <button
        type="button"
        disabled={!isDaily}
        onClick={() => onToggleLayer("patternLines")}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          !isDaily
            ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
            : layers.patternLines
            ? "bg-primary/10 text-primary border border-primary/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
        title={!isDaily ? "Patterns are daily only" : "Toggle pattern boundary lines"}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        Pattern lines
        {counts.patternLines > 0 && (
          <span className="font-mono text-[10px] opacity-75">
            {counts.patternLines}
          </span>
        )}
      </button>

      {/* Breakout + Retest Chip */}
      <button
        type="button"
        disabled={!isDaily}
        onClick={() => onToggleLayer("breakoutRetest")}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          !isDaily
            ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
            : layers.breakoutRetest
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
        title={!isDaily ? "Patterns are daily only" : "Toggle breakout glyphs and retest bands"}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        Breakout + retest
        {counts.breakoutRetest > 0 && (
          <span className="font-mono text-[10px] opacity-75">
            {counts.breakoutRetest}
          </span>
        )}
      </button>

      {/* Base + Pivot Chip */}
      <button
        type="button"
        disabled={!isDaily}
        onClick={() => onToggleLayer("basePivot")}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          !isDaily
            ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
            : layers.basePivot
            ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
        title={!isDaily ? "Patterns are daily only" : "Toggle base box and pivot lines"}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        Base + pivot
        {counts.basePivot > 0 && (
          <span className="font-mono text-[10px] opacity-75">
            {counts.basePivot}
          </span>
        )}
      </button>

      {/* 21 EMA Chip */}
      <button
        type="button"
        onClick={() => onToggleLayer("ema_21")}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
          layers.ema_21
            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30"
            : "bg-muted/50 text-muted-foreground hover:bg-muted"
        }`}
        title="Toggle 21-period exponential moving average"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        21 EMA
      </button>

      {/* Weekly notice badge if not daily */}
      {!isDaily && (
        <span className="text-[10px] text-muted-foreground italic ml-auto">
          Patterns are daily only
        </span>
      )}

      {/* Muted off-screen anchor indicator */}
      {isDaily && offscreenCount > 0 && (
        <span className="text-[10px] font-mono text-muted-foreground ml-auto bg-muted/60 px-1.5 py-0.5 rounded">
          ◂ {offscreenCount} earlier
        </span>
      )}
    </div>
  );
}
