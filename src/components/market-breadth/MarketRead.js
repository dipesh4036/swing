"use client";

import React from "react";
import BaseCard from "@/components/ui/card";
import StageAnalysis from "./StageAnalysis";

export function MarketRead({ data }) {
  const { indicators = [], stageAnalysis, divergenceNote } = data || {};

  const getToneDot = (tone) => {
    switch (tone) {
      case "positive":
        return "bg-bullish";
      case "negative":
        return "bg-bearish";
      case "warning":
        return "bg-warning";
      default:
        return "bg-text-muted";
    }
  };

  const getToneText = (tone) => {
    switch (tone) {
      case "positive":
        return "text-bullish";
      case "negative":
        return "text-bearish";
      case "warning":
        return "text-warning";
      default:
        return "text-text-secondary";
    }
  };

  return (
    <BaseCard className="flex flex-col justify-between h-full space-y-4" padding="p-4">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-border">
          <span className="text-xs font-bold text-text uppercase tracking-wider">
            Market Read
          </span>
        </div>

        {/* Indicators List — All indicators shown without collapsed state */}
        <div className="space-y-3">
          {indicators.map((item) => (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-medium text-text">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${getToneDot(item.tone)}`} />
                  <span>{item.name}</span>
                </div>
                <span className={`font-semibold text-xs ${getToneText(item.tone)}`}>
                  {item.status}
                </span>
              </div>
              <p className="text-xs text-text-secondary pl-4 leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        {/* Divergence Explainer (Daily momentum vs short-term participation) */}
        {divergenceNote && (
          <div className="mt-3.5 p-2.5 rounded-md bg-primary-subtle border border-accent-border text-xs leading-relaxed text-text">
            <span className="font-semibold block mb-0.5 text-primary">
              Daily Momentum vs Participation:
            </span>
            <span>{divergenceNote}</span>
          </div>
        )}
      </div>

      {/* Stage Analysis Section */}
      {stageAnalysis && <StageAnalysis data={stageAnalysis} />}
    </BaseCard>
  );
}

export default MarketRead;
