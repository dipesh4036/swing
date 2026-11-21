import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getTapetideFundamentals } from "@/lib/tapetide";

export const maxDuration = 15;

export async function GET(request) {
  // 1. Require authentication
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let requestedSymbol = "";
  try {
    // 2. Validate symbol parameter
    const { searchParams } = new URL(request.url);
    const rawSymbol = searchParams.get("symbol");
    requestedSymbol = rawSymbol ? rawSymbol.trim().toUpperCase() : "";

    if (!rawSymbol) {
      return NextResponse.json(
        { error: "Missing symbol parameter" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const symbol = requestedSymbol;
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) {
      return NextResponse.json(
        { error: "Invalid symbol parameter. Must match ^[A-Z0-9&-]{1,20}$." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Defence in depth: symbol must exist in latest daily_screener_results (any screener)
    const existsRes = await queryWithRetry(
      `SELECT 1 FROM daily_screener_results
       WHERE symbol = $1 AND trade_date = (SELECT MAX(trade_date) FROM daily_screener_results)
       LIMIT 1;`,
      [symbol]
    );

    if (existsRes.rows.length === 0) {
      return NextResponse.json(
        { error: `Symbol '${symbol}' not found in latest screener results.` },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3. Fetch fundamentals via secured helper (handles caching, single-flight, rate-limiting)
    const result = await getTapetideFundamentals(symbol);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": result?.available === true ? "private, max-age=3600" : "no-store",
      },
    });
  } catch (err) {
    console.error("Tapetide fundamentals route error:", err?.message || err);
    return NextResponse.json(
      {
        available: false,
        reason: "upstream_error",
        source_url: `https://tapetide.com/stocks/${encodeURIComponent(requestedSymbol)}`,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
