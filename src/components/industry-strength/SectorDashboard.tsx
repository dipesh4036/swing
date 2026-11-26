"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, RefreshCw } from "lucide-react";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import ClassificationTabs from "./ClassificationTabs";
import SummaryCards from "./SummaryCards";
import RankingTable from "./RankingTable";
import GroupDetails from "./GroupDetails";
import RotationChart from "./RotationChart";
import StockDetailPanel from "@/components/sectors/StockDetailPanel";

const NEXT_LEVEL: Record<ClassificationLevel, ClassificationLevel | null> = {
  macro: "sector",
  sector: "industry",
  industry: "basic_industry",
  basic_industry: null,
};

const UNIVERSE_OPTIONS: { id: StrengthUniverse; label: string }[] = [
  { id: "all", label: "All NSE" },
  { id: "liquid", label: "Liquid Only" },
];

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
  const [compareToast, setCompareToast] = useState<string | null>(null);
  const [selectedStock, setSelectedStock] = useState<ConstituentStockRow | null>(null);

  const detailsRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const lastRowTriggerRef = useRef<HTMLElement | null>(null);

  // Restore "More columns" preference safely
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

  useEffect(() => {
    if (data?.groups && data.groups.length > 0 && chartGroups.length === 0) {
      setChartGroups(
        data.groups.slice(0, 3).map((g) => ({ groupId: g.groupId, label: g.label }))
      );
    }
  }, [data, chartGroups.length]);

  const has1yYtd = useMemo(() => {
    if (!data?.groups || data.groups.length === 0) return true;
    return data.groups.some((g) => g.median1y !== null || g.medianYtd !== null);
  }, [data]);

  const handleRankHeaderClick = () => {
    const next = nextRankCycleState(rankMode);
    setRankMode(next);
    if (next === "normal") {
      setSortBy("rank_trend");
      setSortDir("asc");
    } else if (next === "climbers") {
      setSortBy("rank_trend_change");
      setSortDir("desc");
    } else {
      setSortBy("rank_trend_change");
      setSortDir("asc");
    }
  };

  const handleSortChange = (col: string) => {
    setRankMode("normal");
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "rank_trend" || col === "label" ? "asc" : "desc");
    }
  };

  const handleLevelChange = (nextLevel: ClassificationLevel) => {
    setLevel(nextLevel);
    setParentId(null);
    setSelectedGroupId(null);
    setChartGroups([]);
  };

  const handleDrillDown = (group: IndustryGroupRow) => {
    const next = NEXT_LEVEL[group.level];
    if (!next) return;
    setParentId(group.groupId);
    setLevel(next);
    setSelectedGroupId(null);
    setChartGroups([]);
  };

  const handleBreadcrumbSelect = (crumb: BreadcrumbItem | null) => {
    if (!crumb) {
      setParentId(null);
      setChartGroups([]);
      return;
    }
    const next = NEXT_LEVEL[crumb.level];
    if (next) {
      setParentId(crumb.groupId);
      setLevel(next);
      setChartGroups([]);
    }
  };

  const handleSelectGroup = (groupId: string, triggerEl?: HTMLElement | null) => {
    if (triggerEl) lastRowTriggerRef.current = triggerEl;
    setSelectedGroupId((cur) => {
      const next = cur === groupId ? null : groupId;
      if (next) {
        setTimeout(() => {
          detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 60);
      }
      return next;
    });
  };

  const handleCloseDrawer = useCallback(() => {
    setSelectedGroupId(null);
    setTimeout(() => {
      lastRowTriggerRef.current?.focus();
    }, 20);
  }, []);

  const handleToggleChartGroup = (g: IndustryGroupRow) => {
    setChartGroups((prev) => {
      if (prev.some((item) => item.groupId === g.groupId)) {
        const next = prev.filter((item) => item.groupId !== g.groupId);
        setCompareToast(`Removed ${g.label} from rotation chart · ${next.length} selected`);
        return next;
      }
      const next = [...prev.slice(-4), { groupId: g.groupId, label: g.label }];
      setCompareToast(`Added ${g.label} to rotation chart · ${next.length} selected`);
      setTimeout(() => {
        chartRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 60);
      return next;
    });
  };

  const selectedGroupMeta = useMemo(() => {
    if (!selectedGroupId || !data?.groups) return null;
    return data.groups.find((g) => g.groupId === selectedGroupId) || null;
  }, [selectedGroupId, data]);

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <div className="h-10 rounded-lg bg-bg-secondary border border-border" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-bg-secondary border border-border" />
            ))}
          </div>
          <div className="h-80 rounded-lg bg-bg-secondary border border-border" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <SectionHeader
        title="Industries Rotation & Trend Rank"
        info="Trend Rank combines 1M/3M/6M trend, >50/>200 SMA breadth, and RS>=70 leader share"
        subtitle={
          data?.snapshotDate
            ? `As of ${data.snapshotDate} · ${data.coverage.classifiedStocks.toLocaleString("en-IN")} classified, ${
                data.coverage.coveragePct ?? "—"
              }% NSE-verified`
            : "No completed snapshot available"
        }
        action={
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={UNIVERSE_OPTIONS as never[]}
              value={universe}
              onChange={(val: StrengthUniverse) => setUniverse(val)}
              size="sm"
            />
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              aria-label="How ranks work"
              title="How ranks work"
              className={`inline-flex items-center gap-1 h-7 px-2 rounded-[6px] border text-[11px] font-medium cursor-pointer ${
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
              className="p-1.5 rounded-[6px] border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {showGuide && (
        <BaseCard padding="p-3.5" bg="bg-bg-secondary">
          <div className="text-[12px] text-text-secondary space-y-1.5">
            <div className="font-semibold text-text">How Ranks Work</div>
            <p>
              Groups with &ge; 5 eligible stocks at the same level are ranked equally on three components:
              <strong className="text-text"> Trend</strong> (mean percentile of 1M, 3M, and 6M median returns),
              <strong className="text-text"> Breadth</strong> (mean percentile of % above 50 SMA and 200 SMA), and
              <strong className="text-text"> Leaders</strong> (percentile of eligible stocks with RS Rating &ge; 70).
              Rank order stays fixed across timeframe buttons (timeframe only updates the <strong className="text-text">MED</strong> column).
            </p>
            <p>
              Rank change compares today&apos;s rank against 5 sessions ago (+ = climbed). In normal view, only moves &gt; 5 places are shown; click the <strong className="text-text">Rank</strong> header to cycle through Biggest Climbers and Biggest Fallers to inspect every move.
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
          <SummaryCards
            summary={data.summary}
            onSelectGroup={(gid) => handleSelectGroup(gid)}
          />

          <ClassificationTabs
            level={level}
            onLevelChange={handleLevelChange}
            period={period}
            onPeriodChange={setPeriod}
            has1yYtd={has1yYtd}
            showSmall={showSmall}
            onShowSmallChange={setShowSmall}
            moreColumns={moreColumns}
            onMoreColumnsChange={handleMoreColumnsChange}
            breadcrumbs={data.breadcrumbs}
            onBreadcrumbSelect={handleBreadcrumbSelect}
            search={search}
            onSearchChange={setSearch}
          />

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

          <div ref={chartRef}>
            <RotationChart
              selectedGroups={chartGroups}
              universe={universe}
              onRemoveGroup={(gid) =>
                setChartGroups((prev) => prev.filter((item) => item.groupId !== gid))
              }
            />
          </div>
        </>
      )}

      {compareToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-40 px-3.5 py-2 rounded-md bg-surface border border-accent-border text-xs font-medium text-text flex items-center gap-2"
        >
          <span>{compareToast}</span>
          <button
            type="button"
            onClick={() => setCompareToast(null)}
            className="text-text-muted hover:text-text cursor-pointer"
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
