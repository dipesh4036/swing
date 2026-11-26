"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, RefreshCw } from "lucide-react";
import {
  BreadcrumbItem,
  ClassificationLevel,
  ConstituentStockRow,
  IndustryGroupRow,
  RankingsResponse,
  StrengthUniverse,
} from "@/lib/industry-types";
import PageContainer, { SectionHeader } from "@/components/shared/PageContainer";
import { BaseCard } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import ClassificationTabs, { QuickPreset } from "./ClassificationTabs";
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
  const [universe, setUniverse] = useState<StrengthUniverse>("all");
  const [preset, setPreset] = useState<QuickPreset>("all");
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rank");
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

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        level,
        universe,
        sortBy,
        sortDir,
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
  }, [level, universe, parentId, search, sortBy, sortDir]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  // Seed chart with top 3 groups once on initial load so the chart is immediately informative
  useEffect(() => {
    if (data?.groups && data.groups.length > 0 && chartGroups.length === 0) {
      setChartGroups(
        data.groups.slice(0, 3).map((g) => ({ groupId: g.groupId, label: g.label }))
      );
    }
  }, [data, chartGroups.length]);

  const filteredGroups = useMemo(() => {
    if (!data?.groups) return [];
    if (preset === "all") return data.groups;
    if (preset === "outperforming") {
      return data.groups.filter((g) => g.rsAboveEma21 === true);
    }
    if (preset === "improving") {
      return data.groups.filter((g) => g.rsTrend === "improving");
    }
    if (preset === "leaders") {
      return data.groups.filter((g) => g.rsSts !== null && g.rsSts >= 75);
    }
    return data.groups;
  }, [data, preset]);

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

  const handleSortChange = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "rank" || col === "label" ? "asc" : "desc");
    }
  };

  const handleSelectGroup = (groupId: string) => {
    setSelectedGroupId((cur) => {
      const next = cur === groupId ? null : groupId;
      if (next) {
        setTimeout(() => {
          detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 80);
      }
      return next;
    });
  };

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

  if (loading && !data) {
    return (
      <PageContainer>
        <div className="space-y-4 animate-pulse">
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
        title="Industries Relative Strength (RS_STS)"
        info="4-level NSE taxonomy ranked by 26-session equal-weight RS_STS% vs NIFTY 500"
        subtitle={
          data?.snapshotDate
            ? `Snapshot: ${data.snapshotDate} · Coverage: ${data.coverage.classifiedStocks}/${
                data.coverage.totalStocks
              } (${data.coverage.coveragePct ?? "—"}%)`
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
              aria-label="Toggle RS_STS methodology guide"
              className={`p-1.5 rounded-[6px] border cursor-pointer transition-colors ${
                showGuide
                  ? "bg-primary-subtle border-accent-border text-primary"
                  : "border-border bg-surface text-text-secondary hover:text-text"
              }`}
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={fetchRankings}
              disabled={loading}
              aria-label="Refresh rankings"
              className="p-1.5 rounded-[6px] border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-50 cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {showGuide && (
        <BaseCard padding="p-3.5" bg="bg-bg-secondary">
          <div className="text-[12px] text-text-secondary space-y-1">
            <div className="font-semibold text-text">How RS_STS% Works</div>
            <p>
              Each group builds a 26-session equal-weight index of full-window constituents (excluding
              corporate-action jumps &gt;40% and fresh IPOs &lt;26 sessions) divided by NIFTY 500.{" "}
              <strong className="text-text">RS_STS%</strong> is the percentile rank (0–100%) of the
              latest RS value within that 26-session window. Click any row to inspect constituents or
              use the chevron to drill down through Macro &rarr; Sector &rarr; Industry &rarr; Basic Industry.
            </p>
          </div>
        </BaseCard>
      )}

      {error && (
        <BaseCard padding="p-3" bg="bg-warning-bg" className="text-warning text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}{data ? " (showing last completed snapshot)" : ""}</span>
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
            preset={preset}
            onPresetChange={setPreset}
            breadcrumbs={data.breadcrumbs}
            onBreadcrumbSelect={handleBreadcrumbSelect}
            search={search}
            onSearchChange={setSearch}
          />

          <RankingTable
            groups={filteredGroups}
            level={level}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(g) => handleSelectGroup(g.groupId)}
            onDrillDown={handleDrillDown}
            chartGroupIds={chartGroups.map((g) => g.groupId)}
            onToggleChartGroup={handleToggleChartGroup}
          />

          {selectedGroupId && (
            <div ref={detailsRef}>
              <GroupDetails
                groupId={selectedGroupId}
                universe={universe}
                onClose={() => setSelectedGroupId(null)}
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
