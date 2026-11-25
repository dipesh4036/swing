import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  computeStandardReturns,
  computeAlignedRS,
  computeQuadrant,
  computeRSSeries,
} from "@/lib/sector-math";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEADER_RULES = "RS Rank >= 70 AND within 15% of 52-week high";

function isStockLeader(stock) {
  if (!stock || stock.rs_rank == null || stock.pct_from_52w_high == null) {
    return false;
  }
  return stock.rs_rank >= 70 && stock.pct_from_52w_high >= -15.0;
}

export async function GET(request) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const indFilter = searchParams.get("industry");

  try {
    // 1. Determine asOf dates
    const asOfRes = await queryWithRetry(`
      SELECT MAX(trade_date)::text as max_date FROM daily_industry_breadth;
    `);
    const asOf = asOfRes.rows[0]?.max_date || null;

    const breadthAsOfRes = await queryWithRetry(`
      SELECT MAX(trade_date)::text as max_date FROM daily_market_breadth;
    `);
    const breadthAsOf = breadthAsOfRes.rows[0]?.max_date || null;

    const mcapAsOfRes = await queryWithRetry(`
      SELECT MAX(trade_date)::text as max_date FROM stock_mcap;
    `);
    const mcapAsOf = mcapAsOfRes.rows[0]?.max_date || null;

    if (!asOf) {
      return NextResponse.json({
        asOf: null,
        breadthAsOf,
        mcapAsOf,
        benchmark: "NIFTY 500",
        coverage: { n_universe: 0, n_classified: 0, n_unclassified: 0, n_small_industries: 0 },
        sectors: [],
        industries: [],
        stocks: [],
        leader_rules: LEADER_RULES,
      });
    }

    // Benchmark candle series: Nifty 500 for RS calculation
    const benchRes = await queryWithRetry(
      `
      SELECT trade_date::text, close
      FROM daily_index_ohlcv
      WHERE index_name = 'NIFTY 500'
        AND trade_date <= $1
      ORDER BY trade_date ASC;
      `,
      [asOf]
    );
    const benchmarkCandles = benchRes.rows.map((r) => ({
      trade_date: r.trade_date,
      close: Number(r.close),
    }));

    // If specific industry full RS series requested:
    if (indFilter) {
      const indCandlesRes = await queryWithRetry(
        `
        SELECT trade_date::text, ew_close as close
        FROM daily_industry_index
        WHERE basic_industry = $1 AND trade_date <= $2
        ORDER BY trade_date ASC;
        `,
        [indFilter, asOf]
      );
      const indCandles = indCandlesRes.rows.map((r) => ({
        trade_date: r.trade_date,
        close: Number(r.close),
      }));

      const alignedRS = computeAlignedRS(indCandles, benchmarkCandles);
      const fullSeries = computeRSSeries(alignedRS, 250);

      return NextResponse.json({
        industry: indFilter,
        asOf,
        benchmark: "NIFTY 500",
        rs_series: fullSeries,
      });
    }

    // 2. Fetch coverage stats
    const universeCountRes = await queryWithRetry(
      `
      SELECT total_stocks FROM daily_market_breadth
      WHERE trade_date = $1 AND universe = 'liquid';
      `,
      [breadthAsOf || asOf]
    );
    const n_universe = universeCountRes.rows[0]?.total_stocks
      ? Number(universeCountRes.rows[0].total_stocks)
      : 1700;

    // 3. Fetch 5 sessions ago date for rank_change calculation
    const datesRes = await queryWithRetry(
      `
      SELECT DISTINCT trade_date::text
      FROM daily_industry_breadth
      WHERE trade_date <= $1
      ORDER BY trade_date DESC
      LIMIT 6;
      `,
      [asOf]
    );
    const recentDates = datesRes.rows.map((r) => r.trade_date);
    const date5Ago = recentDates.length >= 6 ? recentDates[5] : null;

    let rank5Map = {};
    if (date5Ago) {
      const rank5Res = await queryWithRetry(
        `
        SELECT basic_industry, rank
        FROM daily_industry_breadth
        WHERE trade_date = $1 AND rank IS NOT NULL;
        `,
        [date5Ago]
      );
      for (const r of rank5Res.rows) {
        rank5Map[r.basic_industry] = Number(r.rank);
      }
    }

    // 4. Fetch daily_industry_breadth for asOf
    const breadthRes = await queryWithRetry(
      `
      SELECT
        sector, basic_industry, n_stocks, n_valid_50, n_valid_200,
        median_1d, median_1w, median_1m, median_3m, median_6m,
        pct_above_50, pct_above_200, n_20d_high, n_20d_low,
        pct_leaders, mcap_cr, rank
      FROM daily_industry_breadth
      WHERE trade_date = $1
      ORDER BY
        CASE WHEN rank IS NOT NULL THEN 0 ELSE 1 END,
        rank ASC,
        n_stocks DESC,
        basic_industry ASC;
      `,
      [asOf]
    );

    // 5. Fetch recent 120 sessions of daily_industry_index for all industries to compute RS sparklines & quadrants
    const idxCandlesRes = await queryWithRetry(
      `
      SELECT basic_industry, trade_date::text, ew_close as close
      FROM daily_industry_index
      WHERE trade_date >= (
        SELECT trade_date FROM (
          SELECT DISTINCT trade_date FROM daily_industry_index
          WHERE trade_date <= $1
          ORDER BY trade_date DESC
          LIMIT 120
        ) sub ORDER BY trade_date ASC LIMIT 1
      ) AND trade_date <= $1
      ORDER BY basic_industry, trade_date ASC;
      `,
      [asOf]
    );

    const candlesByIndustry = {};
    for (const r of idxCandlesRes.rows) {
      if (!candlesByIndustry[r.basic_industry]) {
        candlesByIndustry[r.basic_industry] = [];
      }
      candlesByIndustry[r.basic_industry].push({
        trade_date: r.trade_date,
        close: Number(r.close),
      });
    }

    const r2 = (v) => (v != null && !isNaN(v) && v !== "NaN" ? Math.round(Number(v) * 100) / 100 : null);
    const cleanStr = (s) => (s && s !== "NaN" ? String(s).trim() : null);

    // 6. Build industries array
    let n_small = 0;
    const industries = breadthRes.rows.map((row) => {
      const b_ind = row.basic_industry;
      const n_st = Number(row.n_stocks);
      if (n_st < 5) {
        n_small++;
      }

      const curRank = row.rank != null ? Number(row.rank) : null;
      const prevRank = rank5Map[b_ind];
      const rank_change = curRank != null && prevRank != null ? prevRank - curRank : null;

      // RS & Quadrant
      const indCandles = candlesByIndustry[b_ind] || [];
      const alignedRS = computeAlignedRS(indCandles, benchmarkCandles);
      const quad = computeQuadrant(alignedRS);
      const sparkline = computeRSSeries(alignedRS, 60).map((p) => p.value);

      // Tag formatting
      const tagLabels = {
        leading: "Leading",
        weakening: "Weakening",
        improving: "Improving",
        lagging: "Lagging",
      };
      const tag = tagLabels[quad.quadrant] || "Lagging";

      return {
        sector: row.sector,
        basic_industry: b_ind,
        n_stocks: n_st,
        n_valid_50: row.n_valid_50 != null ? Number(row.n_valid_50) : null,
        n_valid_200: row.n_valid_200 != null ? Number(row.n_valid_200) : null,
        median_1d: r2(row.median_1d),
        median_1w: r2(row.median_1w),
        median_1m: r2(row.median_1m),
        median_3m: r2(row.median_3m),
        median_6m: r2(row.median_6m),
        pct_above_50: r2(row.pct_above_50),
        pct_above_200: r2(row.pct_above_200),
        n_20d_high: Number(row.n_20d_high || 0),
        n_20d_low: Number(row.n_20d_low || 0),
        pct_leaders: r2(row.pct_leaders) || 0,
        mcap_cr: r2(row.mcap_cr),
        rank: curRank,
        rank_change,
        tag,
        quadrant: quad.quadrant,
        rs_x: r2(quad.rs_x),
        rs_y: r2(quad.rs_y),
        sparkline,
      };
    });

    // 7. Fetch liquid classified stocks from industry_stock_metrics
    const stocksRes = await queryWithRetry(`
      SELECT
        symbol, name, macro, sector, industry, basic_industry,
        close, ret_1d, ret_1w, ret_1m, ret_3m, ret_6m,
        pct_from_52w_high, above_20ema, above_50dma, above_200dma,
        stage, vol_ratio, avg_traded_value, rs_rank, screeners,
        mcap_cr, at_20d_high, at_20d_low
      FROM industry_stock_metrics
      WHERE in_universe = true
      ORDER BY mcap_cr DESC NULLS LAST, symbol ASC;
    `);

    const stocks = stocksRes.rows.map((r) => {
      const isLeader = isStockLeader({
        symbol: r.symbol,
        rs_rank: r.rs_rank != null ? Number(r.rs_rank) : null,
        above_50dma: r.above_50dma,
        close: r.close != null ? Number(r.close) : null,
      });

      const stockObj = {
        symbol: r.symbol,
        name: r.name,
        macro: cleanStr(r.macro) ?? undefined,
        sector: cleanStr(r.sector) ?? undefined,
        industry: cleanStr(r.industry) ?? undefined,
        basic_industry: cleanStr(r.basic_industry) ?? undefined,
        close: r2(r.close),
        ret_1d: r2(r.ret_1d),
        ret_1w: r2(r.ret_1w),
        ret_1m: r2(r.ret_1m),
        ret_3m: r2(r.ret_3m),
        ret_6m: r2(r.ret_6m) ?? undefined,
        pct_from_52w_high: r2(r.pct_from_52w_high) ?? undefined,
        above_20ema: r.above_20ema ?? undefined,
        above_50dma: r.above_50dma ?? undefined,
        above_200dma: r.above_200dma ?? undefined,
        stage: r.stage ?? undefined,
        vol_ratio: r2(r.vol_ratio) ?? undefined,
        avg_traded_value: r2(r.avg_traded_value) ?? undefined,
        rs_rank: r.rs_rank != null ? Math.round(Number(r.rs_rank)) : undefined,
        screeners: r.screeners && r.screeners.length ? r.screeners : undefined,
        mcap_cr: r2(r.mcap_cr),
        at_20d_high: r.at_20d_high ? true : undefined,
        at_20d_low: r.at_20d_low ? true : undefined,
        is_leader: isLeader ? true : undefined,
      };
      return stockObj;
    });

    // 8. Compute sectors directly from member stocks (I3 requirement)
    // "sectors[]: computed directly from member stocks (median returns, % above DMAs, n_stocks, mcap_cr), NOT as an average of industries"
    const stocksBySector = {};
    for (const s of stocks) {
      const sec = s.sector || "Unclassified";
      if (!stocksBySector[sec]) {
        stocksBySector[sec] = [];
      }
      stocksBySector[sec].push(s);
    }

    const calcMedian = (arr) => {
      const valid = arr.filter((x) => x != null && !isNaN(x)).sort((a, b) => a - b);
      if (!valid.length) return null;
      const mid = Math.floor(valid.length / 2);
      return valid.length % 2 !== 0 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
    };

    const sectors = Object.entries(stocksBySector).map(([secName, secStocks]) => {
      const n_st = secStocks.length;
      const m_1d = calcMedian(secStocks.map((s) => s.ret_1d));
      const m_1w = calcMedian(secStocks.map((s) => s.ret_1w));
      const m_1m = calcMedian(secStocks.map((s) => s.ret_1m));
      const m_3m = calcMedian(secStocks.map((s) => s.ret_3m));
      const m_6m = calcMedian(secStocks.map((s) => s.ret_6m));

      const valid50 = secStocks.filter((s) => s.above_50dma != null);
      const pct_50 = valid50.length > 0 ? (valid50.filter((s) => s.above_50dma).length / valid50.length) * 100 : null;

      const valid200 = secStocks.filter((s) => s.above_200dma != null);
      const pct_200 = valid200.length > 0 ? (valid200.filter((s) => s.above_200dma).length / valid200.length) * 100 : null;

      const mcapSum = secStocks.reduce((acc, s) => acc + (s.mcap_cr || 0), 0);

      return {
        name: secName,
        macro: secStocks[0]?.macro || "Other",
        n_stocks: n_st,
        mcap_cr: mcapSum > 0 ? Number(mcapSum.toFixed(2)) : null,
        median_1d: m_1d != null ? Number(m_1d.toFixed(2)) : null,
        median_1w: m_1w != null ? Number(m_1w.toFixed(2)) : null,
        median_1m: m_1m != null ? Number(m_1m.toFixed(2)) : null,
        median_3m: m_3m != null ? Number(m_3m.toFixed(2)) : null,
        median_6m: m_6m != null ? Number(m_6m.toFixed(2)) : null,
        pct_above_50: pct_50 != null ? Number(pct_50.toFixed(2)) : null,
        pct_above_200: pct_200 != null ? Number(pct_200.toFixed(2)) : null,
      };
    }).sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0));

    const n_classified = stocks.filter((s) => s.basic_industry != null).length;
    const n_unclassified = Math.max(0, n_universe - n_classified);

    const payload = {
      asOf,
      breadthAsOf,
      mcapAsOf,
      benchmark: "NIFTY 500",
      coverage: {
        n_universe,
        n_classified,
        n_unclassified,
        n_small_industries: n_small,
      },
      sectors,
      industries,
      stocks,
      leader_rules: LEADER_RULES,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=180",
      },
    });
  } catch (error) {
    console.error("Error in /api/terminal/industries:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
