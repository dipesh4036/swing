"use client";

import React from "react";
import BaseCard from "@/components/ui/card";
import DivergingBarChart from "@/components/charts/DivergingBarChart";
import { formatCrores, formatDayMonth } from "@/lib/formatters";

export function InstitutionalActivity({
  flows = null,
  highsLows = null,
  asOfDate = null,
}) {
  const dateLabel = flows?.date || (asOfDate ? formatDayMonth(asOfDate) : "—");
  const fii = flows?.fii || null;
  const dii = flows?.dii || null;

  return (
    <BaseCard className="flex flex-col space-y-4 w-full min-w-0" padding="p-4">
      {/* ── FII / DII CASH SECTION ─────────────────────────────────── */}
      <div className="space-y-3.5 w-full min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[#E5EAF2]">
          <span className="text-xs font-bold text-[#17233B] uppercase tracking-wider">
            FII / DII CASH · LAST 22 SESSIONS
          </span>
          <span className="text-[10px] text-[#94A3B8] font-mono">₹ crore</span>
        </div>

        {/* FII Section */}
        <div className="space-y-1.5 w-full min-w-0">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-[#17233B]">FII</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#64748B] font-normal">{dateLabel}</span>
              <span
                className={`tabular-nums font-bold ${
                  fii?.dailyNetCr !== null && fii?.dailyNetCr !== undefined
                    ? fii.dailyNetCr >= 0
                      ? "text-[#3478F6]"
                      : "text-[#F05283]"
                    : "text-[#64748B]"
                }`}
              >
                {formatCrores(fii?.dailyNetCr)}
              </span>
            </div>
          </div>

          {/* 22 Sessions Bar Chart */}
          <div className="py-0.5 w-full min-w-0">
            <DivergingBarChart
              data={fii?.sessions || []}
              xKey="session"
              dataKey="val"
              height={52}
              posColor="#3478F6"
              negColor="#F05283"
              tooltipFormatter={(val) => formatCrores(val)}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#64748B]">
            <span>1-month net</span>
            <span
              className={`font-semibold tabular-nums ${
                fii?.monthNetCr !== null && fii?.monthNetCr !== undefined
                  ? fii.monthNetCr >= 0
                    ? "text-[#3478F6]"
                    : "text-[#F05283]"
                  : "text-[#64748B]"
              }`}
            >
              {formatCrores(fii?.monthNetCr)}
            </span>
          </div>
        </div>

        {/* DII Section */}
        <div className="space-y-1.5 pt-3 border-t border-[#F1F5F9] w-full min-w-0">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-[#17233B]">DII</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#64748B] font-normal">{dateLabel}</span>
              <span
                className={`tabular-nums font-bold ${
                  dii?.dailyNetCr !== null && dii?.dailyNetCr !== undefined
                    ? dii.dailyNetCr >= 0
                      ? "text-[#3478F6]"
                      : "text-[#F05283]"
                    : "text-[#64748B]"
                }`}
              >
                {formatCrores(dii?.dailyNetCr)}
              </span>
            </div>
          </div>

          {/* 22 Sessions Bar Chart */}
          <div className="py-0.5 w-full min-w-0">
            <DivergingBarChart
              data={dii?.sessions || []}
              xKey="session"
              dataKey="val"
              height={52}
              posColor="#3478F6"
              negColor="#F05283"
              tooltipFormatter={(val) => formatCrores(val)}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#64748B]">
            <span>1-month net</span>
            <span
              className={`font-semibold tabular-nums ${
                dii?.monthNetCr !== null && dii?.monthNetCr !== undefined
                  ? dii.monthNetCr >= 0
                    ? "text-[#3478F6]"
                    : "text-[#F05283]"
                  : "text-[#64748B]"
              }`}
            >
              {formatCrores(dii?.monthNetCr)}
            </span>
          </div>
        </div>
      </div>

      {/* ── 20-DAY HIGHS & LOWS SECTION ────────────────────────────── */}
      <div className="space-y-2 pt-3 border-t border-[#E5EAF2] w-full min-w-0">
        <div className="flex items-center justify-between pb-1">
          <span className="text-[11px] font-bold text-[#17233B] uppercase tracking-wider">
            20-DAY HIGHS · LOWS · LAST 22 SESSIONS
          </span>
          <span className="text-[10px] text-[#94A3B8]">Stocks</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-[17px] font-bold tabular-nums ${
                highsLows?.latestNet !== null && highsLows?.latestNet !== undefined
                  ? highsLows.latestNet >= 0
                    ? "text-[#3478F6]"
                    : "text-[#F05283]"
                  : "text-[#64748B]"
              }`}
            >
              {highsLows?.latestNet !== null && highsLows?.latestNet !== undefined
                ? `${highsLows.latestNet > 0 ? "+" : ""}${highsLows.latestNet}`
                : "—"}
            </span>
            <span className="text-[11px] text-[#64748B]">
              {highsLows?.latestNet !== null && highsLows?.latestNet !== undefined
                ? highsLows.latestNet >= 0
                  ? "Net positive"
                  : "Net negative"
                : "—"}
            </span>
          </div>
          <span className="text-[11px] text-[#64748B]">
            {highsLows?.highsCount ?? "—"} highs / {highsLows?.lowsCount ?? "—"} lows
          </span>
        </div>

        {/* 22-session net high/low bar chart */}
        <div className="py-0.5 w-full min-w-0">
          <DivergingBarChart
            data={highsLows?.sessions || []}
            xKey="session"
            dataKey="net"
            height={46}
            posColor="#3478F6"
            negColor="#F05283"
            tooltipFormatter={(val) => `${val > 0 ? "+" : ""}${val} net`}
          />
        </div>
      </div>
    </BaseCard>
  );
}

export default InstitutionalActivity;
