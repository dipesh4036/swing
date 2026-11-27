import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { parseSearchQuery, searchLiquidStocks } from "@/lib/stock-search";

export async function GET(request) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawQ = searchParams.get("q");
    const parsed = parseSearchQuery(rawQ);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid query parameter 'q'. Must be 1-30 characters." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const results = await searchLiquidStocks(parsed);
    return NextResponse.json(
      { query: parsed, results },
      { status: 200, headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error("Error in GET /api/stock-search:", err);
    return NextResponse.json(
      { error: "Failed to search stocks" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
