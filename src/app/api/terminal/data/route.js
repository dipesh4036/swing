import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 900;

const VALID_UNIVERSES = [
  "nifty500",
  "nifty200",
  "nifty100",
  "nifty_midcap150",
  "nifty_smallcap250",
  "all",
];

const VALID_PERIODS = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const universe = (searchParams.get("universe") || "nifty500").toLowerCase();
    const period = (searchParams.get("period") || "1Y").toUpperCase();

    if (!VALID_UNIVERSES.includes(universe)) {
      return NextResponse.json(
        { error: `Invalid universe '${universe}'. Allowed: ${VALID_UNIVERSES.join(", ")}` },
        { status: 400 }
      );
    }

    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        { error: `Invalid period '${period}'. Allowed: ${VALID_PERIODS.join(", ")}` },
        { status: 400 }
      );
    }

    const pool = getDbPool();

    // 1. Get available breadth history for the universe
    let limitClause = "";
    if (period === "1M") limitClause = "LIMIT 21";
    else if (period === "3M") limitClause = "LIMIT 63";
    else if (period === "6M") limitClause = "LIMIT 126";
    else if (period === "1Y") limitClause = "LIMIT 252";

    let historyQuery = `
      SELECT *
      FROM (
        SELECT *
        FROM daily_market_breadth
        WHERE universe = $1
        ORDER BY trade_date DESC
        ${limitClause}
      ) sub
      ORDER BY trade_date ASC;
    `;
    let historyParams = [universe];

    if (period === "YTD") {
      historyQuery = `
        SELECT *
        FROM daily_market_breadth
        WHERE universe = $1 AND trade_date >= date_trunc('year', CURRENT_DATE)
        ORDER BY trade_date ASC;
      `;
      historyParams = [universe];
    } else if (period === "ALL") {
      historyQuery = `
        SELECT *
        FROM daily_market_breadth
        WHERE universe = $1
        ORDER BY trade_date ASC;
      `;
      historyParams = [universe];
    }

    const historyResult = await pool.query(historyQuery, historyParams);
    const historyRows = historyResult.rows;

    if (!historyRows || historyRows.length === 0) {
      return NextResponse.json({
        asOfDate: null,
        universe,
        period,
        marketRegime: null,
        keyMetrics: null,
        history: [],
        indices: {},
        macro: {},
        institutionalFlows: null,
        performance: {},
      });
    }

    const latest = historyRows[historyRows.length - 1];
    const asOfDate = latest.trade_date ? new Date(latest.trade_date).toISOString().split("T")[0] : null;

    // 2. Fetch latest index OHLCV and previous day for change calculation
    const indexQuery = `
      WITH ranked_indices AS (
        SELECT 
          index_name,
          trade_date,
          close,
          ROW_NUMBER() OVER (PARTITION BY index_name ORDER BY trade_date DESC) as rn
        FROM daily_index_ohlcv
      )
      SELECT 
        curr.index_name,
        curr.close as current_close,
        prev.close as prev_close
      FROM ranked_indices curr
      LEFT JOIN ranked_indices prev ON curr.index_name = prev.index_name AND prev.rn = 2
      WHERE curr.rn = 1;
    `;
    const indexResult = await pool.query(indexQuery);
    const indices = {};
    for (const row of indexResult.rows) {
      const cur = parseFloat(row.current_close);
      const prev = row.prev_close ? parseFloat(row.prev_close) : null;
      const change = prev !== null ? cur - prev : 0;
      const pctChange = prev && prev !== 0 ? (change / prev) * 100 : 0;
      
      const keyMap = {
        "NIFTY 50": "nifty50",
        "NIFTY 500": "nifty500",
        "NIFTY MIDCAP 150": "midcap150",
        "NIFTY SMALLCAP 250": "smallcap250",
        "INDIA VIX": "vix",
      };
      const key = keyMap[row.index_name] || row.index_name.toLowerCase().replace(/\s+/g, "");
      indices[key] = {
        name: row.index_name,
        close: cur,
        change: Math.round(change * 100) / 100,
        pctChange: Math.round(pctChange * 100) / 100,
      };
    }

    // 3. Fetch latest macro rates
    const macroQuery = `
      WITH ranked_macro AS (
        SELECT 
          series,
          trade_date,
          close,
          ROW_NUMBER() OVER (PARTITION BY series ORDER BY trade_date DESC) as rn
        FROM daily_macro_rates
      )
      SELECT 
        curr.series,
        curr.close as current_close,
        prev.close as prev_close
      FROM ranked_macro curr
      LEFT JOIN ranked_macro prev ON curr.series = prev.series AND prev.rn = 2
      WHERE curr.rn = 1;
    `;
    const macroResult = await pool.query(macroQuery);
    const macro = {};
    for (const row of macroResult.rows) {
      const cur = parseFloat(row.current_close);
      const prev = row.prev_close ? parseFloat(row.prev_close) : null;
      const change = prev !== null ? cur - prev : 0;
      const pctChange = prev && prev !== 0 ? (change / prev) * 100 : 0;
      const key = row.series.toLowerCase();
      macro[key] = {
        series: row.series,
        close: cur,
        change: Math.round(change * 100) / 100,
        pctChange: Math.round(pctChange * 100) / 100,
      };
    }

    // 4. Fetch latest institutional cash flows
    const flowQuery = `
      SELECT trade_date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
      FROM daily_fii_dii_cash
      ORDER BY trade_date DESC
      LIMIT 1;
    `;
    const flowResult = await pool.query(flowQuery);
    let institutionalFlows = null;
    if (flowResult.rows.length > 0) {
      const r = flowResult.rows[0];
      institutionalFlows = {
        date: r.trade_date ? new Date(r.trade_date).toISOString().split("T")[0] : null,
        fiiBuy: r.fii_buy ? parseFloat(r.fii_buy) : null,
        fiiSell: r.fii_sell ? parseFloat(r.fii_sell) : null,
        fiiNet: r.fii_net ? parseFloat(r.fii_net) : null,
        diiBuy: r.dii_buy ? parseFloat(r.dii_buy) : null,
        diiSell: r.dii_sell ? parseFloat(r.dii_sell) : null,
        diiNet: r.dii_net ? parseFloat(r.dii_net) : null,
      };
    }

    // 5. Index performance: Large (Nifty 50), Mid (Midcap 150), Small (Smallcap 250)
    // 1M (21 sessions), 3M (63 sessions), YTD
    const perfQuery = `
      SELECT index_name, trade_date, close
      FROM daily_index_ohlcv
      WHERE index_name IN ('NIFTY 50', 'NIFTY MIDCAP 150', 'NIFTY SMALLCAP 250')
      ORDER BY index_name, trade_date DESC;
    `;
    const perfResult = await pool.query(perfQuery);
    const indexHistory = {};
    for (const r of perfResult.rows) {
      if (!indexHistory[r.index_name]) indexHistory[r.index_name] = [];
      indexHistory[r.index_name].push({
        date: r.trade_date,
        close: parseFloat(r.close),
      });
    }

    const calcReturn = (rows, sessions) => {
      if (!rows || rows.length <= sessions) return null;
      const current = rows[0].close;
      const past = rows[sessions].close;
      if (!past) return null;
      return Math.round(((current - past) / past) * 1000) / 10;
    };

    const calcYtdReturn = (rows) => {
      if (!rows || rows.length === 0) return null;
      const current = rows[0].close;
      const currentYear = new Date(rows[0].date).getFullYear();
      const firstOfYear = [...rows].reverse().find((r) => new Date(r.date).getFullYear() === currentYear);
      if (!firstOfYear || !firstOfYear.close) return null;
      return Math.round(((current - firstOfYear.close) / firstOfYear.close) * 1000) / 10;
    };

    const performance = {
      large: {
        "1M": calcReturn(indexHistory["NIFTY 50"], 21),
        "3M": calcReturn(indexHistory["NIFTY 50"], 63),
        "YTD": calcYtdReturn(indexHistory["NIFTY 50"]),
      },
      mid: {
        "1M": calcReturn(indexHistory["NIFTY MIDCAP 150"], 21),
        "3M": calcReturn(indexHistory["NIFTY MIDCAP 150"], 63),
        "YTD": calcYtdReturn(indexHistory["NIFTY MIDCAP 150"]),
      },
      small: {
        "1M": calcReturn(indexHistory["NIFTY SMALLCAP 250"], 21),
        "3M": calcReturn(indexHistory["NIFTY SMALLCAP 250"], 63),
        "YTD": calcYtdReturn(indexHistory["NIFTY SMALLCAP 250"]),
      },
    };

    // Format formatted response
    const marketRegime = {
      status: latest.regime || "—",
      score: latest.regime_score !== null ? Number(latest.regime_score) : null,
      distributionDays: latest.distribution_days !== null ? Number(latest.distribution_days) : null,
      breadthThrust: Boolean(latest.breadth_thrust),
    };

    const keyMetrics = {
      advanceDecline: {
        advances: latest.advances !== null ? Number(latest.advances) : null,
        declines: latest.declines !== null ? Number(latest.declines) : null,
        unchanged: latest.unchanged !== null ? Number(latest.unchanged) : null,
        ratio: latest.ad_ratio !== null ? parseFloat(latest.ad_ratio) : null,
        ratio20d: latest.ad_ratio_20d !== null ? parseFloat(latest.ad_ratio_20d) : null,
        ratio40d: latest.ad_ratio_40d !== null ? parseFloat(latest.ad_ratio_40d) : null,
      },
      adLine: latest.ad_line !== null ? parseFloat(latest.ad_line) : null,
      movingAverages: {
        pctAbove20ema: latest.pct_above_20ema !== null ? parseFloat(latest.pct_above_20ema) : null,
        pctAbove50sma: latest.pct_above_50sma !== null ? parseFloat(latest.pct_above_50sma) : null,
        pctAbove200sma: latest.pct_above_200sma !== null ? parseFloat(latest.pct_above_200sma) : null,
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
        pctDown: latest.pct_movers_down_4pct !== null ? parseFloat(latest.pct_movers_down_4pct) : null,
        ratio5d: latest.movers_ratio_5d !== null ? parseFloat(latest.movers_ratio_5d) : null,
        ratio10d: latest.movers_ratio_10d !== null ? parseFloat(latest.movers_ratio_10d) : null,
      },
      breakouts: {
        breakouts20d: latest.breakouts_20d !== null ? Number(latest.breakouts_20d) : null,
        breakdowns20d: latest.breakdowns_20d !== null ? Number(latest.breakdowns_20d) : null,
      },
      weinstein: {
        stage1: latest.weinstein_stage_1_pct !== null ? parseFloat(latest.weinstein_stage_1_pct) : null,
        stage2: latest.weinstein_stage_2_pct !== null ? parseFloat(latest.weinstein_stage_2_pct) : null,
        stage3: latest.weinstein_stage_3_pct !== null ? parseFloat(latest.weinstein_stage_3_pct) : null,
        stage4: latest.weinstein_stage_4_pct !== null ? parseFloat(latest.weinstein_stage_4_pct) : null,
      },
    };

    const history = historyRows.map((r) => ({
      date: r.trade_date ? new Date(r.trade_date).toISOString().split("T")[0] : null,
      advances: r.advances !== null ? Number(r.advances) : null,
      declines: r.declines !== null ? Number(r.declines) : null,
      unchanged: r.unchanged !== null ? Number(r.unchanged) : null,
      adRatio: r.ad_ratio !== null ? parseFloat(r.ad_ratio) : null,
      adRatio20d: r.ad_ratio_20d !== null ? parseFloat(r.ad_ratio_20d) : null,
      adRatio40d: r.ad_ratio_40d !== null ? parseFloat(r.ad_ratio_40d) : null,
      adLine: r.ad_line !== null ? parseFloat(r.ad_line) : null,
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
      breakouts20d: r.breakouts_20d !== null ? Number(r.breakouts_20d) : null,
      breakdowns20d: r.breakdowns_20d !== null ? Number(r.breakdowns_20d) : null,
    }));

    return NextResponse.json({
      asOfDate,
      universe,
      period,
      marketRegime,
      keyMetrics,
      history,
      indices,
      macro,
      institutionalFlows,
      performance,
    });
  } catch (error) {
    console.error("Error in /api/terminal/data:", error);
    return NextResponse.json(
      { error: "Internal server error fetching market breadth data" },
      { status: 500 }
    );
  }
}
