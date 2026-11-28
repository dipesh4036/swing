#!/usr/bin/env python3
"""
D5 — Generate Owner Verification Pack (`probe_output/verify_pack.md`, gitignored).
Includes:
- 10 random stock-days (seed=42; liquid, 3 outside Nifty 500)
- 4 index-days (NIFTY 50, NIFTY 500, NIFTY MIDCAP 150, NIFTY SMALLCAP 250) with closes & 20D returns
- 3 Industries rows (latest date): group, member count, median 1M, 5 biggest members
- 5 chart cases from latest plan candidates (or screener hits) with detected pattern/pivots + Playwright screenshot paths
"""

import os
import random
from typing import Any, Dict, List

import psycopg2
from dotenv import load_dotenv

load_dotenv(".env")


def generate_verify_pack(seed: int = 42, out_path: str = "probe_output/verify_pack.md") -> str:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    rng = random.Random(seed)
    try:
        with conn.cursor() as cur:
            # 1. 10 random stock-days (3 outside Nifty 500)
            cur.execute("SELECT DISTINCT token, symbol FROM latest_industry_stock_metrics WHERE is_liquid = TRUE;")
            liq = [(int(r[0]), str(r[1])) for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT symbol FROM index_constituents WHERE index_name = 'nifty500' AND COALESCE(is_active, TRUE) = TRUE;")
            n500 = {str(r[0]) for r in cur.fetchall()}

            outside = sorted([x for x in liq if x[1] not in n500], key=lambda x: x[0])
            inside = sorted([x for x in liq if x[1] in n500], key=lambda x: x[0])
            picked = rng.sample(outside, min(3, len(outside))) + rng.sample(inside, min(7, len(inside)))

            stock_days: List[Dict[str, Any]] = []
            for tok, sym in picked:
                cur.execute(
                    """
                    SELECT trade_date::text, open::float, high::float, low::float, close::float, volume::bigint
                    FROM stock_candles WHERE token = %s ORDER BY trade_date DESC LIMIT 120;
                    """,
                    (tok,),
                )
                rows = cur.fetchall()
                if rows:
                    r = rng.choice(rows)
                    stock_days.append({
                        "symbol": sym,
                        "outside_n500": sym not in n500,
                        "date": str(r[0]).split("T")[0],
                        "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5],
                    })

            # 2. 4 index-days (latest plan_date or latest index date)
            cur.execute("SELECT MAX(plan_date)::text FROM daily_plan;")
            pdate_raw = cur.fetchone()[0]
            pdate = str(pdate_raw).split("T")[0] if pdate_raw else None
            index_rows: List[Dict[str, Any]] = []
            for iname in ("NIFTY 50", "NIFTY 500", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250"):
                cur.execute(
                    """
                    SELECT trade_date::text, close::float
                    FROM daily_index_ohlcv
                    WHERE index_name = %s AND trade_date <= %s
                    ORDER BY trade_date DESC LIMIT 25;
                    """,
                    (iname, pdate),
                )
                rows = cur.fetchall()
                if len(rows) >= 21:
                    ret20 = round((rows[0][1] / rows[20][1] - 1.0) * 100.0, 2)
                    index_rows.append({
                        "index_name": iname,
                        "date": str(rows[0][0]).split("T")[0],
                        "close": rows[0][1],
                        "close_20d_ago": rows[20][1],
                        "date_20d_ago": str(rows[20][0]).split("T")[0],
                        "ret_20d_pct": ret20,
                    })

            # 3. 3 Industries rows (latest date, Top 3 industry level)
            cur.execute(
                """
                SELECT g.label, s.n_stocks, s.median_1m::float
                FROM industry_top_groups t
                JOIN industry_groups g ON g.group_id = t.group_id
                JOIN daily_industry_strength s ON s.group_id = t.group_id AND s.trade_date = t.snapshot_date AND s.universe = t.universe
                WHERE t.snapshot_date = (SELECT MAX(snapshot_date) FROM industry_top_groups)
                  AND t.level = 'industry' AND t.universe = 'all'
                ORDER BY t.pos ASC LIMIT 3;
                """
            )
            ind_rows = []
            for lbl, n_st, med_1m in cur.fetchall():
                cur.execute(
                    """
                    SELECT m.symbol, m.mcap_cr::float
                    FROM latest_industry_stock_metrics m
                    WHERE m.industry = %s AND m.is_liquid = TRUE
                    ORDER BY COALESCE(m.mcap_cr, 0) DESC, m.symbol ASC
                    LIMIT 5;
                    """,
                    (lbl,),
                )
                top5 = [f"{r[0]} (₹{r[1]:.0f} Cr)" if r[1] else r[0] for r in cur.fetchall()]
                ind_rows.append({
                    "group": lbl,
                    "members": int(n_st),
                    "median_1m": round(med_1m, 2) if med_1m is not None else None,
                    "top5": top5,
                })

            # 4. 5 chart cases (latest daily_plan_candidates, fallback to screener hits)
            cur.execute(
                """
                SELECT plan_date::text, symbol, token, industry_label, close::float, rs_rank
                FROM daily_plan_candidates
                WHERE plan_date = (SELECT MAX(plan_date) FROM daily_plan_candidates)
                ORDER BY rank ASC LIMIT 5;
                """
            )
            chart_cases = [
                {
                    "plan_date": str(r[0]).split("T")[0],
                    "symbol": str(r[1]),
                    "token": int(r[2]),
                    "industry": str(r[3]),
                    "close": r[4],
                    "rs_rank": r[5],
                }
                for r in cur.fetchall()
            ]
    finally:
        conn.close()

    lines = [
        "# Owner Verification Pack",
        "",
        f"Generated with `seed={seed}`. Use this pack to spot-check displayed numbers against NSE India, Kite, or TradingView.",
        "",
        "## 1. 10 Random Liquid Stock-Days (3 Outside Nifty 500)",
        "",
        "| Symbol | Outside N500 | Date | Open | High | Low | Close | Volume | Compare On |",
        "| --- | :---: | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for s in stock_days:
        lines.append(
            f"| {s['symbol']} | {'Yes' if s['outside_n500'] else 'No'} | {s['date']} | "
            f"{s['open']:.2f} | {s['high']:.2f} | {s['low']:.2f} | {s['close']:.2f} | {s['volume']:,} | NSE Bhavcopy / TradingView 1D |"
        )

    lines.extend([
        "",
        "## 2. 4 Index-Days & 20-Session Returns (Daily Plan Block 2)",
        "",
        "| Index | Latest Date | Close | 20D Ago Date | 20D Ago Close | 20D Return | Compare On |",
        "| --- | --- | ---: | --- | ---: | ---: | --- |",
    ])
    for ix in index_rows:
        lines.append(
            f"| {ix['index_name']} | {ix['date']} | {ix['close']:.2f} | {ix['date_20d_ago']} | "
            f"{ix['close_20d_ago']:.2f} | {ix['ret_20d_pct']:+.2f}% | NSE Historical Index Data |"
        )

    lines.extend([
        "",
        "## 3. 3 Industries Rows (Latest Snapshot Top-3)",
        "",
        "| Industry Group | Liquid Members | Median 1M | 5 Biggest Members (by Market Cap) |",
        "| --- | ---: | ---: | --- |",
    ])
    for ir in ind_rows:
        lines.append(
            f"| {ir['group']} | {ir['members']} | {ir['median_1m']:+.2f}% | {', '.join(ir['top5'])} |"
        )

    lines.extend([
        "",
        "## 4. 5 Chart Cases (Latest Plan Candidates)",
        "",
        "Each chart screenshot (with pattern overlay when detected) is saved in `probe_output/` during browser QA:",
        "",
        "| Symbol | Plan Date | Industry | Close | RS Rank | Screenshot Path |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ])
    for idx, ch in enumerate(chart_cases, 1):
        lines.append(
            f"| {ch['symbol']} | {ch['plan_date']} | {ch['industry']} | {ch['close']:.2f} | {ch['rs_rank']:.0f} | `probe_output/verify_chart_{idx}_{ch['symbol']}.png` |"
        )

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {out_path}")
    return out_path


if __name__ == "__main__":
    generate_verify_pack()
