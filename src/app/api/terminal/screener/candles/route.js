import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { attachEMAs, sliceLast } from "@/lib/indicators";

export const maxDuration = 30;

const GRID_MAX_BARS = 150;

const VALID_SCREENERS = [
  "stage2_breakout",
  "vcp",
  "near_pivot",
  "ipo_base",
  "ema50_pullback",
];

export async function GET(request) {
  // 1. Verify session token
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const screener = searchParams.get("screener") || "stage2_breakout";

    if (!VALID_SCREENERS.includes(screener)) {
      return NextResponse.json(
        { error: `Invalid screener '${screener}'. Allowed: ${VALID_SCREENERS.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 2. Query latest trade date from daily_screener_results
    const dateRes = await queryWithRetry(
      "SELECT MAX(trade_date)::text as max_date FROM daily_screener_results;"
    );
    const asOfStr = dateRes.rows[0]?.max_date;
    if (!asOfStr) {
      return NextResponse.json(
        { asOf: null, screener, candles: {}, staleTokens: [] },
        { headers: { "Cache-Control": "private, max-age=300" } }
      );
    }

    // 3. Query distinct passing tokens for this screener on the latest trade date
    const tokensRes = await queryWithRetry(
      `SELECT DISTINCT token
       FROM daily_screener_results
       WHERE trade_date = $1 AND screener = $2;`,
      [asOfStr, screener]
    );

    const tokens = tokensRes.rows.map((r) => r.token);
    if (tokens.length === 0) {
      return NextResponse.json(
        { asOf: asOfStr, screener, candles: {}, staleTokens: [] },
        { headers: { "Cache-Control": "private, max-age=300" } }
      );
    }

    // 4. Fetch daily OHLCV candles strictly from screener_candles table in Neon DB
    // Drop sma_50, sma_150, sma_200 to optimize payload size (R25)
    const candlesRes = await queryWithRetry(
      `SELECT token, trade_date::text as trade_date, open, high, low, close, volume
       FROM screener_candles
       WHERE token = ANY($1::int[])
       ORDER BY token, trade_date ASC;`,
      [tokens]
    );

    const candlesByToken = {};
    for (const t of tokens) {
      candlesByToken[t] = [];
    }

    for (const r of candlesRes.rows) {
      const dateVal = typeof r.trade_date === "string"
        ? r.trade_date.split("T")[0]
        : r.trade_date.toISOString().split("T")[0];

      candlesByToken[r.token].push({
        date: dateVal,
        open: r.open !== null ? Number(r.open) : null,
        high: r.high !== null ? Number(r.high) : null,
        low: r.low !== null ? Number(r.low) : null,
        close: Number(r.close),
        volume: r.volume !== null ? Number(r.volume) : null,
      });
    }

    // 5. Attach EMAs (10, 20, 50, 200) on full history, then slice to GRID_MAX_BARS (R25)
    const processedCandles = {};
    const staleTokens = [];

    for (const t of tokens) {
      const raw = candlesByToken[t] || [];
      if (raw.length > 0) {
        // Staleness guard: if token's last candle date is earlier than asOfStr
        const lastCandle = raw[raw.length - 1];
        if (lastCandle && lastCandle.date < asOfStr) {
          staleTokens.push(t);
        }

        const withEMAs = attachEMAs(raw, [10, 20, 50, 200]);
        processedCandles[t] = sliceLast(withEMAs, GRID_MAX_BARS);
      } else {
        processedCandles[t] = [];
        staleTokens.push(t);
      }
    }

    return NextResponse.json(
      { asOf: asOfStr, screener, candles: processedCandles, staleTokens },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    console.error("Error in /api/terminal/screener/candles:", error);
    return NextResponse.json(
      { error: "Internal server error fetching screener candles from database" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
