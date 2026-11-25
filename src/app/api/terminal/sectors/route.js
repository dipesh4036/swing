// DEPRECATED: Tab 3 has migrated to Industry Rotation (/api/terminal/industries).
// This route is retained for backward compatibility and test stability. Removal scheduled in a future round.
import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  SECTORS,
  SECTOR_LEADER_RULES,
  isSectorLeader,
  computeStandardReturns,
  computeAlignedRS,
  computeQuadrant,
  computeRSSeries,
} from "@/lib/sector-math";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_SCREENER_KEYS = [
  "stage2_breakout",
  "vcp",
  "near_pivot",
  "ipo_base",
  "ema50_pullback",
];

export async function GET(request) {
  // Session authentication check
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Determine asOf date derived strictly from daily_sector_breadth max date (T6)
    const asOfRes = await queryWithRetry(`
      SELECT MAX(trade_date)::text as max_date FROM daily_sector_breadth;
    `);
    const asOf = asOfRes.rows[0]?.max_date || null;

    // Breadth tab latest date for staleness comparison
    const breadthAsOfRes = await queryWithRetry(`
      SELECT MAX(trade_date)::text as max_date FROM daily_market_breadth;
    `);
    const breadthAsOf = breadthAsOfRes.rows[0]?.max_date || null;

    if (!asOf) {
      return NextResponse.json(
        {
          asOf: null,
          breadthAsOf,
          benchmark: null,
          sectors: [],
          stocks: [],
          coverage: { n_mapped: 0, n_in_universe: 0, total_nifty500: null, uncovered: 0 },
          leader_rules: SECTOR_LEADER_RULES,
        },
        { headers: { "Cache-Control": "private, max-age=300" } }
      );
    }

    // 2. Fetch sector breadth rows for asOf date (including n_valid_200, T3)
    const breadthRes = await queryWithRetry(
      `
      SELECT
        sector, n_stocks, n_valid, n_valid_200,
        pct_above_50dma, pct_above_200dma, pct_above_20ema,
        advances, declines, new_52w_highs, new_52w_lows,
        ret_1w_ew, ret_1m_ew, ret_3m_ew, price_source
      FROM daily_sector_breadth
      WHERE trade_date = $1;
      `,
      [asOf]
    );

    const breadthBySector = {};
    for (const row of breadthRes.rows) {
      breadthBySector[row.sector] = {
        n_stocks: row.n_stocks,
        n_valid: row.n_valid,
        n_valid_200: row.n_valid_200 != null ? Number(row.n_valid_200) : null,
        pct_above_50dma: row.pct_above_50dma != null ? Number(row.pct_above_50dma) : null,
        pct_above_200dma: row.pct_above_200dma != null ? Number(row.pct_above_200dma) : null,
        pct_above_20ema: row.pct_above_20ema != null ? Number(row.pct_above_20ema) : null,
        advances: Number(row.advances || 0),
        declines: Number(row.declines || 0),
        new_52w_highs: Number(row.new_52w_highs || 0),
        new_52w_lows: Number(row.new_52w_lows || 0),
        ret_1w_ew: row.ret_1w_ew != null ? Number(row.ret_1w_ew) : null,
        ret_1m_ew: row.ret_1m_ew != null ? Number(row.ret_1m_ew) : null,
        ret_3m_ew: row.ret_3m_ew != null ? Number(row.ret_3m_ew) : null,
        price_source: row.price_source || "official",
      };
    }

    // 3. Fetch screener hits per sector on latest screener trade date
    const screenerHitsRes = await queryWithRetry(`
      SELECT ss.sector, sr.screener, COUNT(*)::int as count
      FROM daily_screener_results sr
      JOIN stock_sector ss ON sr.symbol = ss.symbol
      WHERE sr.trade_date = (SELECT MAX(trade_date) FROM daily_screener_results)
      GROUP BY ss.sector, sr.screener;
    `);

    const screenerHitsBySector = {};
    for (const row of screenerHitsRes.rows) {
      if (!screenerHitsBySector[row.sector]) {
        screenerHitsBySector[row.sector] = {
          stage2_breakout: 0,
          vcp: 0,
          near_pivot: 0,
          ipo_base: 0,
          ema50_pullback: 0,
          total: 0,
        };
      }
      if (VALID_SCREENER_KEYS.includes(row.screener)) {
        screenerHitsBySector[row.sector][row.screener] = row.count;
        screenerHitsBySector[row.sector].total += row.count;
      }
    }

    // 4. Fetch daily OHLCV closes for NIFTY 500 and all sector indices up to asOf date
    const indexNames = ["NIFTY 500", ...SECTORS.map((s) => s.index_name)];
    const indexRes = await queryWithRetry(
      `
      SELECT index_name, trade_date::text as trade_date, close::numeric as close
      FROM daily_index_ohlcv
      WHERE index_name = ANY($1::varchar[]) AND trade_date <= $2
      ORDER BY trade_date ASC;
      `,
      [indexNames, asOf]
    );

    const indexHistory = {};
    for (const name of indexNames) {
      indexHistory[name] = [];
    }
    for (const r of indexRes.rows) {
      if (indexHistory[r.index_name]) {
        indexHistory[r.index_name].push({
          trade_date: r.trade_date,
          close: Number(r.close),
        });
      }
    }

    // Benchmark returns (NIFTY 500)
    const n500Candles = indexHistory["NIFTY 500"] || [];
    const n500LastDate = n500Candles.length > 0 ? n500Candles[n500Candles.length - 1].trade_date : null;
    const n500IsCurrent = n500LastDate === asOf;
    const n500Returns = n500IsCurrent ? computeStandardReturns(n500Candles) : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null };

    // 5. Construct sector data cards and metrics (with common-date alignment checks, T6)
    const sectorList = [];

    for (const s of SECTORS) {
      const candles = indexHistory[s.index_name] || [];
      const sectorLastDate = candles.length > 0 ? candles[candles.length - 1].trade_date : null;
      const isStale = !n500IsCurrent || sectorLastDate !== asOf;

      const returns = !isStale
        ? computeStandardReturns(candles)
        : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null };

      const bInfo = breadthBySector[s.key] || {
        n_stocks: 0,
        n_valid: 0,
        n_valid_200: null,
        pct_above_50dma: null,
        pct_above_200dma: null,
        pct_above_20ema: null,
        advances: 0,
        declines: 0,
        new_52w_highs: 0,
        new_52w_lows: 0,
        ret_1w_ew: null,
        ret_1m_ew: null,
        ret_3m_ew: null,
        price_source: s.price_source || "official",
      };

      // Relative Strength vs NIFTY 500
      const rs_1m =
        !isStale && returns.ret_1m != null && n500Returns.ret_1m != null
          ? Number((returns.ret_1m - n500Returns.ret_1m).toFixed(2))
          : null;

      const rs_3m =
        !isStale && returns.ret_3m != null && n500Returns.ret_3m != null
          ? Number((returns.ret_3m - n500Returns.ret_3m).toFixed(2))
          : null;

      // Aligned RS for Quadrant and RS Series
      const alignedRS = !isStale ? computeAlignedRS(candles, n500Candles) : [];
      const { quadrant, x, y } = computeQuadrant(alignedRS);
      const rsSeries = computeRSSeries(alignedRS, 120);

      const sHits = screenerHitsBySector[s.key] || {
        stage2_breakout: 0,
        vcp: 0,
        near_pivot: 0,
        ipo_base: 0,
        ema50_pullback: 0,
        total: 0,
      };

      sectorList.push({
        key: s.key,
        label: s.label,
        short: s.short || s.label,
        index_name: s.index_name,
        group_type: s.group_type || "index",
        price_source: bInfo.price_source,
        n_mapped: bInfo.n_stocks,
        n_valid: bInfo.n_valid,
        n_valid_200: bInfo.n_valid_200,
        stale: isStale,
        index_asOf: sectorLastDate,
        insufficient_data: bInfo.n_valid < 8,
        // Breadth indicators
        pct_above_50dma: bInfo.pct_above_50dma,
        pct_above_200dma: bInfo.pct_above_200dma,
        pct_above_20ema: bInfo.pct_above_20ema,
        advances: bInfo.advances,
        declines: bInfo.declines,
        new_52w_highs: bInfo.new_52w_highs,
        new_52w_lows: bInfo.new_52w_lows,
        // Absolute Returns
        ret_1w: returns.ret_1w,
        ret_1m: returns.ret_1m,
        ret_3m: returns.ret_3m,
        ret_6m: returns.ret_6m,
        // RS vs NIFTY 500
        rs_1m,
        rs_3m,
        // Quadrant
        quadrant,
        x,
        y,
        // Chart Series
        rs_series: rsSeries,
        screener_hits: sHits,
      });
    }

    // 6. Rank server-side by 1M RS descending (insufficient / nulls last)
    sectorList.sort((a, b) => {
      if (a.insufficient_data && !b.insufficient_data) return 1;
      if (!a.insufficient_data && b.insufficient_data) return -1;
      if (a.rs_1m == null && b.rs_1m == null) return 0;
      if (a.rs_1m == null) return 1;
      if (b.rs_1m == null) return -1;
      return b.rs_1m - a.rs_1m;
    });

    sectorList.forEach((s, idx) => {
      s.rank = idx + 1;
    });

    // 7. Fetch per-stock sector metrics from sector_stock_metrics (T8, T9)
    const stocksRes = await queryWithRetry(`
      SELECT
        trade_date::text as trade_date, token, symbol, name, sector, in_universe,
        close::numeric as close,
        ret_1d::numeric as ret_1d,
        ret_1w::numeric as ret_1w,
        ret_1m::numeric as ret_1m,
        ret_3m::numeric as ret_3m,
        ret_6m::numeric as ret_6m,
        pct_from_52w_high::numeric as pct_from_52w_high,
        above_20ema, above_50dma, above_200dma,
        stage, vol_ratio::numeric as vol_ratio,
        avg_traded_value::numeric as avg_traded_value,
        rs_rank, screeners
      FROM sector_stock_metrics
      ORDER BY rs_rank DESC NULLS LAST;
    `);

    const rawStocks = stocksRes.rows.map((r) => ({
      token: Number(r.token),
      symbol: r.symbol,
      name: r.name || r.symbol,
      sector: r.sector,
      in_universe: Boolean(r.in_universe),
      close: r.close != null ? Number(r.close) : null,
      ret_1d: r.ret_1d != null ? Number(r.ret_1d) : null,
      ret_1w: r.ret_1w != null ? Number(r.ret_1w) : null,
      ret_1m: r.ret_1m != null ? Number(r.ret_1m) : null,
      ret_3m: r.ret_3m != null ? Number(r.ret_3m) : null,
      ret_6m: r.ret_6m != null ? Number(r.ret_6m) : null,
      pct_from_52w_high: r.pct_from_52w_high != null ? Number(r.pct_from_52w_high) : null,
      above_20ema: r.above_20ema,
      above_50dma: r.above_50dma,
      above_200dma: r.above_200dma,
      stage: r.stage,
      vol_ratio: r.vol_ratio != null ? Number(r.vol_ratio) : null,
      avg_traded_value: r.avg_traded_value != null ? Number(r.avg_traded_value) : null,
      rs_rank: r.rs_rank,
      screeners: r.screeners || [],
      trade_date: r.trade_date,
    }));

    // Compute leader boolean and per-sector ranks (T9.1)
    const stocksBySector = {};
    for (const st of rawStocks) {
      st.leader = isSectorLeader(st, SECTOR_LEADER_RULES);
      if (!stocksBySector[st.sector]) {
        stocksBySector[st.sector] = [];
      }
      stocksBySector[st.sector].push(st);
    }

    // Assign sector_rank_1m and sector_rank_3m among in_universe stocks only
    for (const secKey of Object.keys(stocksBySector)) {
      const secStocks = stocksBySector[secKey];
      const univStocks = secStocks.filter((s) => s.in_universe);

      // Rank 1M
      const sorted1m = [...univStocks].sort((a, b) => (b.ret_1m ?? -999) - (a.ret_1m ?? -999));
      sorted1m.forEach((s, idx) => {
        s.sector_rank_1m = s.ret_1m != null ? idx + 1 : null;
      });

      // Rank 3M
      const sorted3m = [...univStocks].sort((a, b) => (b.ret_3m ?? -999) - (a.ret_3m ?? -999));
      sorted3m.forEach((s, idx) => {
        s.sector_rank_3m = s.ret_3m != null ? idx + 1 : null;
      });
    }

    // Attach leader counts to sectorList
    sectorList.forEach((sec) => {
      const secStocks = stocksBySector[sec.key] || [];
      sec.n_in_universe = secStocks.filter((s) => s.in_universe).length;
      sec.leaders_count = secStocks.filter((s) => s.leader).length;
    });

    // Coverage stats (T7.2, U4: dynamically computed, no hardcoded totals)
    const coverageRes = await queryWithRetry(`
      SELECT
        COUNT(DISTINCT symbol)::int as n_mapped,
        COUNT(DISTINCT CASE WHEN mapped_via = 'index' THEN symbol END)::int as n_index,
        COUNT(DISTINCT CASE WHEN mapped_via IN ('industry', 'industry_name_rule') THEN symbol END)::int as n_industry,
        (SELECT COUNT(DISTINCT symbol)::int FROM index_constituents WHERE index_name = 'nifty500' AND is_active = TRUE) as total_nifty500,
        (SELECT COUNT(DISTINCT s.symbol)::int FROM stock_sector s JOIN index_constituents c ON s.symbol = c.symbol WHERE c.index_name = 'nifty500' AND c.is_active = TRUE) as n_mapped_nifty500
      FROM stock_sector;
    `);
    const cov = coverageRes.rows[0] || {};
    const nInUnivTotal = rawStocks.filter((s) => s.in_universe).length;
    const totalN500 = cov.total_nifty500 != null ? Number(cov.total_nifty500) : null;
    const nMappedN500 = cov.n_mapped_nifty500 != null ? Number(cov.n_mapped_nifty500) : null;
    const uncovered = totalN500 != null && nMappedN500 != null ? Math.max(0, totalN500 - nMappedN500) : 0;

    const coverage = {
      n_mapped: Number(cov.n_mapped || rawStocks.length),
      n_index: Number(cov.n_index || 0),
      n_industry: Number(cov.n_industry || 0),
      n_in_universe: nInUnivTotal,
      total_nifty500: totalN500,
      n_mapped_nifty500: nMappedN500,
      uncovered,
    };

    return NextResponse.json(
      {
        asOf,
        breadthAsOf,
        stocks_as_of: rawStocks[0]?.trade_date || asOf,
        benchmark: {
          name: "NIFTY 500",
          ...n500Returns,
        },
        sectors: sectorList,
        stocks: rawStocks,
        coverage,
        leader_rules: SECTOR_LEADER_RULES,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      }
    );
  } catch (error) {
    console.error("Failed to fetch sector rotation data:", error);
    return NextResponse.json(
      { error: "Internal Server Error fetching sector rotation data" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
