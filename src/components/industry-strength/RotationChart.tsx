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

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
const PERIOD_OPTIONS: StrengthPeriod[] = ["1m", "3m", "6m", "1y"];

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

  if (selectedGroups.length === 0) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-border bg-surface-elevated text-center text-xs text-text-muted">
        Click the chart icon on any group row to plot its historical relative strength vs NIFTY 500.
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-border bg-surface-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">
            Group RS vs NIFTY 500
          </span>
          {selectedGroups.map((g, idx) => (
            <span
              key={g.groupId}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-border bg-surface"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
              />
              <span>{g.label}</span>
              <button
                type="button"
                onClick={() => onRemoveGroup(g.groupId)}
                aria-label={`Remove ${g.label} from chart`}
                className="hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setMetricKey("rsSts")}
              className={`px-2 py-1 rounded ${
                metricKey === "rsSts" ? "bg-primary text-white" : "text-text-secondary"
              }`}
            >
              RS_STS%
            </button>
            <button
              type="button"
              onClick={() => setMetricKey("rsLine")}
              className={`px-2 py-1 rounded ${
                metricKey === "rsLine" ? "bg-primary text-white" : "text-text-secondary"
              }`}
            >
              RS Line
            </button>
          </div>

          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[11px]">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-2 py-1 rounded uppercase ${
                  period === p ? "bg-primary text-white" : "text-text-secondary"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="h-56 flex items-center justify-center gap-2 text-xs text-text-muted">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading historical RS series...</span>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={metricKey === "rsSts" ? [0, 100] : ["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface-elevated, #0f172a)",
                  borderColor: "var(--border, #334155)",
                  fontSize: "11px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <ReferenceLine
                y={metricKey === "rsSts" ? 50 : 1.0}
                stroke="rgba(148,163,184,0.5)"
                strokeDasharray="4 4"
              />
              {selectedGroups.map((g, idx) => (
                <Line
                  key={g.groupId}
                  type="monotone"
                  dataKey={g.groupId}
                  name={g.label}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
