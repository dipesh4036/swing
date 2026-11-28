#!/usr/bin/env python3
"""
D3 — Targeted NSE classification verification for Top-industry members,
Daily Plan candidates, and Control names (at most 120 symbols per run).

Uses PoliteNseQuoteClient (User-Agent: swing-personal-research/1.0, home page cookie first,
2.5s spacing, stops at first HTTP 403/429). Local run only, never from Actions.
"""

import argparse
import json
import os
from typing import Any, Dict, List, Tuple

import psycopg2
from dotenv import load_dotenv

from pipeline.classification import _batch_update_instruments, _record_audit
from pipeline.classification_fetch import PoliteNseQuoteClient

load_dotenv(".env")

GATE_BASIC_PCT = 98.0
GATE_SECTOR_PCT = 99.0


def run_targeted_classification_audit(max_symbols: int = 120, store: bool = True, run_kind: str = "manual") -> Dict[str, Any]:
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            # 1. Qualifying top-industry members (latest snapshot_date)
            cur.execute(
                """
                WITH latest_top AS (
                    SELECT DISTINCT g.level, g.label
                    FROM industry_top_groups t
                    JOIN industry_groups g ON g.group_id = t.group_id
                    WHERE t.snapshot_date = (SELECT MAX(snapshot_date) FROM industry_top_groups)
                      AND t.qualifies = TRUE
                )
                SELECT DISTINCT m.token, m.symbol
                FROM latest_industry_stock_metrics m
                JOIN latest_top lt ON (
                    (lt.level = 'macro' AND m.macro = lt.label)
                    OR (lt.level = 'sector' AND m.sector = lt.label)
                    OR (lt.level = 'industry' AND m.industry = lt.label)
                    OR (lt.level = 'basic_industry' AND m.basic_industry = lt.label)
                )
                WHERE m.is_liquid = TRUE;
                """
            )
            top_members = {(int(r[0]), str(r[1])) for r in cur.fetchall()}

            # 2. Latest Daily Plan candidates + control names
            cur.execute(
                """
                SELECT DISTINCT token, symbol FROM daily_plan_candidates
                WHERE plan_date = (SELECT MAX(plan_date) FROM daily_plan_candidates)
                UNION
                SELECT DISTINCT token, symbol FROM plan_control
                WHERE plan_date = (SELECT MAX(plan_date) FROM plan_control);
                """
            )
            plan_ctrl = {(int(r[0]), str(r[1])) for r in cur.fetchall()}

            target_tokens = sorted({t for t, _ in (top_members | plan_ctrl)})

            cur.execute(
                """
                SELECT token, symbol, macro_sector, sector, industry, basic_industry, classification_source
                FROM instruments
                WHERE token = ANY(%s)
                ORDER BY (COALESCE(classification_source, '') = 'nse_quote') ASC, symbol ASC;
                """,
                (target_tokens,),
            )
            all_targets = cur.fetchall()
    finally:
        conn.close()

    # Prioritize not-yet-nse_quote symbols first; cap at max_symbols
    pending = [r for r in all_targets if r[6] != "nse_quote"]
    queue = pending[:max_symbols]
    if len(queue) < max_symbols:
        already = [r for r in all_targets if r[6] == "nse_quote"]
        queue.extend(already[: max_symbols - len(queue)])

    print(f"[D3] Total targeted symbols={len(all_targets)}, pending(non-nse_quote)={len(pending)}, fetching={len(queue)}")

    client = PoliteNseQuoteClient(delay_sec=2.5)
    checked = 0
    matches = {"macro": 0, "sector": 0, "industry": 0, "basic_industry": 0}
    mismatches: List[Dict[str, Any]] = []
    updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
    audit_entries: List[Tuple[str, str, str, str, str]] = []

    for tok, sym, old_mac, old_sec, old_ind, old_bas, old_src in queue:
        if client.halted:
            print("[D3] Halted on HTTP 403/429.")
            break
        status, cls_info = client.lookup_symbol(sym)
        if status != "ok" or not cls_info:
            continue
        checked += 1
        new_mac = cls_info.get("macro") or old_mac or ""
        new_sec = cls_info.get("sector") or old_sec or ""
        new_ind = cls_info.get("industry") or old_ind or ""
        new_bas = cls_info.get("basic_industry") or old_bas or ""

        if (old_mac or "") == new_mac:
            matches["macro"] += 1
        if (old_sec or "") == new_sec:
            matches["sector"] += 1
        if (old_ind or "") == new_ind:
            matches["industry"] += 1
        if (old_bas or "") == new_bas:
            matches["basic_industry"] += 1

        sym_diffs = []
        for field, ov, nv in (
            ("macro_sector", old_mac, new_mac),
            ("sector", old_sec, new_sec),
            ("industry", old_ind, new_ind),
            ("basic_industry", old_bas, new_bas),
        ):
            if (ov or "") != nv and nv:
                sym_diffs.append({"field": field, "old": ov, "new": nv})
                audit_entries.append((sym, field, ov, nv, "nse_quote"))

        if sym_diffs:
            mismatches.append({"symbol": sym, "old_source": old_src, "diffs": sym_diffs})

        if new_mac and new_sec and new_ind and new_bas:
            updates.append((int(tok), sym, new_mac, new_sec, new_ind, new_bas, "nse_quote", "mapped"))

    rates = {
        k: round((v / checked) * 100.0, 2) if checked > 0 else 0.0
        for k, v in matches.items()
    }
    passed = checked > 0 and rates["basic_industry"] >= GATE_BASIC_PCT and rates["sector"] >= GATE_SECTOR_PCT

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        if updates:
            _batch_update_instruments(conn, updates)
        if audit_entries:
            with conn.cursor() as cur:
                _record_audit(cur, audit_entries)
        if store:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO data_audit (run_at, check_id, source, sample_n, matched_n, match_pct, gate_pct, passed, detail, run_kind)
                    VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s);
                    """,
                    (
                        "classification_audit_nse",
                        "NSE Quote API (targeted Top-3 + Plan + Control)",
                        checked,
                        matches["basic_industry"],
                        rates["basic_industry"],
                        GATE_BASIC_PCT,
                        passed,
                        json.dumps({
                            "total_targets": len(all_targets),
                            "pending_before": len(pending),
                            "checked": checked,
                            "halted": client.halted,
                            "match_rates": rates,
                            "updates_applied": len(updates),
                            "mismatches_count": len(mismatches),
                            "mismatches": mismatches[:30],
                        }),
                        run_kind,
                    ),
                )
        conn.commit()
    finally:
        conn.close()

    return {
        "checked": checked,
        "halted": client.halted,
        "match_rates": rates,
        "updates_applied": len(updates),
        "mismatches": mismatches,
        "passed": passed,
    }


def main():
    parser = argparse.ArgumentParser(description="D3 Targeted NSE Classification Verification")
    parser.add_argument("--max-symbols", type=int, default=120)
    parser.add_argument("--no-store", action="store_true")
    args = parser.parse_args()

    res = run_targeted_classification_audit(max_symbols=args.max_symbols, store=not args.no_store)
    print(
        f"[D3] checked={res['checked']}, halted={res['halted']}, updates={res['updates_applied']}, "
        f"rates={res['match_rates']}, passed={res['passed']}"
    )
    if res["mismatches"]:
        print("Mismatches:", res["mismatches"][:15])


if __name__ == "__main__":
    main()
