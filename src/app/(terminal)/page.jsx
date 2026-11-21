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
import { isDataStale } from "@/lib/freshness";

export default function MarketBreadthDashboardPage() {
  const [activeTab, setActiveTab] = useState("breadth");
  const [selectedUniverse, setSelectedUniverse] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("1M");

  const {
    data,
    capSeries,
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
    rebasedSeries,
  } = useMarketBreadth(selectedUniverse, selectedPeriod);

  // Compute data freshness: real timestamp from ingest_runs, or "—" if not available (R2)
  const updatedAgoText = React.useMemo(() => {
    if (!asOfDate || !lastUpdatedAt) return "—";
    const targetTime = new Date(lastUpdatedAt).getTime();
    if (!targetTime || isNaN(targetTime)) return "—";
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

      {/* ── Stale Data Banner ────────────────────────────────────── */}
      {asOfDate && isDataStale(asOfDate) && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2 mb-4">
          <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Data is stale: last update {asOfDate}</span>
        </div>
      )}

      {/* ── Error Banner ────────────────────────────────────────── */}
      {error && (
        <div className="bg-bearish-bg border border-bearish-border rounded-lg p-3 text-bearish text-xs flex items-center gap-2 mb-4">
          <AlertTriangle size={15} />
          <span>Error loading market breadth data: {error}</span>
        </div>
      )}

      {/* ── Loading Skeleton / Content ──────────────────────────── */}
      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
            <div className="lg:col-span-4 xl:col-span-3 h-80 bg-bg-secondary border border-border rounded-lg" />
            <div className="lg:col-span-8 xl:col-span-6 h-80 bg-bg-secondary border border-border rounded-lg" />
            <div className="lg:col-span-12 xl:col-span-3 h-80 bg-bg-secondary border border-border rounded-lg" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-40 bg-bg-secondary border border-border rounded-lg" />
            ))}
          </div>
        </div>
      ) : !asOfDate || history.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-8 text-center space-y-2">
          <div className="text-base font-semibold text-text">No data available</div>
          <p className="text-xs text-text-secondary">
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
            rebasedSeries={rebasedSeries}
            capSeries={capSeries || data?.capSeries}
          />

          {/* Bottom Section: Indices Row */}
          <IndicesSection indices={formattedIndices} />

          {/* Data Freshness Footer (Phase 5) */}
          {asOfDate && (
            <footer className="pt-4 pb-6 text-center text-xs text-text-secondary border-t border-border mt-6">
              <span>
                Data as of <strong className="font-semibold text-text">{asOfDate}</strong> · Updated {updatedAgoText}
              </span>
            </footer>
          )}
        </div>
      )}
    </PageContainer>
  );
}
