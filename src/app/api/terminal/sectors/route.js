import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  SECTORS,
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
    // 1. Determine asOf date (latest common date present in daily_sector_breadth and daily_index_ohlcv)
    const asOfRes = await queryWithRetry(`
      SELECT MAX(b.trade_date)::text as max_date
      FROM daily_sector_breadth b
      WHERE EXISTS (
        SELECT 1 FROM daily_index_ohlcv i
        WHERE i.trade_date = b.trade_date AND i.index_name = 'NIFTY BANK'
      );
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
        },
        { headers: { "Cache-Control": "private, max-age=300" } }
      );
    }

    // 2. Fetch sector breadth rows for asOf date
    const breadthRes = await queryWithRetry(
      `
      SELECT
        sector, n_stocks, n_valid, pct_above_50dma, pct_above_200dma, pct_above_20ema,
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
    const n500Returns = computeStandardReturns(n500Candles);

    // 5. Construct sector data cards and metrics
    const sectorList = [];

    for (const s of SECTORS) {
      const candles = indexHistory[s.index_name] || [];
      const returns = computeStandardReturns(candles);
      const bInfo = breadthBySector[s.key] || {
        n_stocks: 0,
        n_valid: 0,
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
        price_source: "official",
      };

      // Relative Strength vs NIFTY 500
      const rs_1m =
        returns.ret_1m != null && n500Returns.ret_1m != null
          ? Number((returns.ret_1m - n500Returns.ret_1m).toFixed(2))
          : null;

      const rs_3m =
        returns.ret_3m != null && n500Returns.ret_3m != null
          ? Number((returns.ret_3m - n500Returns.ret_3m).toFixed(2))
          : null;

      // Aligned RS for Quadrant and RS Series
      const alignedRS = computeAlignedRS(candles, n500Candles);
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
        index_name: s.index_name,
        price_source: bInfo.price_source,
        n_stocks: bInfo.n_stocks,
        n_valid: bInfo.n_valid,
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

    // 6. Rank server-side by 1M RS descending (nulls last)
    sectorList.sort((a, b) => {
      if (a.rs_1m == null && b.rs_1m == null) return 0;
      if (a.rs_1m == null) return 1;
      if (b.rs_1m == null) return -1;
      return b.rs_1m - a.rs_1m;
    });

    sectorList.forEach((s, idx) => {
      s.rank = idx + 1;
    });

    return NextResponse.json(
      {
        asOf,
        breadthAsOf,
        benchmark: {
          name: "NIFTY 500",
          ...n500Returns,
        },
        sectors: sectorList,
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
