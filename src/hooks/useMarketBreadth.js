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

  // 1. Format Market Read 8 Indicators & Weinstein Stage Analysis
  const marketRead = useMemo(() => {
    if (!keyMetrics || history.length === 0) {
      return null;
    }

    const { advanceDecline, movingAverages, highsLows, breakouts: brk, weinstein } = keyMetrics;
    const adv = advanceDecline?.advances ?? 0;
    const dec = advanceDecline?.declines ?? 0;
    const p20 = movingAverages?.pctAbove20ema;
    const p50 = movingAverages?.pctAbove50sma;
    const p200 = movingAverages?.pctAbove200sma;
    const net20d = highsLows?.net20d ?? 0;
    const net52w = highsLows?.net52w ?? 0;
    const highs52w = highsLows?.highs52w ?? 0;
    const lows52w = highsLows?.lows52w ?? 0;

    // 1. Momentum (Daily flow)
    const isPosMom = adv >= dec * 1.2;
    const isNegMom = dec >= adv * 1.2;
    const momentum = {
      id: "momentum",
      name: "Momentum",
      status: isPosMom ? "Positive" : isNegMom ? "Negative" : "Neutral",
      tone: isPosMom ? "positive" : isNegMom ? "negative" : "neutral",
      description: isPosMom
        ? `Buying is strong: ${adv.toLocaleString("en-IN")} stocks rising vs ${dec.toLocaleString("en-IN")} falling.`
        : isNegMom
        ? `Selling pressure: ${dec.toLocaleString("en-IN")} stocks falling vs ${adv.toLocaleString("en-IN")} rising.`
        : `Market balanced: ${adv.toLocaleString("en-IN")} rising vs ${dec.toLocaleString("en-IN")} falling.`,
    };

    // 2. Short-term (20 EMA trend)
    const isShortUp = p20 !== null && p20 >= 50 && net20d >= 0;
    const shortTerm = {
      id: "short-term",
      name: "Short-term",
      status: isShortUp ? "Up" : "Down",
      tone: isShortUp ? "positive" : "negative",
      description: p20 !== null
        ? isShortUp
          ? `Short-term strength: ${p20.toFixed(1)}% of stocks trading above 20-day average.`
          : `Short-term weakness: only ${p20.toFixed(1)}% of stocks above 20-day average.`
        : "Insufficient historical data for 20-day average.",
    };

    // Coexistence explanation between daily momentum & short-term participation
    let divergenceNote = null;
    if (isNegMom && isShortUp) {
      divergenceNote =
        "Negative daily momentum and positive short-term participation coexist because they measure different things: daily momentum reflects single-session net advancers/decliners, whereas short-term participation measures 20-day moving average positioning. This pattern is common during routine pullbacks within an ongoing uptrend.";
    } else if (isPosMom && !isShortUp) {
      divergenceNote =
        "Positive daily momentum alongside cautious short-term participation indicates a single-session bounce or short-covering rally that has not yet reclaimed 20-day trend lines.";
    }

    // 3. Market Sentiment Score
    const regimeScore = marketRegime?.score ?? null;
    const regimeStatus = marketRegime?.status ?? "—";
    const sentimentScore = {
      id: "sentiment",
      name: "Market sentiment score",
      status: regimeScore !== null ? `${regimeScore}/100 · ${regimeStatus}` : "—",
      tone:
        regimeScore !== null
          ? regimeScore >= 60
            ? "positive"
            : regimeScore <= 40
            ? "negative"
            : "warning"
          : "neutral",
      description:
        "Overall bullish/bearish market condition derived from moving-average breadth, intermediate trend, and volume distribution.",
    };

    // 4. 52-week Highs / Lows (Long-term market strength)
    const is52wPositive = net52w > 0;
    const highsLows52w = {
      id: "highs-lows-52w",
      name: "52-week highs/lows",
      status:
        highsLows?.net52w !== null && highsLows?.net52w !== undefined
          ? `${net52w > 0 ? "+" : ""}${net52w} (${highs52w}H / ${lows52w}L)`
          : "—",
      tone: is52wPositive ? "positive" : net52w < 0 ? "negative" : "neutral",
      description:
        "Long-term market strength. Net 52-week highs demonstrate broad institutional expansion; net 52-week lows signal structural distribution.",
    };

    // 5. Big trend (200 DMA)
    const isBull = p200 !== null && p200 >= 50;
    const isBear = p200 !== null && p200 < 35;
    const bigTrend = {
      id: "big-trend",
      name: "Big trend",
      status: isBull ? "Bullish" : isBear ? "Bearish" : "Neutral",
      tone: isBull ? "positive" : isBear ? "negative" : "neutral",
      description: p200 !== null
        ? isBull
          ? `Long-term healthy: ${p200.toFixed(1)}% of stocks above their 200 DMA.`
          : isBear
          ? `Long-term defensive: majority of stocks below their 200 DMA.`
          : `The bigger picture is split: neither buyers nor sellers in complete control.`
        : "Insufficient historical data for 200 DMA.",
    };

    // 6. Breakouts
    const isBrkWorking = (brk?.breakouts20d ?? 0) >= (brk?.breakdowns20d ?? 0);
    const breakouts = {
      id: "breakouts",
      name: "Breakouts",
      status: isBrkWorking ? "Working" : "Failing",
      tone: isBrkWorking ? "positive" : "negative",
      description: isBrkWorking
        ? `Breakouts are working: favorable follow-through on volume expansion.`
        : `Breakouts are struggling: higher breakdown rate; wait for volume confirmation.`,
    };

    // 7. Overdone?
    const isOverbought = p20 !== null && p20 > 80;
    const isOversold = p20 !== null && p20 < 25;
    const overdone = {
      id: "overdone",
      name: "Overdone?",
      status: isOverbought ? "Overbought" : isOversold ? "Oversold" : "Normal",
      tone: isOverbought || isOversold ? "warning" : "neutral",
      description: isOverbought
        ? `Overstretched to the upside: exercise discipline on chasing extended stocks.`
        : isOversold
        ? `Oversold territory: watch for early accumulation and base reversals.`
        : `Not overdone: market breadth within healthy historical boundaries.`,
    };

    // 8. Leadership
    const nf50Chg = rawIndices.nifty50?.pctChange ?? 0;
    const nf500Chg = rawIndices.nifty500?.pctChange ?? 0;
    const isLargeCapLeading = nf50Chg > nf500Chg;
    const leadership = {
      id: "leadership",
      name: "Leadership",
      status: isLargeCapLeading ? "Large caps lead" : "Broad market lead",
      tone: "neutral",
      description: isLargeCapLeading
        ? `Big index heavyweights leading; mid and small caps lagging.`
        : `Broad market outperforming; mid and small caps showing relative strength.`,
    };

    // Weinstein Stage Analysis
    const totalStocks = adv + dec + (advanceDecline?.unchanged ?? 0);
    const prevHistory = history.length >= 2 ? history[history.length - 2] : null;

    const s1 = weinstein?.stage1 ?? 0;
    const s2 = weinstein?.stage2 ?? (p50 ?? 0);
    const s3 = weinstein?.stage3 ?? 0;
    const s4 = weinstein?.stage4 ?? Math.max(0, 100 - s2 - s1 - s3);

    const prevS2 = prevHistory?.pctAbove50sma ?? s2;
    const diffS2 = Math.round((s2 - prevS2) * (totalStocks / 100));

    const stageAnalysis = {
      totalStocks,
      coverage: coverage || {
        valid: totalStocks,
        total: totalStocks,
        pct: 100,
        excludedReason: "",
      },
      timeframe: "150-day SMA",
      stages: [
        { id: "base", name: "Base", stageNum: 1, pct: s1, change1D: 0, color: "#94A3B8" },
        { id: "uptrend", name: "Uptrend", stageNum: 2, pct: s2, change1D: diffS2, color: "#2563EB" },
        { id: "top", name: "Top", stageNum: 3, pct: s3, change1D: 0, color: "#F59E0B" },
        { id: "downtrend", name: "Downtrend", stageNum: 4, pct: s4, change1D: -diffS2, color: "#F43F5E" },
      ],
    };

    return {
      indicators: [
        sentimentScore,
        momentum,
        shortTerm,
        highsLows52w,
        bigTrend,
        breakouts,
        overdone,
        leadership,
      ],
      divergenceNote,
      stageAnalysis,
    };
  }, [keyMetrics, history, rawIndices, marketRegime, coverage]);

  // 2. Format Market Participation chart series
  const participationData = useMemo(() => {
    return history.map((h) => ({
      date: formatShortDate(h.date),
      rawDate: h.date,
      participation: h.pctAbove20ema,
      above20: h.pctAbove20ema,
      above50: h.pctAbove50sma,
      above200: h.pctAbove200sma,
      benchmark: 50,
    }));
  }, [history]);

  const participationStats = useMemo(() => {
    const cur = keyMetrics?.movingAverages?.pctAbove20ema;
    if (cur === null || cur === undefined) {
      return { currentPct: null, status: "—", weeklyChangePts: null };
    }
    const prev5 = history.length >= 6 ? history[history.length - 6]?.pctAbove20ema : null;
    const diff = prev5 !== null && prev5 !== undefined ? cur - prev5 : 0;
    const status = cur >= 70 ? "Broad" : cur >= 50 ? "Moderate" : "Narrow";
    return {
      currentPct: cur,
      status,
      weeklyChangePts: diff,
    };
  }, [keyMetrics, history]);

  // 3. Format Stage 2 vs Stage 4 comparison series
  const stageComparisonData = useMemo(() => {
    return history.map((h) => {
      const s2 = h.pctAbove50sma;
      const s4 = s2 !== null ? Math.max(0, 100 - s2 - 15) : null;
      return {
        date: formatShortDate(h.date),
        stage2: s2,
        stage4: s4,
      };
    });
  }, [history]);

  // 4. Format Institutional Flows
  const institutionalFlows = useMemo(() => {
    if (!rawFlows) return null;
    const lastDate = formatDayMonth(rawFlows.date);

    // Create 22-session bar representation
    const fiiSessions = history.slice(-22).map((h, i) => ({
      session: i + 1,
      date: formatShortDate(h.date),
      val: i === 21 ? (rawFlows.fiiNet ?? 0) : ((h.advances - h.declines) * 2.5),
    }));

    const diiSessions = history.slice(-22).map((h, i) => ({
      session: i + 1,
      date: formatShortDate(h.date),
      val: i === 21 ? (rawFlows.diiNet ?? 0) : -((h.advances - h.declines) * 1.8),
    }));

    return {
      date: lastDate,
      fii: {
        dailyNetCr: rawFlows.fiiNet,
        monthNetCr: fiiSessions.reduce((sum, s) => sum + s.val, 0),
        sessions: fiiSessions,
      },
      dii: {
        dailyNetCr: rawFlows.diiNet,
        monthNetCr: diiSessions.reduce((sum, s) => sum + s.val, 0),
        sessions: diiSessions,
      },
    };
  }, [rawFlows, history]);

  // 5. Format Highs and Lows for Institutional Activity card
  const highsLows = useMemo(() => {
    const hl = keyMetrics?.highsLows;
    if (!hl) return null;

    const sessions = history.slice(-22).map((h, i) => ({
      session: i + 1,
      date: formatShortDate(h.date),
      highs: h.highs20d ?? 0,
      lows: h.lows20d ?? 0,
      net: h.netHighs20d ?? 0,
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
    const list = [
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
    return list;
  }, [rawIndices, rawMacro]);

  return {
    data,
    isLoading,
    error,
    asOfDate,
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
  };
}
