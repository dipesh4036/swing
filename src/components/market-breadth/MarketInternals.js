"use client";

import React from "react";
import { Info } from "lucide-react";
import NewHighsLows from "./NewHighsLows";
import AdvanceDecline from "./AdvanceDecline";
import FourPercentMovers from "./FourPercentMovers";
import LargeMidSmall from "./LargeMidSmall";
import BreakoutsBreakdowns from "./BreakoutsBreakdowns";
import ParticipationHistory from "./ParticipationHistory";

export function MarketInternals({ keyMetrics, history = [], performance = {} }) {
  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#E5EAF2]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#17233B] uppercase tracking-wider">
            Market internals
          </span>
          <span title="Granular underlying market health indicators">
            <Info size={13} className="text-[#94A3B8] cursor-pointer" />
          </span>
        </div>
      </div>

      {/* 6 Analytics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <NewHighsLows keyMetrics={keyMetrics} history={history} />
        <AdvanceDecline keyMetrics={keyMetrics} history={history} />
        <FourPercentMovers keyMetrics={keyMetrics} history={history} />
        <LargeMidSmall performance={performance} history={history} />
        <BreakoutsBreakdowns keyMetrics={keyMetrics} history={history} />
        <ParticipationHistory keyMetrics={keyMetrics} history={history} />
      </div>
    </div>
  );
}

export default MarketInternals;
