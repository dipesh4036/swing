"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, X } from "lucide-react";
import {
  GroupHistoryResponse,
  StrengthPeriod,
  StrengthUniverse,
} from "@/lib/industry-types";
import { ChartCard } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CHART_THEME } from "@/lib/chart-theme";

const SERIES_COLORS = [
  CHART_THEME.colors.primary,
  CHART_THEME.colors.bullish,
  "#F59E0B",
  CHART_THEME.colors.bearish,
  "#8B5CF6",
];

const METRIC_OPTIONS = [
  { id: "rsSts", label: "RS_STS%" },
  { id: "rsLine", label: "RS Line" },
];

const PERIOD_OPTIONS: { id: StrengthPeriod; label: string }[] = [
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
];

interface RotationChartProps {
  selectedGroups: { groupId: string; label: string }[];
  universe: StrengthUniverse;
  onRemoveGroup: (groupId: string) => void;
}

export default function RotationChart({
  selectedGroups,
  universe,
  onRemoveGroup,
}: RotationChartProps) {
  const [period, setPeriod] = useState<StrengthPeriod>("3m");
  const [metricKey, setMetricKey] = useState<"rsSts" | "rsLine">("rsSts");
  const [histories, setHistories] = useState<Record<string, GroupHistoryResponse>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedGroups.length === 0) return;
    let active = true;
    const ctrl = new AbortController();
    setLoading(true);

    Promise.all(
      selectedGroups.map(async (g) => {
        const res = await fetch(
          `/api/industry-strength/${encodeURIComponent(g.groupId)}/history?period=${period}&universe=${universe}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return null;
        return (await res.json()) as GroupHistoryResponse;
      })
    )
      .then((results) => {
        if (!active) return;
        const next: Record<string, GroupHistoryResponse> = {};
        for (const r of results) {
          if (r) next[r.groupId] = r;
        }
        setHistories(next);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [selectedGroups, period, universe]);

  const chartData = useMemo(() => {
    const byDate: Record<string, Record<string, string | number | null>> = {};
    for (const g of selectedGroups) {
      const h = histories[g.groupId];
      if (!h) continue;
      for (const pt of h.points) {
        if (!byDate[pt.date]) byDate[pt.date] = { date: pt.date };
        byDate[pt.date][g.groupId] = metricKey === "rsSts" ? pt.rsSts : pt.rsLine;
      }
    }
    return Object.values(byDate).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [selectedGroups, histories, metricKey]);

  return (
    <ChartCard
      title="Group Relative Strength vs NIFTY 500"
      info="26-session equal-weight group index relative to NIFTY 500"
      subtitle={
        selectedGroups.length > 0
          ? `${selectedGroups.length} selected (click chart icon in table to add/remove)`
          : "Select up to 5 groups from the table"
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={METRIC_OPTIONS as never[]}
            value={metricKey}
            onChange={(val: "rsSts" | "rsLine") => setMetricKey(val)}
            size="xs"
          />
          <SegmentedControl
            options={PERIOD_OPTIONS as never[]}
            value={period}
            onChange={(val: StrengthPeriod) => setPeriod(val)}
            size="xs"
          />
        </div>
      }
      legend={
        selectedGroups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selectedGroups.map((g, idx) => (
              <span
                key={g.groupId}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-xs font-medium border border-border bg-bg-secondary text-text"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                />
                <span>{g.label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveGroup(g.groupId)}
                  aria-label={`Remove ${g.label} from chart`}
                  className="text-text-secondary hover:text-bearish cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        ) : undefined
      }
    >
      {selectedGroups.length === 0 ? (
        <div className="h-44 flex items-center justify-center text-xs text-text-secondary border border-dashed border-border rounded-md">
          Click the chart icon on any group row to plot its historical relative strength vs NIFTY 500.
        </div>
      ) : loading && chartData.length === 0 ? (
        <div className="h-60 flex items-center justify-center gap-2 text-xs text-text-secondary">
          <RefreshCw className="w-4 h-4 animate-spin text-primary" />
          <span>Loading historical RS series...</span>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid
                stroke={CHART_THEME.grid.stroke}
                strokeDasharray={CHART_THEME.grid.strokeDasharray}
                vertical={CHART_THEME.grid.vertical}
              />
              <XAxis
                dataKey="date"
                tick={CHART_THEME.axis.tick}
                axisLine={CHART_THEME.axis.line}
                tickLine={CHART_THEME.axis.tickLine}
                minTickGap={24}
              />
              <YAxis
                tick={CHART_THEME.axis.tick}
                axisLine={CHART_THEME.axis.line}
                tickLine={CHART_THEME.axis.tickLine}
                domain={metricKey === "rsSts" ? [0, 100] : ["auto", "auto"]}
              />
              <Tooltip
                wrapperStyle={CHART_THEME.tooltip.wrapperStyle}
                contentStyle={CHART_THEME.tooltip.contentStyle}
              />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <ReferenceLine
                y={metricKey === "rsSts" ? 50 : 1.0}
                stroke={CHART_THEME.referenceLine.stroke}
                strokeDasharray={CHART_THEME.referenceLine.strokeDasharray}
              />
              {selectedGroups.map((g, idx) => (
                <Line
                  key={g.groupId}
                  type="monotone"
                  dataKey={g.groupId}
                  name={g.label}
                  stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                  dot={CHART_THEME.line.dot}
                  strokeWidth={CHART_THEME.line.strokeWidth}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
