import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { fetchAllCandlesFromSmartAPI } from "@/lib/smartapi";
import { requireAuth } from "@/lib/auth";
import { attachEMAs } from "@/lib/indicators";

const VALID_SCREENERS = [
  "stage2_breakout",
  "vcp",
  "near_pivot",
  "ipo_base",
  "ema50_pullback",
];

export async function GET(request) {
  // 1. Defence in depth: Verify session token
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const tokenParam = searchParams.get("token");
    const screener = searchParams.get("screener");

    const token = parseInt(tokenParam, 10);
    if (!tokenParam || isNaN(token) || token <= 0) {
      return NextResponse.json(
        { error: "Invalid or missing token parameter. Must be a positive integer." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!screener || !VALID_SCREENERS.includes(screener)) {
      return NextResponse.json(
        { error: `Invalid screener '${screener}'. Allowed: ${VALID_SCREENERS.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 2. Fetch latest screener row for this token & screener to get metadata and overlay
    // Serve only tokens that exist in the latest daily_screener_results (404 otherwise)
    const stockRes = await queryWithRetry(
      `SELECT symbol, trade_date::text as trade_date, rs_rank, vol_ratio, extra
       FROM daily_screener_results
       WHERE token = $1 AND screener = $2
       ORDER BY trade_date DESC
       LIMIT 1;`,
      [token, screener]
    );

    if (stockRes.rows.length === 0) {
      return NextResponse.json(
        { error: `Stock with token ${token} not found in '${screener}' results today.` },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const stockRow = stockRes.rows[0];
    const asOfStr = String(stockRow.trade_date);

    // 3. Attempt to fetch all historical candles live from Angel One SmartAPI (5 years, 3h cache)
    let rawCandles = await fetchAllCandlesFromSmartAPI(token);
    let source = "angel";

    // Fallback: if Angel fails or env vars are missing, use screener_candles from Neon
    if (!rawCandles || rawCandles.length === 0) {
      source = "db";
      const candlesRes = await queryWithRetry(
        `SELECT trade_date::text as trade_date, open, high, low, close, volume
         FROM screener_candles
         WHERE token = $1
         ORDER BY trade_date ASC;`,
        [token]
      );

      rawCandles = candlesRes.rows.map((r) => ({
        date: typeof r.trade_date === "string" ? r.trade_date.split("T")[0] : r.trade_date.toISOString().split("T")[0],
        open: r.open !== null ? Number(r.open) : null,
        high: r.high !== null ? Number(r.high) : null,
        low: r.low !== null ? Number(r.low) : null,
        close: Number(r.close),
        volume: r.volume !== null ? Number(r.volume) : null,
      }));
    }

    // 4. Attach EMAs (10, 20, 50, 200) using shared indicators helper
    const candles = attachEMAs(rawCandles, [10, 20, 50, 200]);

    // 5. Compute 1M & 3M returns and 20-session average volume from candles
    const n = candles.length;
    let ret1m = null;
    let ret3m = null;
    let avgVol20 = null;

    if (n >= 22) {
      const currClose = candles[n - 1].close;
      const prior21Close = candles[n - 22].close;
      if (prior21Close > 0) {
        ret1m = Math.round(((currClose - prior21Close) / prior21Close) * 10000) / 100;
      }
    }

    if (n >= 64) {
      const currClose = candles[n - 1].close;
      const prior63Close = candles[n - 64].close;
      if (prior63Close > 0) {
        ret3m = Math.round(((currClose - prior63Close) / prior63Close) * 10000) / 100;
      }
    }

    if (n >= 20) {
      const last20 = candles.slice(-20);
      const sumVol = last20.reduce((acc, c) => acc + (c.volume || 0), 0);
      avgVol20 = Math.round(sumVol / 20);
    } else if (n > 0) {
      const sumVol = candles.reduce((acc, c) => acc + (c.volume || 0), 0);
      avgVol20 = Math.round(sumVol / n);
    }

    const overlay = stockRow.extra?.overlay || null;

    return NextResponse.json(
      {
        symbol: stockRow.symbol,
        asOf: asOfStr,
        source,
        candles,
        overlay,
        rs_rank: stockRow.rs_rank !== null ? Number(stockRow.rs_rank) : null,
        ret_1m_pct: ret1m,
        ret_3m_pct: ret3m,
        vol_ratio: stockRow.vol_ratio !== null ? Number(stockRow.vol_ratio) : null,
        avg_vol_20: avgVol20,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=3600",
        },
      }
    );
  } catch (err) {
    console.error("API /api/terminal/screener/chart error:", err);
    return NextResponse.json(
      { error: "Internal server error fetching chart candle data" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
