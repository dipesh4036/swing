import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

const VALID_SCREENERS = [
  "stage2_breakout",
  "vcp",
  "near_pivot",
  "ipo_base",
  "ema50_pullback",
];

const VALID_UNIVERSES = ["all", "nifty500"];

export async function GET(request) {
  // Defence in depth: Verify session token
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const screener = searchParams.get("screener") || "stage2_breakout";
    const universe = (searchParams.get("universe") || "all").toLowerCase();

    if (!VALID_SCREENERS.includes(screener)) {
      return NextResponse.json(
        { error: `Invalid screener '${screener}'. Allowed: ${VALID_SCREENERS.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!VALID_UNIVERSES.includes(universe)) {
      return NextResponse.json(
        { error: `Invalid universe '${universe}'. Allowed: ${VALID_UNIVERSES.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 1. Get latest trade date from daily_screener_results
    const dateRes = await queryWithRetry(
      "SELECT MAX(trade_date)::text as max_date FROM daily_screener_results;"
    );
    const asOfStr = dateRes.rows[0]?.max_date;

    const zeroCounts = {
      stage2_breakout: 0,
      vcp: 0,
      near_pivot: 0,
      ipo_base: 0,
      ema50_pullback: 0,
    };

    if (!asOfStr) {
      return NextResponse.json({
        asOf: null,
        regime: null,
        counts: zeroCounts,
        rows: [],
      }, {
        headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
      });
    }

    // 2. Fetch latest market regime for Nifty 500
    const regimeRes = await queryWithRetry(
      "SELECT regime FROM daily_market_breadth WHERE universe = 'nifty500' ORDER BY trade_date DESC LIMIT 1;"
    );
    const latestRegime = regimeRes.rows[0]?.regime || null;

    // 3. Fetch screener counts for the as-of date (filtered by universe if nifty500)
    let countsQuery = `
      SELECT screener, COUNT(*)::int as count
      FROM daily_screener_results
      WHERE trade_date = $1
    `;
    const countsParams = [asOfStr];
    if (universe === "nifty500") {
      countsQuery += " AND in_nifty500 = TRUE";
    }
    countsQuery += " GROUP BY screener;";

    const countsRes = await queryWithRetry(countsQuery, countsParams);
    const counts = { ...zeroCounts };
    for (const r of countsRes.rows) {
      if (counts[r.screener] !== undefined) {
        counts[r.screener] = r.count;
      }
    }

    // 4. Fetch rows for the active screener
    let rowsQuery = `
      SELECT
        trade_date, screener, token, symbol, close, ret_1d_pct, vol_ratio,
        pct_from_52w_high, pivot, dist_to_pivot_pct, rs_rank, stage, in_nifty500, extra
      FROM daily_screener_results
      WHERE trade_date = $1 AND screener = $2
    `;
    const rowsParams = [asOfStr, screener];
    if (universe === "nifty500") {
      rowsQuery += " AND in_nifty500 = TRUE";
    }

    // Ordering rules per spec:
    if (screener === "stage2_breakout") {
      rowsQuery += " ORDER BY vol_ratio DESC NULLS LAST, symbol ASC;";
    } else if (screener === "vcp") {
      rowsQuery += " ORDER BY (extra->>'sort_key')::numeric ASC NULLS LAST, symbol ASC;";
    } else if (screener === "near_pivot") {
      rowsQuery += " ORDER BY dist_to_pivot_pct ASC NULLS LAST, symbol ASC;";
    } else if (screener === "ipo_base") {
      rowsQuery += " ORDER BY dist_to_pivot_pct ASC NULLS LAST, symbol ASC;";
    } else if (screener === "ema50_pullback") {
      rowsQuery += " ORDER BY rs_rank DESC NULLS LAST, symbol ASC;";
    } else {
      rowsQuery += " ORDER BY symbol ASC;";
    }

    const rowsRes = await queryWithRetry(rowsQuery, rowsParams);

    const formattedRows = rowsRes.rows.map((row) => ({
      trade_date: typeof row.trade_date === "string" ? row.trade_date.split("T")[0] : row.trade_date.toISOString().split("T")[0],
      screener: row.screener,
      token: row.token,
      symbol: row.symbol,
      close: row.close !== null ? Number(row.close) : null,
      ret_1d_pct: row.ret_1d_pct !== null ? Number(row.ret_1d_pct) : null,
      vol_ratio: row.vol_ratio !== null ? Number(row.vol_ratio) : null,
      pct_from_52w_high: row.pct_from_52w_high !== null ? Number(row.pct_from_52w_high) : null,
      pivot: row.pivot !== null ? Number(row.pivot) : null,
      dist_to_pivot_pct: row.dist_to_pivot_pct !== null ? Number(row.dist_to_pivot_pct) : null,
      rs_rank: row.rs_rank !== null ? Number(row.rs_rank) : null,
      stage: row.stage !== null ? Number(row.stage) : null,
      in_nifty500: Boolean(row.in_nifty500),
      extra: row.extra || null,
    }));

    return NextResponse.json(
      {
        asOf: asOfStr,
        regime: latestRegime,
        counts,
        rows: formattedRows,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
        },
      }
    );
  } catch (err) {
    console.error("API /api/terminal/screener error:", err);
    return NextResponse.json(
      { error: "Internal server error fetching screener data" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
