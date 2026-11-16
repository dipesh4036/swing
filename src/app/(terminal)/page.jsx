"use client";

import React, { useState } from "react";
import DashboardHeader from "@/components/market-breadth/DashboardHeader";
import MarketRead from "@/components/market-breadth/MarketRead";
import MarketCondition from "@/components/market-breadth/MarketCondition";
import InstitutionalActivity from "@/components/market-breadth/InstitutionalActivity";
import MarketInternals from "@/components/market-breadth/MarketInternals";
import IndicesSection from "@/components/market-breadth/IndicesSection";
import PageContainer from "@/components/shared/PageContainer";
import { useMarketBreadth } from "@/hooks/useMarketBreadth";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function MarketBreadthDashboardPage() {
  const [activeTab, setActiveTab] = useState("breadth");
  const [selectedUniverse, setSelectedUniverse] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("1M");

  const {
    isLoading,
    error,
    asOfDate,
    lastUpdatedAt,
    coverage,
    keyMetrics,
    history,
    marketRead,
    participationData,
    participationStats,
    stageComparisonData,
    institutionalFlows,
    highsLows,
    formattedIndices,
    performance,
  } = useMarketBreadth(selectedUniverse, selectedPeriod);

  // Compute data freshness per Phase 5 spec
  const updatedAgoText = React.useMemo(() => {
    if (!asOfDate) return null;
    let targetTime = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : null;
    if (!targetTime || isNaN(targetTime)) {
      targetTime = new Date(`${asOfDate}T10:00:00Z`).getTime();
    }
    const diffHours = Math.max(0, Math.floor((Date.now() - targetTime) / (1000 * 60 * 60)));
    if (diffHours === 0) return "just now";
    if (diffHours === 1) return "1 hour ago";
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }, [asOfDate, lastUpdatedAt]);

  return (
    <PageContainer>
      {/* ── Top Header with Tabs & Universe/Period Controls ─────── */}
      <DashboardHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        selectedUniverse={selectedUniverse}
        onUniverseChange={setSelectedUniverse}
        selectedPeriod={selectedPeriod}
        onPeriodChange={setSelectedPeriod}
        asOfDate={asOfDate}
        coverage={coverage}
      />

      {/* ── Error Banner ────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-xs flex items-center gap-2 mb-4">
          <AlertTriangle size={15} />
          <span>Error loading market breadth data: {error}</span>
        </div>
      )}

      {/* ── Loading Skeleton / Content ──────────────────────────── */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            <div className="lg:col-span-4 xl:col-span-3 h-80 bg-slate-100 rounded-xl" />
            <div className="lg:col-span-8 xl:col-span-6 h-80 bg-slate-100 rounded-xl" />
            <div className="lg:col-span-12 xl:col-span-3 h-80 bg-slate-100 rounded-xl" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-40 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      ) : !asOfDate || history.length === 0 ? (
        <div className="bg-white border border-[#E5EAF2] rounded-xl p-8 text-center space-y-2">
          <div className="text-base font-semibold text-[#17233B]">No data available</div>
          <p className="text-xs text-[#64748B]">
            No market breadth records found for universe &apos;{selectedUniverse}&apos; and period &apos;{selectedPeriod}&apos;.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Main 3-Column Overview Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            {/* Column 1: Market Read + Stage Analysis */}
            <div className="lg:col-span-4 xl:col-span-3">
              <MarketRead data={marketRead} />
            </div>

            {/* Column 2: Market Condition (Participation + Stage 2 vs 4) */}
            <div className="lg:col-span-8 xl:col-span-6">
              <MarketCondition
                participationData={participationData}
                participationStats={participationStats}
                stageComparisonData={stageComparisonData}
                asOfDate={asOfDate}
              />
            </div>

            {/* Column 3: Institutional Activity (FII/DII + 20D H/L) */}
            <div className="lg:col-span-12 xl:col-span-3">
              <InstitutionalActivity
                flows={institutionalFlows}
                highsLows={highsLows}
                asOfDate={asOfDate}
              />
            </div>
          </div>

          {/* Market Internals Grid (6 Analytics Cards) */}
          <MarketInternals
            keyMetrics={keyMetrics}
            history={history}
            performance={performance}
          />

          {/* Bottom Section: Indices Row */}
          <IndicesSection indices={formattedIndices} />

          {/* Data Freshness Footer (Phase 5) */}
          {asOfDate && (
            <footer className="pt-4 pb-6 text-center text-xs text-[#64748B] border-t border-[#E5EAF2] mt-6">
              <span>
                Data as of <strong className="font-semibold text-[#17233B]">{asOfDate}</strong> · Updated {updatedAgoText}
              </span>
            </footer>
          )}
        </div>
      )}
    </PageContainer>
  );
}
