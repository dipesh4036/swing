"use client";

import { useState, useEffect, useMemo } from "react";
import { formatShortDate, formatDayMonth, formatTradeDate } from "@/lib/formatters";

export function useMarketBreadth(universe = "nifty500", period = "1Y") {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);

    async function fetchData() {
      try {
        const res = await fetch(`/api/terminal/data?universe=${universe}&period=${period}`);
        if (!res.ok) {
          throw new Error(`Failed to load data: ${res.status} ${res.statusText}`);
        }
        const json = await res.json();
        if (active) {
          setData(json);
        }
      } catch (err) {
        if (active) {
          console.error("Error in useMarketBreadth:", err);
          setError(err.message);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    fetchData();
    return () => {
      active = false;
    };
  }, [universe, period]);

  const asOfDate = data?.asOfDate || null;
  const history = useMemo(() => data?.history || [], [data]);
  const keyMetrics = useMemo(() => data?.keyMetrics || null, [data]);
  const rawIndices = useMemo(() => data?.indices || {}, [data]);
  const rawMacro = useMemo(() => data?.macro || {}, [data]);
  const rawFlows = useMemo(() => data?.institutionalFlows || null, [data]);
  const performance = useMemo(() => data?.performance || {}, [data]);
  const marketRegime = useMemo(() => data?.marketRegime || null, [data]);
  const coverage = useMemo(() => data?.coverage || null, [data]);
  const rebasedSeries = useMemo(() => data?.rebasedSeries || {}, [data]);

  // 1. Format Market Read Six Indicators & Weinstein Stage Analysis (Spec 4.6 & 4.8)
  const marketRead = useMemo(() => {
    if (!keyMetrics || history.length === 0) {
      return null;
    }

    const { weinstein } = keyMetrics;

    // Spec 4.8: Display names and descriptions for the six indicators
    const INDICATOR_METADATA = {
      long_term: {
        name: "Long-term Trend",
        metric: "Nifty 500 vs 200 SMA",
        positiveDesc: "Nifty 500 is trading above its 200 SMA; primary trend is intact.",
        negativeDesc: "Nifty 500 is trading below its 200 SMA; defensive posture warranted.",
        neutralDesc: "Long-term trend hovering near 200 SMA.",
      },
      medium_term: {
        name: "Medium-term Trend",
        metric: "Nifty 500 vs 50 SMA",
        positiveDesc: "Nifty 500 is above its 50-day average; intermediate trend is upward.",
        negativeDesc: "Nifty 500 is below its 50-day average; intermediate selling pressure.",
        neutralDesc: "Medium-term trend balanced near 50 SMA.",
      },
      short_term: {
        name: "Short-term Momentum",
        metric: "Nifty 500 vs 20 EMA",
        positiveDesc: "Short-term momentum is positive above the 20 EMA.",
        negativeDesc: "Short-term momentum is weak below the 20 EMA.",
        neutralDesc: "Short-term price action compressing around 20 EMA.",
      },
      ad_momentum: {
        name: "A/D Momentum",
        metric: "20-Day A/D Ratio",
        positiveDesc: "Advancers leading decliners (20D ratio ≥ 1.05); demand expanding.",
        negativeDesc: "Decliners leading advancers (20D ratio ≤ 0.95); supply dominant.",
        neutralDesc: "Advance/decline breadth neutral (ratio between 0.95 and 1.05).",
      },
      highs_vs_lows: {
        name: "52-Week Highs / Lows",
        metric: "Net 52-Week Expansion",
        positiveDesc: "New 52-week highs exceeding 52-week lows; strong expansion.",
        negativeDesc: "New 52-week lows outnumbering highs; structural contraction.",
        neutralDesc: "New highs and lows balanced across the universe.",
      },
      participation: {
        name: "Market Participation",
        metric: "% Stocks Above 50 SMA",
        positiveDesc: "Healthy breadth: ≥50% of stocks above their 50 SMA.",
        negativeDesc: "Weak breadth: <40% of stocks above their 50 SMA.",
        neutralDesc: "Moderate breadth: 40%–50% of stocks above their 50 SMA.",
      },
    };

    const rawIndicators = marketRegime?.readIndicators || [];
    const indicators = rawIndicators.map((ind) => {
      const meta = INDICATOR_METADATA[ind.id] || {
        name: ind.id,
        metric: "",
        positiveDesc: "",
        negativeDesc: "",
        neutralDesc: "",
      };
      const status = ind.status || "Neutral";
      const tone =
        status === "Positive"
          ? "positive"
          : status === "Negative"
          ? "negative"
          : "neutral";
      const description =
        status === "Positive"
          ? meta.positiveDesc
          : status === "Negative"
          ? meta.negativeDesc
          : meta.neutralDesc;

      return {
        id: ind.id,
        name: meta.name,
        metric: meta.metric,
        status,
        tone,
        value: ind.value,
        description,
      };
    });

    const divergenceNote =
      "Negative daily momentum and positive short-term participation can coexist naturally: one measures single-session buying/selling flow, while the other measures multi-day structural holding power above moving averages.";

    // Weinstein Stage Analysis per Spec 4.6
    const totalStocks = coverage?.valid || null;
    const s1 = weinstein?.stage1 ?? null;
    const s2 = weinstein?.stage2 ?? null;
    const s3 = weinstein?.stage3 ?? null;
    const s4 = weinstein?.stage4 ?? null;
    const change1D = weinstein?.change1D || null;

    const stageAnalysis = {
      totalStocks,
      coverage: coverage || null,
      timeframe: "150-day SMA + 20-session slope",
      stages: [
        {
          id: "base",
          name: "Stage 1: Base",
          stageNum: 1,
          pct: s1,
          change1D: change1D?.stage1 ?? null,
          count: weinstein?.counts?.stage1 ?? null,
          color: "#94A3B8",
        },
        {
          id: "uptrend",
          name: "Stage 2: Uptrend",
          stageNum: 2,
          pct: s2,
          change1D: change1D?.stage2 ?? null,
          count: weinstein?.counts?.stage2 ?? null,
          color: "#2563EB",
        },
        {
          id: "top",
          name: "Stage 3: Top",
          stageNum: 3,
          pct: s3,
          change1D: change1D?.stage3 ?? null,
          count: weinstein?.counts?.stage3 ?? null,
          color: "#F59E0B",
        },
        {
          id: "downtrend",
          name: "Stage 4: Downtrend",
          stageNum: 4,
          pct: s4,
          change1D: change1D?.stage4 ?? null,
          count: weinstein?.counts?.stage4 ?? null,
          color: "#F43F5E",
        },
      ],
      unclassifiedCount: weinstein?.counts?.unclassified ?? null,
    };

    return {
      indicators,
      divergenceNote,
      stageAnalysis,
    };
  }, [keyMetrics, history, marketRegime, coverage]);

  // 2. Format Market Participation chart series with real rebased benchmark per Spec 4.11
  const participationData = useMemo(() => {
    const benchmarkList = rebasedSeries?.benchmark || [];
    const benchmarkMap = {};
    for (const b of benchmarkList) {
      benchmarkMap[b.date] = b.rebased;
    }

    return history.map((h) => ({
      date: formatShortDate(h.date),
      rawDate: h.date,
      participation: h.pctAbove20ema,
      above20: h.pctAbove20ema,
      above50: h.pctAbove50sma,
      above200: h.pctAbove200sma,
      benchmark: benchmarkMap[h.date] ?? null,
    }));
  }, [history, rebasedSeries]);

  const participationStats = useMemo(() => {
    const cur = keyMetrics?.movingAverages?.pctAbove20ema;
    if (cur === null || cur === undefined) {
      return { currentPct: null, status: "—", weeklyChangePts: null };
    }
    const prev5 = history.length >= 6 ? history[history.length - 6]?.pctAbove20ema : null;
    const diff = prev5 !== null && prev5 !== undefined ? cur - prev5 : null;
    const status = cur >= 70 ? "Broad" : cur >= 50 ? "Moderate" : "Narrow";
    return {
      currentPct: cur,
      status,
      weeklyChangePts: diff,
    };
  }, [keyMetrics, history]);

  // 3. Real Stage 2 vs Stage 4 comparison series (Spec 4.6: no fabricated values)
  const stageComparisonData = useMemo(() => {
    return history.map((h) => ({
      date: formatShortDate(h.date),
      stage2: h.stage2Pct,
      stage4: h.stage4Pct,
    }));
  }, [history]);

  // 4. Real Institutional Flows (Spec 4.7: real 22 sessions only, no fabricated values)
  const institutionalFlows = useMemo(() => {
    if (!rawFlows || !rawFlows.sessions || rawFlows.sessions.length === 0) return null;
    const realSessions = rawFlows.sessions;
    const lastSession = realSessions[realSessions.length - 1];
    const lastDate = lastSession?.date ? formatDayMonth(lastSession.date) : "—";

    const fiiSessions = realSessions.map((s, i) => ({
      session: i + 1,
      date: formatShortDate(s.date),
      val: s.fiiNet,
    }));

    const diiSessions = realSessions.map((s, i) => ({
      session: i + 1,
      date: formatShortDate(s.date),
      val: s.diiNet,
    }));

    const fiiMonthNet = fiiSessions.reduce(
      (sum, s) => (s.val !== null ? sum + s.val : sum),
      0
    );
    const diiMonthNet = diiSessions.reduce(
      (sum, s) => (s.val !== null ? sum + s.val : sum),
      0
    );

    return {
      date: lastDate,
      sessionsAvailable: rawFlows.fiiDiiSessionsAvailable || realSessions.length,
      fii: {
        dailyNetCr: lastSession ? lastSession.fiiNet : null,
        monthNetCr: Math.round(fiiMonthNet * 100) / 100,
        sessions: fiiSessions,
      },
      dii: {
        dailyNetCr: lastSession ? lastSession.diiNet : null,
        monthNetCr: Math.round(diiMonthNet * 100) / 100,
        sessions: diiSessions,
      },
    };
  }, [rawFlows]);

  // 5. Format Highs and Lows for Institutional Activity card
  const highsLows = useMemo(() => {
    const hl = keyMetrics?.highsLows;
    if (!hl) return null;

    const sessions = history.slice(-22).map((h, i) => ({
      session: i + 1,
      date: formatShortDate(h.date),
      highs: h.highs20d,
      lows: h.lows20d,
      net: h.netHighs20d,
    }));

    return {
      highsCount: hl.highs20d,
      lowsCount: hl.lows20d,
      latestNet: hl.net20d,
      sessions,
    };
  }, [keyMetrics, history]);

  // 6. Format Indices list for IndicesSection
  const formattedIndices = useMemo(() => {
    return [
      {
        id: "nifty50",
        name: "NIFTY 50",
        value: rawIndices.nifty50?.close ?? null,
        changePct: rawIndices.nifty50?.pctChange ?? null,
        distFromHighPct: rawIndices.nifty50?.distFromHighPct ?? null,
        sparkline: rawIndices.nifty50?.sparkline ?? [],
        subtext: "Large caps benchmark",
      },
      {
        id: "nifty500",
        name: "NIFTY 500",
        value: rawIndices.nifty500?.close ?? null,
        changePct: rawIndices.nifty500?.pctChange ?? null,
        distFromHighPct: rawIndices.nifty500?.distFromHighPct ?? null,
        sparkline: rawIndices.nifty500?.sparkline ?? [],
        subtext: "Broad market index",
      },
      {
        id: "midcap150",
        name: "MIDCAP 150",
        value: rawIndices.midcap150?.close ?? null,
        changePct: rawIndices.midcap150?.pctChange ?? null,
        distFromHighPct: rawIndices.midcap150?.distFromHighPct ?? null,
        sparkline: rawIndices.midcap150?.sparkline ?? [],
        subtext: "Mid-tier growth",
      },
      {
        id: "smallcap250",
        name: "SMALLCAP 250",
        value: rawIndices.smallcap250?.close ?? null,
        changePct: rawIndices.smallcap250?.pctChange ?? null,
        distFromHighPct: rawIndices.smallcap250?.distFromHighPct ?? null,
        sparkline: rawIndices.smallcap250?.sparkline ?? [],
        subtext: "Small cap momentum",
      },
      {
        id: "vix",
        name: "INDIA VIX",
        value: rawIndices.vix?.close ?? null,
        changePct: rawIndices.vix?.pctChange ?? null,
        distFromHighPct: null,
        sparkline: rawIndices.vix?.sparkline ?? [],
        subtext: "Volatility gauge",
      },
      {
        id: "usdinr",
        name: "USD / INR",
        value: rawMacro.usdinr?.close ?? null,
        changePct: rawMacro.usdinr?.pctChange ?? null,
        distFromHighPct: rawMacro.usdinr?.distFromHighPct ?? null,
        sparkline: rawMacro.usdinr?.sparkline ?? [],
        subtext: "Rupee exchange rate",
      },
      {
        id: "brent",
        name: "BRENT CRUDE",
        value: rawMacro.brent?.close ?? null,
        changePct: rawMacro.brent?.pctChange ?? null,
        distFromHighPct: rawMacro.brent?.distFromHighPct ?? null,
        sparkline: rawMacro.brent?.sparkline ?? [],
        isDollar: true,
        subtext: "Crude oil benchmark",
      },
    ];
  }, [rawIndices, rawMacro]);

  return {
    data,
    isLoading,
    error,
    asOfDate,
    lastUpdatedAt: data?.lastUpdatedAt || data?.meta?.lastUpdatedAt || null,
    coverage,
    marketRegime,
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
  };
}
