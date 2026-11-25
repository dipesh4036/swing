"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  BreadcrumbItem,
  ClassificationLevel,
  ConstituentStockRow,
  IndustryGroupRow,
  RankingsResponse,
  StrengthUniverse,
} from "@/lib/industry-types";
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

export default function SectorDashboard() {
  const [level, setLevel] = useState<ClassificationLevel>("industry");
  const [universe, setUniverse] = useState<StrengthUniverse>("all");
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [data, setData] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [chartGroups, setChartGroups] = useState<{ groupId: string; label: string }[]>([]);
  const [selectedStock, setSelectedStock] = useState<ConstituentStockRow | null>(null);

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

  const handleLevelChange = (nextLevel: ClassificationLevel) => {
    setLevel(nextLevel);
    setParentId(null);
    setSelectedGroupId(null);
  };

  const handleDrillDown = (group: IndustryGroupRow) => {
    const next = NEXT_LEVEL[group.level];
    if (!next) return;
    setParentId(group.groupId);
    setLevel(next);
    setSelectedGroupId(null);
  };

  const handleBreadcrumbSelect = (crumb: BreadcrumbItem | null) => {
    if (!crumb) {
      setParentId(null);
      return;
    }
    const next = NEXT_LEVEL[crumb.level];
    if (next) {
      setParentId(crumb.groupId);
      setLevel(next);
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

  const handleToggleChartGroup = (g: IndustryGroupRow) => {
    setChartGroups((prev) => {
      if (prev.some((item) => item.groupId === g.groupId)) {
        return prev.filter((item) => item.groupId !== g.groupId);
      }
      return [...prev.slice(-4), { groupId: g.groupId, label: g.label }];
    });
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <span className="text-sm text-text-muted">Loading NSE 4-level industry strength...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-text-primary">
            Industries Relative Strength (RS_STS)
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            {data?.snapshotDate
              ? `Snapshot: ${data.snapshotDate} · Method: ${data.methodologyVersion} · Coverage: ${
                  data.coverage.classifiedStocks
                }/${data.coverage.totalStocks} (${data.coverage.coveragePct ?? "—"}%)`
              : "No completed snapshot available yet"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-elevated p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setUniverse("all")}
              className={`px-3 py-1 rounded-md font-medium ${
                universe === "all" ? "bg-primary text-white" : "text-text-secondary"
              }`}
            >
              All NSE
            </button>
            <button
              type="button"
              onClick={() => setUniverse("liquid")}
              className={`px-3 py-1 rounded-md font-medium ${
                universe === "liquid" ? "bg-primary text-white" : "text-text-secondary"
              }`}
            >
              Liquid Only
            </button>
          </div>

          <button
            type="button"
            onClick={fetchRankings}
            disabled={loading}
            aria-label="Refresh rankings"
            className="p-2 rounded-lg border border-border bg-surface-elevated text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}{data ? " (showing last completed snapshot)" : ""}</span>
        </div>
      )}

      {data && (
        <>
          <SummaryCards
            summary={data.summary}
            onSelectGroup={(gid) => setSelectedGroupId(gid)}
          />

          <ClassificationTabs
            level={level}
            onLevelChange={handleLevelChange}
            breadcrumbs={data.breadcrumbs}
            onBreadcrumbSelect={handleBreadcrumbSelect}
            search={search}
            onSearchChange={setSearch}
          />

          <RankingTable
            groups={data.groups}
            level={level}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={handleSortChange}
            selectedGroupId={selectedGroupId}
            onSelectGroup={(g) =>
              setSelectedGroupId((cur) => (cur === g.groupId ? null : g.groupId))
            }
            onDrillDown={handleDrillDown}
            chartGroupIds={chartGroups.map((g) => g.groupId)}
            onToggleChartGroup={handleToggleChartGroup}
          />

          {selectedGroupId && (
            <GroupDetails
              groupId={selectedGroupId}
              universe={universe}
              onClose={() => setSelectedGroupId(null)}
              onSelectStock={(st) => setSelectedStock(st)}
            />
          )}

          <RotationChart
            selectedGroups={chartGroups}
            universe={universe}
            onRemoveGroup={(gid) =>
              setChartGroups((prev) => prev.filter((item) => item.groupId !== gid))
            }
          />
        </>
      )}

      {selectedStock && (
        <StockDetailPanel
          stock={{
            symbol: selectedStock.symbol,
            name: selectedStock.name,
            sector: selectedStock.sector,
            industry: selectedStock.industry,
            basic_industry: selectedStock.basicIndustry,
            close: selectedStock.close,
            ret_1d: selectedStock.ret1d,
            ret_1w: selectedStock.ret1w,
            ret_1m: selectedStock.ret1m,
            ret_3m: selectedStock.ret3m,
            ret_6m: selectedStock.ret6m,
            rs_rank: selectedStock.rsRating,
            above_20ema: selectedStock.above20ema,
            above_50dma: selectedStock.above50dma,
            above_200dma: selectedStock.above200dma,
            mcap_cr: selectedStock.mcapCr,
          }}
          onShowSector={(sec: string) => {
            setSelectedStock(null);
            setLevel("sector");
            setParentId(null);
            setSearch(sec || "");
          }}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}
