import { NextResponse } from "next/server";
import { queryWithRetry } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { resolveScreenerSectorParam } from "@/lib/screener-sector-adapter";

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
    const rawSector = searchParams.get("sector") || "all";
    const groupId = searchParams.get("groupId")?.trim() || null;

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

    let filterClause = null;
    let filterParams = [];

    if (groupId) {
      const grpRes = await queryWithRetry(
        `SELECT level, macro_label, sector_label, industry_label, basic_industry_label, label
         FROM industry_groups WHERE group_id = $1;`,
        [groupId]
      );
      const g = grpRes.rows[0];
      if (!g) {
        return NextResponse.json(
          { error: `Unknown industry groupId '${groupId}'.` },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      if (g.level === "macro") {
        filterClause = "inst.macro_sector = $PARAM";
        filterParams = [g.macro_label];
      } else if (g.level === "sector") {
        filterClause = "inst.macro_sector = $PARAM AND inst.sector = $PARAM2";
        filterParams = [g.macro_label, g.sector_label];
      } else if (g.level === "industry") {
        filterClause = "inst.macro_sector = $PARAM AND inst.sector = $PARAM2 AND inst.industry = $PARAM3";
        filterParams = [g.macro_label, g.sector_label, g.industry_label];
      } else {
        filterClause = "inst.macro_sector = $PARAM AND inst.sector = $PARAM2 AND inst.industry = $PARAM3 AND inst.basic_industry = $PARAM4";
        filterParams = [g.macro_label, g.sector_label, g.industry_label, g.basic_industry_label];
      }
    } else if (rawSector && rawSector.toLowerCase() !== "all") {
      const resolved = resolveScreenerSectorParam(rawSector);
      if (resolved.mode === "unsupported") {
        return NextResponse.json(
          { error: resolved.message, unsupportedFilter: true },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      if (resolved.mode === "mapped") {
        const colMap = {
          macro: "inst.macro_sector",
          sector: "inst.sector",
          industry: "inst.industry",
          basic_industry: "inst.basic_industry",
        };
        const col = colMap[resolved.type] || "inst.sector";
        filterClause = `${col} = $PARAM`;
        filterParams = [resolved.value];
      }
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
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    // 2. Fetch latest market regime for Nifty 500
    const regimeRes = await queryWithRetry(
      "SELECT regime FROM daily_market_breadth WHERE universe = 'nifty500' ORDER BY trade_date DESC LIMIT 1;"
    );
    const latestRegime = regimeRes.rows[0]?.regime || null;

    // 3. Fetch screener counts for the as-of date (filtered by universe and classification)
    let countsQuery = `
      SELECT sr.screener, COUNT(*)::int as count
      FROM daily_screener_results sr
      LEFT JOIN instruments inst ON sr.token = inst.token
      WHERE sr.trade_date = $1
    `;
    const countsParams = [asOfStr];
    let pIdx = 2;

    if (universe === "nifty500") {
      countsQuery += " AND sr.in_nifty500 = TRUE";
    }
    if (filterClause) {
      let bound = filterClause;
      for (const val of filterParams) {
        if (bound.includes("$PARAM4")) bound = bound.replace("$PARAM4", `$${pIdx}`);
        else if (bound.includes("$PARAM3")) bound = bound.replace("$PARAM3", `$${pIdx}`);
        else if (bound.includes("$PARAM2")) bound = bound.replace("$PARAM2", `$${pIdx}`);
        else bound = bound.replace("$PARAM", `$${pIdx}`);
        countsParams.push(val);
        pIdx++;
      }
      countsQuery += ` AND (${bound})`;
    }
    countsQuery += " GROUP BY sr.screener;";

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
        sr.trade_date, sr.screener, sr.token, sr.symbol, sr.close, sr.ret_1d_pct, sr.vol_ratio,
        sr.pct_from_52w_high, sr.pivot, sr.dist_to_pivot_pct, sr.rs_rank, sr.stage, sr.in_nifty500, sr.extra,
        inst.sector, inst.industry
      FROM daily_screener_results sr
      LEFT JOIN instruments inst ON sr.token = inst.token
      WHERE sr.trade_date = $1 AND sr.screener = $2
    `;
    const rowsParams = [asOfStr, screener];
    let rowPIdx = 3;

    if (universe === "nifty500") {
      rowsQuery += " AND sr.in_nifty500 = TRUE";
    }
    if (filterClause) {
      let bound = filterClause;
      for (const val of filterParams) {
        if (bound.includes("$PARAM4")) bound = bound.replace("$PARAM4", `$${rowPIdx}`);
        else if (bound.includes("$PARAM3")) bound = bound.replace("$PARAM3", `$${rowPIdx}`);
        else if (bound.includes("$PARAM2")) bound = bound.replace("$PARAM2", `$${rowPIdx}`);
        else bound = bound.replace("$PARAM", `$${rowPIdx}`);
        rowsParams.push(val);
        rowPIdx++;
      }
      rowsQuery += ` AND (${bound})`;
    }

    // Ordering rules per spec:
    if (screener === "stage2_breakout") {
      rowsQuery += " ORDER BY sr.vol_ratio DESC NULLS LAST, sr.symbol ASC;";
    } else if (screener === "vcp") {
      rowsQuery += " ORDER BY (sr.extra->>'sort_key')::numeric ASC NULLS LAST, sr.symbol ASC;";
    } else if (screener === "near_pivot") {
      rowsQuery += " ORDER BY sr.dist_to_pivot_pct ASC NULLS LAST, sr.symbol ASC;";
    } else if (screener === "ipo_base") {
      rowsQuery += " ORDER BY sr.dist_to_pivot_pct ASC NULLS LAST, sr.symbol ASC;";
    } else if (screener === "ema50_pullback") {
      rowsQuery += " ORDER BY sr.rs_rank DESC NULLS LAST, sr.symbol ASC;";
    } else {
      rowsQuery += " ORDER BY sr.symbol ASC;";
    }

    const rowsRes = await queryWithRetry(rowsQuery, rowsParams);

    const formattedRows = rowsRes.rows.map((row) => ({
      trade_date: typeof row.trade_date === "string" ? row.trade_date.split("T")[0] : row.trade_date.toISOString().split("T")[0],
      screener: row.screener,
      token: row.token,
      symbol: row.symbol,
      sector: row.sector || null,
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
          "Cache-Control": "private, max-age=300",
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
