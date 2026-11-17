import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const VALID_UNIVERSES = [
  "nifty500",
  "nifty200",
  "nifty100",
  "nifty_midcap150",
  "nifty_smallcap250",
  "liquid",
  "all",
];

const VALID_PERIODS = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

const PERIOD_SESSIONS = {
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
};

export async function GET(request) {
  // Defence in depth: Verify session token
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const universe = (searchParams.get("universe") || "all").toLowerCase();
    const period = (searchParams.get("period") || "1Y").toUpperCase();

    if (!VALID_UNIVERSES.includes(universe)) {
      return NextResponse.json(
        { error: `Invalid universe '${universe}'. Allowed: ${VALID_UNIVERSES.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        { error: `Invalid period '${period}'. Allowed: ${VALID_PERIODS.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 1. Get breadth history for universe based on requested period
    let historyQuery;
    let queryParams;

    if (period === "YTD") {
      historyQuery = `
        SELECT *
        FROM daily_market_breadth
        WHERE universe = $1
          AND trade_date >= (
            SELECT date_trunc('year', MAX(trade_date))
            FROM daily_market_breadth
            WHERE universe = $1
          )
        ORDER BY trade_date ASC;
      `;
      queryParams = [universe];
    } else if (period === "ALL") {
      historyQuery = `
        SELECT *
        FROM daily_market_breadth
        WHERE universe = $1
        ORDER BY trade_date ASC;
      `;
      queryParams = [universe];
    } else {
      const sessionLimit = PERIOD_SESSIONS[period] || 252;
      historyQuery = `
        SELECT *
        FROM (
          SELECT *
          FROM daily_market_breadth
          WHERE universe = $1
          ORDER BY trade_date DESC
          LIMIT $2
        ) sub
        ORDER BY trade_date ASC;
      `;
      queryParams = [universe, sessionLimit];
    }

    const historyResult = await queryWithRetry(historyQuery, queryParams);
    const historyRows = historyResult.rows;

    if (!historyRows || historyRows.length === 0) {
      return NextResponse.json(
        {
          asOfDate: null,
          universe,
          period,
          meta: { constituentsApproximate: false, asOfDate: null },
          marketRegime: null,
          keyMetrics: null,
          history: [],
          indices: {},
          macro: {},
          institutionalFlows: null,
          performance: {},
          rebasedSeries: {},
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
          },
        }
      );
    }

    const latest = historyRows[historyRows.length - 1];
    const prev = historyRows.length >= 2 ? historyRows[historyRows.length - 2] : null;
    const asOfDate = latest.trade_date
      ? new Date(latest.trade_date).toISOString().split("T")[0]
      : null;

    // Fetch latest completed run timestamp from ingest_runs for data freshness tracking
    let lastUpdatedAt = null;
    try {
      const lastRunRes = await queryWithRetry(
        "SELECT completed_at FROM ingest_runs WHERE status = 'completed' ORDER BY run_id DESC LIMIT 1;"
      );
      if (lastRunRes.rows[0]?.completed_at) {
        lastUpdatedAt = new Date(lastRunRes.rows[0].completed_at).toISOString();
      }
    } catch (e) {
      // Non-fatal if ingest_runs is empty or inaccessible
      console.warn("Could not query last completed_at from ingest_runs:", e.message);
    }

    // 2. Dynamic cumulative A-D line & history mapping per spec 4.2
    let cumulativeAd = 0;
    const history = historyRows.map((r) => {
      const adv = r.advances !== null ? Number(r.advances) : 0;
      const dec = r.declines !== null ? Number(r.declines) : 0;
      cumulativeAd += adv - dec;

      return {
        date: r.trade_date ? new Date(r.trade_date).toISOString().split("T")[0] : null,
        advances: r.advances !== null ? Number(r.advances) : null,
        declines: r.declines !== null ? Number(r.declines) : null,
        unchanged: r.unchanged !== null ? Number(r.unchanged) : null,
        adRatio: r.ad_ratio !== null ? parseFloat(r.ad_ratio) : null,
        adRatio20d: r.ad_ratio_20d !== null ? parseFloat(r.ad_ratio_20d) : null,
        adRatio40d: r.ad_ratio_40d !== null ? parseFloat(r.ad_ratio_40d) : null,
        adLine: cumulativeAd, // Spec 4.2: Computed dynamically from start of selected window
        pctAbove20ema: r.pct_above_20ema !== null ? parseFloat(r.pct_above_20ema) : null,
        pctAbove50sma: r.pct_above_50sma !== null ? parseFloat(r.pct_above_50sma) : null,
        pctAbove200sma: r.pct_above_200sma !== null ? parseFloat(r.pct_above_200sma) : null,
        highs20d: r.highs_20d !== null ? Number(r.highs_20d) : null,
        lows20d: r.lows_20d !== null ? Number(r.lows_20d) : null,
        netHighs20d: r.net_highs_20d !== null ? Number(r.net_highs_20d) : null,
        highs52w: r.highs_52w !== null ? Number(r.highs_52w) : null,
        lows52w: r.lows_52w !== null ? Number(r.lows_52w) : null,
        net52w: r.net_52w !== null ? Number(r.net_52w) : null,
        pctMoversUp: r.pct_movers_up_4pct !== null ? parseFloat(r.pct_movers_up_4pct) : null,
        pctMoversDown: r.pct_movers_down_4pct !== null ? parseFloat(r.pct_movers_down_4pct) : null,
        moversRatio5d: r.movers_ratio_5d !== null ? parseFloat(r.movers_ratio_5d) : null,
        moversRatio10d: r.movers_ratio_10d !== null ? parseFloat(r.movers_ratio_10d) : null,
        breakouts20d: r.breakouts_20d !== null ? Number(r.breakouts_20d) : null,
        breakdowns20d: r.breakdowns_20d !== null ? Number(r.breakdowns_20d) : null,
        stage1Pct: r.weinstein_stage_1_pct !== null ? parseFloat(r.weinstein_stage_1_pct) : null,
        stage2Pct: r.weinstein_stage_2_pct !== null ? parseFloat(r.weinstein_stage_2_pct) : null,
        stage3Pct: r.weinstein_stage_3_pct !== null ? parseFloat(r.weinstein_stage_3_pct) : null,
        stage4Pct: r.weinstein_stage_4_pct !== null ? parseFloat(r.weinstein_stage_4_pct) : null,
        stage1Count: r.stage_1_count !== null ? Number(r.stage_1_count) : null,
        stage2Count: r.stage_2_count !== null ? Number(r.stage_2_count) : null,
        stage3Count: r.stage_3_count !== null ? Number(r.stage_3_count) : null,
        stage4Count: r.stage_4_count !== null ? Number(r.stage_4_count) : null,
        stageUnclassified: r.stage_unclassified !== null ? Number(r.stage_unclassified) : null,
        totalStocks: r.total_stocks !== null ? Number(r.total_stocks) : null,
      };
    });

    // 3. Coverage metadata
    const UNIVERSE_COVERAGE = {
      nifty500: {
        total: 501,
        excludedReason:
          "3 REIT units (EMBASSY, BIRET, BAGMANE) and 1 corporate demerger placeholder (DUMMYHEG) are excluded from equity OHLCV as non-equity/non-traded instruments.",
      },
      nifty200: { total: 200, excludedReason: "" },
      nifty100: { total: 100, excludedReason: "" },
      nifty_midcap150: { total: 150, excludedReason: "" },
      nifty_smallcap250: { total: 251, excludedReason: "1 non-trading unit excluded" },
      liquid: { total: latest.total_stocks || 500, excludedReason: "Stocks below close ₹20 or 50D volume 25k excluded" },
      all: { total: 2599, excludedReason: "SME and debt instruments excluded" },
    };
    const universeMeta = UNIVERSE_COVERAGE[universe] || {
      total: latest.total_stocks || 500,
      excludedReason: "",
    };
    const coverage = {
      valid: latest.total_stocks || historyRows.length,
      total: universeMeta.total,
      pct:
        universeMeta.total > 0 && latest.total_stocks
          ? Math.round((latest.total_stocks / universeMeta.total) * 1000) / 10
          : 100,
      excludedReason: universeMeta.excludedReason,
    };

    // 4. Fetch index history (past 280 days for sparklines and 52W high calculation)
    const indexHistoryQuery = `
      SELECT index_name, trade_date, close
      FROM daily_index_ohlcv
      WHERE trade_date >= (CURRENT_DATE - INTERVAL '390 days')
      ORDER BY index_name, trade_date ASC;
    `;
    const indexHistoryResult = await queryWithRetry(indexHistoryQuery);
    const indexGroups = {};
    for (const row of indexHistoryResult.rows) {
      if (!indexGroups[row.index_name]) indexGroups[row.index_name] = [];
      indexGroups[row.index_name].push({
        date: new Date(row.trade_date).toISOString().split("T")[0],
        close: parseFloat(row.close),
      });
    }

    // 4b. Previous calendar year last close for YTD per spec 4.9:
    // R_YTD = (close_t / last close of the previous calendar year - 1) * 100
    const prevYearCloseQuery = `
      SELECT index_name, close
      FROM (
        SELECT index_name, close,
               ROW_NUMBER() OVER(PARTITION BY index_name ORDER BY trade_date DESC) as rn
        FROM daily_index_ohlcv
        WHERE trade_date < date_trunc('year', CURRENT_DATE)
      ) sub
      WHERE rn = 1;
    `;
    const prevYearCloseResult = await queryWithRetry(prevYearCloseQuery);
    const prevYearCloses = {};
    for (const row of prevYearCloseResult.rows) {
      prevYearCloses[row.index_name] = parseFloat(row.close);
    }

    const indices = {};
    const keyMap = {
      "NIFTY 50": "nifty50",
      "NIFTY 500": "nifty500",
      "NIFTY MIDCAP 150": "midcap150",
      "NIFTY SMALLCAP 250": "smallcap250",
      "INDIA VIX": "vix",
    };

    for (const [indexName, rows] of Object.entries(indexGroups)) {
      if (!rows.length) continue;
      const cur = rows[rows.length - 1].close;
      const prevClose = rows.length >= 2 ? rows[rows.length - 2].close : null;
      const change = prevClose !== null ? cur - prevClose : null;
      // Spec: pctChange is null, not 0, when there is no previous close
      const pctChange =
        prevClose !== null && prevClose !== 0
          ? Math.round(((cur - prevClose) / prevClose) * 10000) / 100
          : null;

      const pastYearRows = rows.slice(-252);
      const high52w = Math.max(...pastYearRows.map((r) => r.close));
      const distFromHighPct =
        high52w > 0 ? Math.round(((cur - high52w) / high52w) * 1000) / 10 : null;

      const sparkline = rows.slice(-20).map((r) => ({ val: r.close }));
      const key = keyMap[indexName] || indexName.toLowerCase().replace(/\s+/g, "");

      indices[key] = {
        name: indexName,
        close: cur,
        change: change !== null ? Math.round(change * 100) / 100 : null,
        pctChange,
        high52w: Math.round(high52w * 100) / 100,
        distFromHighPct: indexName === "INDIA VIX" ? null : distFromHighPct,
        sparkline,
      };
    }

    // 5. Macro rates history (USD/INR and Brent Crude formatted to two decimals)
    const macroHistoryQuery = `
      SELECT series, trade_date, close
      FROM daily_macro_rates
      WHERE trade_date >= (CURRENT_DATE - INTERVAL '390 days')
      ORDER BY series, trade_date ASC;
    `;
    const macroHistoryResult = await queryWithRetry(macroHistoryQuery);
    const macroGroups = {};
    for (const row of macroHistoryResult.rows) {
      if (!macroGroups[row.series]) macroGroups[row.series] = [];
      macroGroups[row.series].push({
        date: new Date(row.trade_date).toISOString().split("T")[0],
        close: parseFloat(row.close),
      });
    }

    const macro = {};
    for (const [series, rows] of Object.entries(macroGroups)) {
      if (!rows.length) continue;
      const rawCur = rows[rows.length - 1].close;
      const rawPrev = rows.length >= 2 ? rows[rows.length - 2].close : null;
      const cur = Math.round(rawCur * 100) / 100;
      const prevClose = rawPrev !== null ? Math.round(rawPrev * 100) / 100 : null;
      const change = prevClose !== null ? Math.round((cur - prevClose) * 100) / 100 : null;
      // pctChange is null when no previous close exists
      const pctChange =
        prevClose !== null && prevClose !== 0
          ? Math.round(((cur - prevClose) / prevClose) * 10000) / 100
          : null;

      const pastYearRows = rows.slice(-252);
      const high52w = Math.max(...pastYearRows.map((r) => r.close));
      const distFromHighPct =
        high52w > 0 ? Math.round(((cur - high52w) / high52w) * 1000) / 10 : null;

      const sparkline = rows.slice(-20).map((r) => ({ val: Math.round(r.close * 100) / 100 }));
      const key = series.toLowerCase();
      macro[key] = {
        series,
        close: cur,
        change,
        pctChange,
        high52w: Math.round(high52w * 100) / 100,
        distFromHighPct,
        sparkline,
      };
    }

    // 6. Real FII/DII for the last 22 sessions (Spec 4.7 & Phase 4: never padded)
    const flowQuery = `
      SELECT trade_date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
      FROM daily_fii_dii_cash
      ORDER BY trade_date DESC
      LIMIT 22;
    `;
    const flowResult = await queryWithRetry(flowQuery);
    const flowRows = flowResult.rows.reverse(); // Ascending for time series
    const institutionalFlows = {
      fiiDiiSessionsAvailable: flowRows.length,
      sessions: flowRows.map((r) => ({
        date: new Date(r.trade_date).toISOString().split("T")[0],
        fiiBuy: r.fii_buy ? parseFloat(r.fii_buy) : null,
        fiiSell: r.fii_sell ? parseFloat(r.fii_sell) : null,
        fiiNet: r.fii_net ? parseFloat(r.fii_net) : null,
        diiBuy: r.dii_buy ? parseFloat(r.dii_buy) : null,
        diiSell: r.dii_sell ? parseFloat(r.dii_sell) : null,
        diiNet: r.dii_net ? parseFloat(r.dii_net) : null,
      })),
      latest:
        flowRows.length > 0
          ? {
              date: new Date(flowRows[flowRows.length - 1].trade_date).toISOString().split("T")[0],
              fiiNet: flowRows[flowRows.length - 1].fii_net
                ? parseFloat(flowRows[flowRows.length - 1].fii_net)
                : null,
              diiNet: flowRows[flowRows.length - 1].dii_net
                ? parseFloat(flowRows[flowRows.length - 1].dii_net)
                : null,
            }
          : null,
    };

    // 7. Large / Mid / Small performance per Spec 4.9:
    // 1M = 21 sessions, 3M = 63 sessions, YTD = last close of previous calendar year
    const calcReturn = (rows, sessions) => {
      if (!rows || rows.length <= sessions) return null;
      const current = rows[rows.length - 1].close;
      const past = rows[rows.length - 1 - sessions].close;
      if (!past) return null;
      return Math.round(((current - past) / past) * 1000) / 10;
    };

    const calcYtd = (rows, indexName) => {
      if (!rows || rows.length === 0) return null;
      const current = rows[rows.length - 1].close;
      const prevYearClose = prevYearCloses[indexName];
      if (!prevYearClose) return null;
      return Math.round(((current - prevYearClose) / prevYearClose) * 1000) / 10;
    };

    const performance = {
      large: {
        "1M": calcReturn(indexGroups["NIFTY 50"], 21),
        "3M": calcReturn(indexGroups["NIFTY 50"], 63),
        YTD: calcYtd(indexGroups["NIFTY 50"], "NIFTY 50"),
      },
      mid: {
        "1M": calcReturn(indexGroups["NIFTY MIDCAP 150"], 21),
        "3M": calcReturn(indexGroups["NIFTY MIDCAP 150"], 63),
        YTD: calcYtd(indexGroups["NIFTY MIDCAP 150"], "NIFTY MIDCAP 150"),
      },
      small: {
        "1M": calcReturn(indexGroups["NIFTY SMALLCAP 250"], 21),
        "3M": calcReturn(indexGroups["NIFTY SMALLCAP 250"], 63),
        YTD: calcYtd(indexGroups["NIFTY SMALLCAP 250"], "NIFTY SMALLCAP 250"),
      },
    };

    // 8. Large / Mid / Small rebased series (Spec 4.9 & 4.11: Benchmark = Nifty 500 rebased to 100)
    const windowDates = history.map((h) => h.date);
    const buildRebased = (rows) => {
      if (!rows || rows.length === 0) return [];
      const windowRows = rows.filter((r) => windowDates.includes(r.date));
      if (windowRows.length === 0) return [];
      const baseClose = windowRows[0].close;
      return windowRows.map((r) => ({
        date: r.date,
        rebased: baseClose > 0 ? Math.round((r.close / baseClose) * 10000) / 100 : 100,
        cumReturnPct: baseClose > 0 ? Math.round(((r.close - baseClose) / baseClose) * 10000) / 100 : 0,
      }));
    };

    const rebasedSeries = {
      large: buildRebased(indexGroups["NIFTY 50"]),
      mid: buildRebased(indexGroups["NIFTY MIDCAP 150"]),
      small: buildRebased(indexGroups["NIFTY SMALLCAP 250"]),
      benchmark: buildRebased(indexGroups["NIFTY 500"]),
    };

    // 9. Market Regime & Spec 4.8 Read Indicators
    let readIndicators = null;
    if (latest.read_indicators) {
      try {
        readIndicators =
          typeof latest.read_indicators === "string"
            ? JSON.parse(latest.read_indicators)
            : latest.read_indicators;
      } catch (e) {
        readIndicators = null;
      }
    }

    const marketRegime = {
      status: latest.regime || "—",
      score: null, // Spec 4.8: Deleted invented 40/30/30 score
      distributionDays:
        latest.distribution_days !== null ? Number(latest.distribution_days) : null,
      breadthThrust: Boolean(latest.breadth_thrust),
      readIndicators,
    };

    // 10. Key Metrics with 1-day stage changes
    const stageChange1D = prev
      ? {
          stage1:
            latest.stage_1_count !== null && prev.stage_1_count !== null
              ? Number(latest.stage_1_count) - Number(prev.stage_1_count)
              : null,
          stage2:
            latest.stage_2_count !== null && prev.stage_2_count !== null
              ? Number(latest.stage_2_count) - Number(prev.stage_2_count)
              : null,
          stage3:
            latest.stage_3_count !== null && prev.stage_3_count !== null
              ? Number(latest.stage_3_count) - Number(prev.stage_3_count)
              : null,
          stage4:
            latest.stage_4_count !== null && prev.stage_4_count !== null
              ? Number(latest.stage_4_count) - Number(prev.stage_4_count)
              : null,
        }
      : null;

    const keyMetrics = {
      advanceDecline: {
        advances: latest.advances !== null ? Number(latest.advances) : null,
        declines: latest.declines !== null ? Number(latest.declines) : null,
        unchanged: latest.unchanged !== null ? Number(latest.unchanged) : null,
        ratio: latest.ad_ratio !== null ? parseFloat(latest.ad_ratio) : null,
        ratio20d: latest.ad_ratio_20d !== null ? parseFloat(latest.ad_ratio_20d) : null,
        ratio40d: latest.ad_ratio_40d !== null ? parseFloat(latest.ad_ratio_40d) : null,
      },
      adLine: cumulativeAd,
      movingAverages: {
        pctAbove20ema:
          latest.pct_above_20ema !== null ? parseFloat(latest.pct_above_20ema) : null,
        pctAbove50sma:
          latest.pct_above_50sma !== null ? parseFloat(latest.pct_above_50sma) : null,
        pctAbove200sma:
          latest.pct_above_200sma !== null ? parseFloat(latest.pct_above_200sma) : null,
      },
      highsLows: {
        highs20d: latest.highs_20d !== null ? Number(latest.highs_20d) : null,
        lows20d: latest.lows_20d !== null ? Number(latest.lows_20d) : null,
        net20d: latest.net_highs_20d !== null ? Number(latest.net_highs_20d) : null,
        highs52w: latest.highs_52w !== null ? Number(latest.highs_52w) : null,
        lows52w: latest.lows_52w !== null ? Number(latest.lows_52w) : null,
        net52w: latest.net_52w !== null ? Number(latest.net_52w) : null,
      },
      movers4pct: {
        pctUp: latest.pct_movers_up_4pct !== null ? parseFloat(latest.pct_movers_up_4pct) : null,
        pctDown:
          latest.pct_movers_down_4pct !== null ? parseFloat(latest.pct_movers_down_4pct) : null,
        ratio5d: latest.movers_ratio_5d !== null ? parseFloat(latest.movers_ratio_5d) : null,
        ratio10d: latest.movers_ratio_10d !== null ? parseFloat(latest.movers_ratio_10d) : null,
      },
      breakouts: {
        breakouts20d: latest.breakouts_20d !== null ? Number(latest.breakouts_20d) : null,
        breakdowns20d: latest.breakdowns_20d !== null ? Number(latest.breakdowns_20d) : null,
      },
      weinstein: {
        stage1:
          latest.weinstein_stage_1_pct !== null
            ? parseFloat(latest.weinstein_stage_1_pct)
            : null,
        stage2:
          latest.weinstein_stage_2_pct !== null
            ? parseFloat(latest.weinstein_stage_2_pct)
            : null,
        stage3:
          latest.weinstein_stage_3_pct !== null
            ? parseFloat(latest.weinstein_stage_3_pct)
            : null,
        stage4:
          latest.weinstein_stage_4_pct !== null
            ? parseFloat(latest.weinstein_stage_4_pct)
            : null,
        change1D: stageChange1D,
        counts: {
          stage1: latest.stage_1_count !== null ? Number(latest.stage_1_count) : null,
          stage2: latest.stage_2_count !== null ? Number(latest.stage_2_count) : null,
          stage3: latest.stage_3_count !== null ? Number(latest.stage_3_count) : null,
          stage4: latest.stage_4_count !== null ? Number(latest.stage_4_count) : null,
          unclassified:
            latest.stage_unclassified !== null ? Number(latest.stage_unclassified) : null,
        },
      },
    };

    return NextResponse.json(
      {
        asOfDate,
        lastUpdatedAt,
        universe,
        period,
        meta: {
          constituentsApproximate: false,
          asOfDate,
          lastUpdatedAt,
        },
        coverage,
        marketRegime,
        keyMetrics,
        history,
        indices,
        macro,
        institutionalFlows,
        performance,
        rebasedSeries,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      }
    );
  } catch (error) {
    console.error("Error in /api/terminal/data:", error);
    // Return HTTP 503 when the database is unreachable or waking from sleep
    return NextResponse.json(
      { error: "Database unreachable or waking from sleep", message: error.message },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
