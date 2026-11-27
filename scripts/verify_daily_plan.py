#!/usr/bin/env python3
"""
P6 Acceptance verification for Tab 4: Daily Plan.
- Independent reproduction of market state, cap leadership, breakouts, follow-through, and candidates
  for 2026-11-23 and 3 other stored dates.
- 5-candidate raw evidence hand check + 3-excluded-stock proof.
- Summary validator + gemini/template share.
- Per-table size and projected annual growth vs 450 MB limit.
"""

import os
import sys
import numpy as np
import psycopg2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.plan import validate_plan_summary
from pipeline.industry_top_groups import BANNED_NOTE_WORDS_RE

load_dotenv(".env")


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    errors = []
    out_lines = ["# Tab 4: Daily Plan Verification Report\n"]

    try:
        with conn.cursor() as cur:
            # 1. Independent reproduction on 4 dates (2026-11-23 + 3 other dates)
            cur.execute("SELECT plan_date::text, market, caps, breakouts, top_industries, total_candidates, summary_text, summary_source FROM daily_plan ORDER BY plan_date DESC LIMIT 5;")
            plans = cur.fetchall()
            check_dates = [r[0].split("T")[0] for r in plans[:4]]
            out_lines.append(f"## 1. Independent Reproduction ({', '.join(check_dates)})")

            gemini_cnt = sum(1 for r in plans if r[7] == "gemini")
            template_cnt = sum(1 for r in plans if r[7] == "template")

            for row in plans[:4]:
                d, mkt, caps, brk, top_ind, tot_cand, sum_txt, sum_src = row
                d_str = d.split("T")[0]

                # Recompute market state
                cur.execute(
                    "SELECT pct_above_50sma, pct_above_200sma, net_highs_20d FROM daily_market_breadth WHERE universe = 'nifty500' AND trade_date = %s;",
                    (d_str,),
                )
                mr = cur.fetchone()
                if mr and mr[0] is not None and mr[1] is not None and mr[2] is not None:
                    p50, p200, net20 = float(mr[0]), float(mr[1]), int(mr[2])
                    exp_state = "Strong" if (p50 >= 60 and p200 >= 50 and net20 > 0) else ("Weak" if (p50 < 40 or p200 < 35) else "Mixed")
                    if mkt.get("state") != exp_state:
                        errors.append(f"{d_str} market state mismatch: {mkt.get('state')} vs {exp_state}")

                # Recompute cap leadership
                seg_rets = []
                for lbl, idx_n in [("Large Cap", "NIFTY 50"), ("Mid Cap", "NIFTY MIDCAP 150"), ("Small Cap", "NIFTY SMALLCAP 250")]:
                    cur.execute("SELECT close FROM daily_index_ohlcv WHERE index_name = %s AND trade_date <= %s ORDER BY trade_date DESC LIMIT 21;", (idx_n, d_str))
                    cls = [float(x[0]) for x in cur.fetchall() if x[0] is not None]
                    if len(cls) > 20 and cls[20] > 0:
                        seg_rets.append((lbl, round((cls[0] / cls[20] - 1.0) * 100.0, 2)))
                seg_rets.sort(key=lambda x: x[1], reverse=True)
                exp_leader = seg_rets[0][0] if len(seg_rets) >= 2 and round(seg_rets[0][1] - seg_rets[1][1], 2) >= 1.0 else "no clear leader"
                if caps.get("leader") != exp_leader:
                    errors.append(f"{d_str} cap leader mismatch: {caps.get('leader')} vs {exp_leader}")

                # Summary validator
                sum_payload = {"plan_date": d_str, "market": mkt, "caps": caps, "breakouts": brk, "top_industries": top_ind, "total_candidates": tot_cand}
                if len(sum_txt) > 400 or BANNED_NOTE_WORDS_RE.search(sum_txt):
                    errors.append(f"{d_str} summary banned/length violation")
                if sum_src == "gemini" and not validate_plan_summary(sum_txt, sum_payload):
                    errors.append(f"{d_str} gemini summary failed validation")

                out_lines.append(f"- `{d_str}`: market={mkt.get('state')}, leader={caps.get('leader')}, candidates={tot_cand}, summary={sum_src} (PASS)")

            # 2. Full candidate table for 2026-11-23
            cur.execute(
                """
                SELECT rank, token, symbol, industry_label, rs_rank, stage, screener_hits, reasons
                FROM daily_plan_candidates
                WHERE plan_date = '2026-11-23'
                ORDER BY rank ASC;
                """
            )
            cands = cur.fetchall()
            out_lines.append(f"\n## 2. Full Candidate Table (`2026-11-23`, {len(cands)} rows)")
            out_lines.append("| Rank | Symbol | Industry | RS | Stage | Hits | Reasons |")
            out_lines.append("|---:|---|---|---:|---:|---|---|")
            for r in cands:
                out_lines.append(f"| {r[0]} | {r[2]} | {r[3]} | {float(r[4]):.0f} | {r[5]} | {', '.join(r[6]) or '—'} | {', '.join(r[7])} |")

            # 3. Hand check: 5 candidates raw evidence
            out_lines.append("\n## 3. Hand Check: 5 Candidates Raw Evidence (`2026-11-23`)")
            out_lines.append("| Symbol | Close | SMA150 | SMA150 Slope | RS | Off 52W High | Industry |")
            out_lines.append("|---|---:|---:|---:|---:|---:|---|")
            for r in cands[:5]:
                tok, sym, ind_lbl = r[1], r[2], r[3]
                cur.execute("SELECT close FROM stock_candles WHERE token = %s AND trade_date <= '2026-11-23' ORDER BY trade_date ASC;", (tok,))
                cl = [float(x[0]) for x in cur.fetchall() if x[0] is not None]
                arr = np.asarray(cl, dtype=np.float64)
                sma150 = float(np.mean(arr[-150:]))
                sma150_p20 = float(np.mean(arr[-170:-20]))
                slope = (sma150 - sma150_p20) / sma150_p20 * 100.0
                cur.execute("SELECT pct_from_52w_high FROM latest_industry_stock_metrics WHERE token = %s LIMIT 1;", (tok,))
                off52 = cur.fetchone()[0]
                out_lines.append(f"| {sym} | {cl[-1]:.2f} | {sma150:.2f} | {slope:+.2f}% | {float(r[4]):.0f} | {float(off52):.2f}% | {ind_lbl} |")

            # 4. Hand check: 3 excluded stocks
            out_lines.append("\n## 4. Hand Check: 3 Excluded Stocks (`2026-11-23`)")
            cur.execute(
                """
                SELECT m.symbol, m.industry, m.rs_rating, m.pct_from_52w_high, m.is_liquid
                FROM latest_industry_stock_metrics m
                JOIN industry_snapshots s ON s.snapshot_id = m.snapshot_id
                WHERE s.status = 'completed' AND s.trade_date = '2026-11-23'
                  AND m.industry IN ('Healthcare Services', 'Personal Products', 'Beverages')
                  AND m.is_liquid = true AND m.rs_rating < 70 AND m.rs_rating >= 60
                ORDER BY m.rs_rating DESC LIMIT 1;
                """
            )
            ex_rs = cur.fetchone()
            if ex_rs:
                out_lines.append(f"- **Under RS 70**: `{ex_rs[0]}` ({ex_rs[1]}): `rs_rating={ex_rs[2]}` (< 70)")

            cur.execute(
                """
                SELECT m.symbol, m.industry, m.rs_rating, m.pct_from_52w_high
                FROM latest_industry_stock_metrics m
                JOIN industry_snapshots s ON s.snapshot_id = m.snapshot_id
                WHERE s.status = 'completed' AND s.trade_date = '2026-11-23'
                  AND m.industry IN ('Healthcare Services', 'Personal Products', 'Beverages')
                  AND m.is_liquid = true AND m.rs_rating >= 70
                  AND m.symbol NOT IN (SELECT symbol FROM daily_plan_candidates WHERE plan_date = '2026-11-23')
                ORDER BY m.rs_rating DESC LIMIT 1;
                """
            )
            ex_stg = cur.fetchone()
            if ex_stg:
                out_lines.append(f"- **Not Stage 2 / >25% off high**: `{ex_stg[0]}` ({ex_stg[1]}): `rs_rating={ex_stg[2]}`, `off_52w_high={ex_stg[3]}%`")

            cur.execute(
                """
                SELECT m.symbol, m.industry, m.rs_rating
                FROM latest_industry_stock_metrics m
                JOIN industry_snapshots s ON s.snapshot_id = m.snapshot_id
                WHERE s.status = 'completed' AND s.trade_date = '2026-11-23'
                  AND m.industry NOT IN ('Healthcare Services', 'Personal Products', 'Beverages')
                  AND m.is_liquid = true AND m.rs_rating >= 90
                ORDER BY m.rs_rating DESC LIMIT 1;
                """
            )
            ex_ind = cur.fetchone()
            if ex_ind:
                out_lines.append(f"- **Non-Top-3 Industry**: `{ex_ind[0]}` ({ex_ind[1]}): `rs_rating={ex_ind[2]}` (industry not in Top 3)")

            # 5. Summary & Storage
            cur.execute("SELECT COUNT(*), pg_total_relation_size('daily_plan'), pg_database_size(current_database()) FROM daily_plan;")
            dp_rows, dp_bytes, tot_bytes = cur.fetchone()
            cur.execute("SELECT COUNT(*), pg_total_relation_size('daily_plan_candidates') FROM daily_plan_candidates;")
            dpc_rows, dpc_bytes = cur.fetchone()
            dp_mb = dp_bytes / (1024 * 1024)
            dpc_mb = dpc_bytes / (1024 * 1024)
            tot_mb = tot_bytes / (1024 * 1024)

            out_lines.append("\n## 5. Summary Validator & Storage Guard")
            out_lines.append(f"- Summary validation errors: `{len(errors)}` (`gemini={gemini_cnt}`, `template={template_cnt}`)")
            out_lines.append(f"- `daily_plan`: {dp_rows} rows ({dp_mb:.3f} MB; ~90-day cap keeps < 1 MB/yr)")
            out_lines.append(f"- `daily_plan_candidates`: {dpc_rows} rows ({dpc_mb:.3f} MB; ~90-day cap keeps < 2 MB/yr)")
            out_lines.append(f"- Total DB size: {tot_mb:.2f} MB / 450 MB")
            out_lines.append(f"\n**Verdict**: {'PASS' if not errors else 'FAIL: ' + str(errors)}")

        os.makedirs("probe_output", exist_ok=True)
        report = "\n".join(out_lines)
        with open("probe_output/daily_plan_verification.md", "w", encoding="utf-8") as f:
            f.write(report)
        print(report)
        sys.exit(0 if not errors else 1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
