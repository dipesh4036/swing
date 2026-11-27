"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart2, HelpCircle, RefreshCw, X } from "lucide-react";
import {
  BreadcrumbItem,
  ClassificationLevel,
  ConstituentStockRow,
  ExtendedPeriod,
  IndustryGroupRow,
  RankingsResponse,
  StrengthUniverse,
} from "@/lib/industry-types";
import { RankCycleMode, nextRankCycleState } from "@/lib/industry-formatters";
import PageContainer, { SectionHeader } from "@/components/shared/PageContainer";
import { BaseCard } from "@/components/ui/card";
import ControlBar from "./ControlBar";
import MarketSnapshot from "./MarketSnapshot";
import TopGroupsStrip from "./TopGroupsStrip";
import GroupRowList from "./GroupRowList";
import RankingTable from "./RankingTable";
import GroupDetails from "./GroupDetails";
import RotationChart from "./RotationChart";
import BottomSheet from "./BottomSheet";
import StockDetailPanel from "@/components/industry-strength/StockDetailPanel";

const NEXT_LEVEL: Record<ClassificationLevel, ClassificationLevel | null> = {
  macro: "sector",
  sector: "industry",
  industry: "basic_industry",
  basic_industry: null,
};

export default function SectorDashboard() {
  const [level, setLevel] = useState<ClassificationLevel>("industry");
  const [period, setPeriod] = useState<ExtendedPeriod>("1m");
  const [universe, setUniverse] = useState<StrengthUniverse>("all");
  const [showSmall, setShowSmall] = useState(false);
  const [moreColumns, setMoreColumns] = useState(false);
  const [rankMode, setRankMode] = useState<RankCycleMode>("normal");
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rank_trend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showGuide, setShowGuide] = useState(false);

  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [chartGroups, setChartGroups] = useState<{ groupId: string; label: string }[]>([]);
  const [chartOpen, setChartOpen] = useState(false);
  const [compareToast, setCompareToast] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<ConstituentStockRow | null>(null);

  const detailsRef = useRef<HTMLDivElement | null>(null);
  const lastRowTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("industry_more_columns");
      if (saved === "true") setMoreColumns(true);
    } catch {
      /* ignore storage access error */
    }
  }, []);

  const handleMoreColumnsChange = (val: boolean) => {
    setMoreColumns(val);
    try {
      window.localStorage.setItem("industry_more_columns", val ? "true" : "false");
    } catch {
      /* ignore */
    }
  };

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        level,
        universe,
        sortBy,
        sortDir,
        showSmall: showSmall ? "true" : "false",
      });
      if (parentId) qs.set("parentId", parentId);
      if (search.trim()) qs.set("search", search.trim());

      const res = await fetch(`/api/industry-strength?${qs.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as RankingsResponse;
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load industry strength");
    } finally {
      setLoading(false);
    }
  }, [level, universe, showSmall, parentId, search, sortBy, sortDir]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  const has1yYtd = useMemo(() => {
    if (!data?.groups || data.groups.length === 0) return false;
    return data.groups.some((g) => g.median1y !== null || g.medianYtd !== null);
  }, [data]);

  const handleLevelChange = (nextLevel: ClassificationLevel) => {
    setLevel(nextLevel);
    setParentId(null);
    setSelectedGroupId(null);
  };

  const handleBreadcrumbSelect = (gid: string | null) => {
    if (!gid) {
      setLevel("macro");
      setParentId(null);
      setSelectedGroupId(null);
      return;
    }
    const crumb: BreadcrumbItem | undefined = data?.breadcrumbs.find((b) => b.groupId === gid);
    if (crumb) {
      const targetLevel = NEXT_LEVEL[crumb.level] || crumb.level;
      setLevel(targetLevel);
      setParentId(gid);
      setSelectedGroupId(null);
    }
  };

  const handleDrillDown = (group: IndustryGroupRow) => {
    const nextLevel = NEXT_LEVEL[group.level];
    if (!nextLevel) return;
    setLevel(nextLevel);
    setParentId(group.groupId);
    setSelectedGroupId(null);
  };

  const handleRankHeaderClick = () => {
    const nextMode = nextRankCycleState(rankMode);
    setRankMode(nextMode);
    if (nextMode === "climbers") {
      setSortBy("rank_trend_change");
      setSortDir("desc");
    } else if (nextMode === "fallers") {
      setSortBy("rank_trend_change");
      setSortDir("asc");
    } else {
      setSortBy("rank_trend");
      setSortDir("asc");
    }
  };

  const handleSortChange = (col: string) => {
    if (col === "rank_trend") {
      handleRankHeaderClick();
      return;
    }
    setRankMode("normal");
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const handleSelectGroup = (groupId: string, triggerEl?: HTMLElement | null) => {
    if (triggerEl) lastRowTriggerRef.current = triggerEl;
    setSelectedGroupId(groupId);
  };

  const handleCloseDrawer = () => {
    setSelectedGroupId(null);
    if (lastRowTriggerRef.current) {
      lastRowTriggerRef.current.focus();
    }
  };

  const handleToggleChartGroup = (group: IndustryGroupRow) => {
    setChartGroups((prev) => {
      const exists = prev.some((item) => item.groupId === group.groupId);
      if (exists) {
        const next = prev.filter((item) => item.groupId !== group.groupId);
        if (next.length === 0) setChartOpen(false);
        return next;
      }
      if (prev.length >= 6) {
        setCompareToast("Max 6 groups can be compared on the chart.");
        return prev;
      }
      if (prev.length === 0) setChartOpen(true);
      return [...prev, { groupId: group.groupId, label: group.label }];
    });
  };

  const selectedGroupMeta = useMemo(() => {
    if (!selectedGroupId || !data?.groups) return null;
    return data.groups.find((g) => g.groupId === selectedGroupId) || null;
  }, [selectedGroupId, data]);

  const chartGroupIdSet = useMemo(
    () => new Set(chartGroups.map((g) => g.groupId)),
    [chartGroups]
  );

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="max-w-[1280px] mx-auto space-y-3">
          <div className="h-12 rounded-lg bg-bg-secondary border border-border" />
          <div className="h-10 rounded-lg bg-bg-secondary border border-border" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-xl bg-bg-secondary border border-border" />
            ))}
          </div>
          <div className="h-80 rounded-xl bg-bg-secondary border border-border" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="max-w-[1280px] mx-auto space-y-3 pb-16">
        {/* 1. Compact Header + One Market Snapshot row */}
        <SectionHeader
          title="Industries"
          info="Trend Rank combines 1M/3M/6M trend, >50/>200 SMA breadth, and RS>=70 leader share"
          subtitle={
            data?.snapshotDate
              ? `${data.snapshotDate} · ${data.coverage.eligibleStocks.toLocaleString("en-IN")} liquid · ${
                  data.coverage.coveragePct ?? "—"
                }% classified · ${data.coverage.nseVerifiedPct ?? "—"}% NSE-verified`
              : "No completed snapshot available"
          }
          action={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowGuide((v) => !v)}
                aria-label="How ranks work"
                title="How ranks work"
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-medium cursor-pointer ${
                  showGuide
                    ? "bg-primary-subtle border-accent-border text-primary"
                    : "border-border bg-surface text-text-secondary hover:text-text"
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">How ranks work</span>
              </button>
              <button
                type="button"
                onClick={fetchRankings}
                disabled={loading}
                aria-label="Refresh rankings"
                className="p-1.5 rounded-md border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          }
        />

        {showGuide && (
          <BaseCard padding="p-3" bg="bg-bg-secondary">
            <div className="text-[12px] text-text-secondary space-y-1">
              <div className="font-semibold text-text">How Ranks Work</div>
              <p>
                Top 3 picks groups with the lowest worst rank across 1D, 1W, 1M, and 3M median returns (minimax).
                Table Rank combines Trend (1M/3M/6M), Breadth (&gt;50/&gt;200 SMA), and Leaders (RS &ge; 70).
                Timeframe chips update only the MED column.
              </p>
            </div>
          </BaseCard>
        )}

        {error && (
          <BaseCard padding="p-3" bg="bg-warning-bg" className="text-warning text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}{data ? " (showing last completed snapshot)" : ""}</span>
            </div>
            <button
              type="button"
              onClick={fetchRankings}
              className="px-2.5 py-1 rounded bg-surface border border-border text-text font-medium cursor-pointer"
            >
              Retry
            </button>
          </BaseCard>
        )}

        {data && (
          <>
            <MarketSnapshot
              summary={data.summary}
              onSelectGroup={(gid) => handleSelectGroup(gid)}
            />

            {/* 2. Sticky Control Bar */}
            <ControlBar
              level={level}
              onLevelChange={handleLevelChange}
              period={period}
              onPeriodChange={setPeriod}
              has1yYtd={has1yYtd}
              universe={universe}
              onUniverseChange={setUniverse}
              showSmall={showSmall}
              onShowSmallChange={setShowSmall}
              moreColumns={moreColumns}
              onMoreColumnsChange={handleMoreColumnsChange}
              search={search}
              onSearchChange={setSearch}
              breadcrumbs={data.breadcrumbs}
              onBreadcrumbSelect={handleBreadcrumbSelect}
              onToggleGuide={() => setShowGuide((v) => !v)}
            />

            {/* 3. Top 3 Across All Timeframes */}
            <TopGroupsStrip
              topGroups={data.topGroups ?? []}
              topGroupsAsOf={data.topGroupsAsOf ?? null}
              loading={loading}
              onSelectGroup={(gid) => handleSelectGroup(gid)}
            />

            {/* Collapsible Desktop Rotation Chart (opened from Compare bar) */}
            {chartOpen && chartGroups.length > 0 && (
              <div className="hidden lg:block rounded-xl border border-border bg-surface p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">Rotation Chart</span>
                  <button
                    type="button"
                    onClick={() => setChartOpen(false)}
                    aria-label="Close rotation chart"
                    className="p-1 rounded text-text-secondary hover:text-text cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <RotationChart
                  selectedGroups={chartGroups}
                  universe={universe}
                  onRemoveGroup={(gid) =>
                    setChartGroups((prev) => prev.filter((item) => item.groupId !== gid))
                  }
                />
              </div>
            )}

            {/* 4. Mobile Ranked List (< 1024px) */}
            <div className="lg:hidden">
              <GroupRowList
                groups={data.groups}
                period={period}
                rankMode={rankMode}
                onCycleRankMode={handleRankHeaderClick}
                selectedGroupId={selectedGroupId}
                onSelectGroup={(gid) => handleSelectGroup(gid)}
                chartGroupIds={chartGroupIdSet}
                onToggleCompare={handleToggleChartGroup}
                search={search}
              />
            </div>

            {/* 5. Desktop Ranked Table (>= 1024px) */}
            <div className="hidden lg:block">
              <RankingTable
                groups={data.groups}
                level={level}
                period={period}
                moreColumns={moreColumns}
                rankMode={rankMode}
                onRankHeaderClick={handleRankHeaderClick}
                sortBy={sortBy}
                sortDir={sortDir}
                onSortChange={handleSortChange}
                selectedGroupId={selectedGroupId}
                onSelectGroup={(g, el) => handleSelectGroup(g.groupId, el)}
                onDrillDown={handleDrillDown}
                chartGroupIds={chartGroups.map((g) => g.groupId)}
                onToggleChartGroup={handleToggleChartGroup}
              />
            </div>

            {selectedGroupId && (
              <div ref={detailsRef}>
                <GroupDetails
                  groupId={selectedGroupId}
                  universe={universe}
                  groupRank={selectedGroupMeta?.rankTrend}
                  groupRankChange={selectedGroupMeta?.rankTrendChange}
                  onClose={handleCloseDrawer}
                  onSelectStock={(st) => setSelectedStock(st)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky Compare Bottom Bar */}
      {chartGroups.length > 0 && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-1.5rem)] max-w-md rounded-xl border border-accent-border bg-surface shadow-lg px-3.5 py-2.5 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-text tabular-nums">
            {chartGroups.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setChartGroups([]);
                setChartOpen(false);
              }}
              className="text-xs text-text-secondary hover:text-text cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setChartOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>{chartOpen ? "Hide rotation chart" : "View rotation chart"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Rotation Chart Bottom Sheet */}
      <div className="lg:hidden">
        <BottomSheet
          open={chartOpen && chartGroups.length > 0}
          onClose={() => setChartOpen(false)}
          title="Rotation Chart"
        >
          <RotationChart
            selectedGroups={chartGroups}
            universe={universe}
            onRemoveGroup={(gid) =>
              setChartGroups((prev) => prev.filter((item) => item.groupId !== gid))
            }
          />
        </BottomSheet>
      </div>

      {compareToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-16 right-4 z-40 px-3.5 py-2 rounded-md bg-surface border border-accent-border text-xs font-medium text-text flex items-center gap-2"
        >
          <span>{compareToast}</span>
          <button
            type="button"
            onClick={() => setCompareToast(null)}
            className="text-text-secondary hover:text-text cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}

      {selectedStock && (
        <StockDetailPanel
          stock={{
            token: selectedStock.token,
            symbol: selectedStock.symbol,
            name: selectedStock.name,
            sector: selectedStock.sector,
            industry: selectedStock.industry,
            basic_industry: selectedStock.basicIndustry,
            in_universe: true,
            close: selectedStock.close,
            ret_1d: selectedStock.ret1d,
            ret_1w: selectedStock.ret1w,
            ret_1m: selectedStock.ret1m,
            ret_3m: selectedStock.ret3m,
            ret_6m: selectedStock.ret6m,
            pct_from_52w_high: selectedStock.pctFrom52wHigh,
            rs_rank: selectedStock.rsRating,
            above_20ema: selectedStock.above20ema,
            above_50dma: selectedStock.above50dma,
            above_200dma: selectedStock.above200dma,
            mcap_cr: selectedStock.mcapCr,
          }}
          source="industry"
          onShowSector={(sec: string) => {
            setSelectedStock(null);
            setLevel("sector");
            setParentId(null);
            setSearch(sec || "");
          }}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </PageContainer>
  );
}
