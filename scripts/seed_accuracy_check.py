"""
Local-only 150-symbol NSE quote verification against DB seed classifications (Y2).
Paces at 2.5s between requests, halts immediately on HTTP 403/429 without retry.
"""

import os
import random
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone

# Ensure repo root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.classification import CURRENT_MACROS, standard_name
from pipeline.classification_fetch import NseQuoteClassifier
from pipeline.db import get_connection

SEED = 42
SAMPLE_SIZE = 150
REPORT_PATH = "data/seed_vs_nse_report.md"


def main():
    print(f"=== Seed Accuracy Check (seed={SEED}, target={SAMPLE_SIZE}) ===")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT i.token, i.symbol, i.instrument_type,
                       i.macro_sector, i.sector, i.industry, i.basic_industry,
                       i.classification_source
                FROM instruments i
                JOIN latest_industry_stock_metrics m ON m.token = i.token
                JOIN industry_snapshots s ON s.snapshot_id = m.snapshot_id
                WHERE s.status = 'completed'
                  AND s.snapshot_id = (
                      SELECT snapshot_id FROM industry_snapshots
                      WHERE status = 'completed'
                      ORDER BY trade_date DESC, completed_at DESC LIMIT 1
                  )
                  AND m.is_liquid = TRUE
                  AND i.exchange = 'NSE'
                  AND i.classification_source IN ('seed', 'import', 'override')
                ORDER BY i.symbol;
                """
            )
            candidates = cur.fetchall()

    print(f"Eligible liquid seed-classified candidates: {len(candidates)}")
    if not candidates:
        print("No seed-classified liquid candidates found.")
        sys.exit(1)

    # Stratified sample across all sectors
    rng = random.Random(SEED)
    by_sector = defaultdict(list)
    for row in candidates:
        by_sector[row[4] or "Unclassified"].append(row)

    selected = []
    sectors = sorted(by_sector.keys())
    for sec in sectors:
        rng.shuffle(by_sector[sec])

    # Round-robin across sectors until SAMPLE_SIZE reached
    idx = 0
    while len(selected) < min(SAMPLE_SIZE, len(candidates)):
        added_any = False
        for sec in sectors:
            if idx < len(by_sector[sec]) and len(selected) < SAMPLE_SIZE:
                selected.append(by_sector[sec][idx])
                added_any = True
        if not added_any:
            break
        idx += 1

    print(f"Selected {len(selected)} symbols across {len({r[4] for r in selected})} sectors (seed={SEED}).")

    client = NseQuoteClassifier(delay_seconds=2.5, timeout=12, max_retries=0)
    results = []
    blocked = False

    for pos, row in enumerate(selected, start=1):
        tok, sym, itype, db_m, db_s, db_i, db_b, db_src = row
        status, data = client.fetch_classification(sym, series=itype or "EQ")
        if status == "blocked":
            print(f"[STOP] HTTP 403/429 received at {pos}/{len(selected)} ({sym}). Halting cleanly.")
            blocked = True
            break
        results.append({
            "token": tok,
            "symbol": sym,
            "db": (db_m or "", db_s or "", db_i or "", db_b or ""),
            "status": status,
            "nse": (
                standard_name(data["macro"]),
                standard_name(data["sector"]),
                standard_name(data["industry"]),
                standard_name(data["basic_industry"]),
            ) if (status == "ok" and data) else None,
            "nse_raw": (
                data["macro"], data["sector"], data["industry"], data["basic_industry"]
            ) if (status == "ok" and data) else None,
        })
        if pos % 25 == 0:
            print(f"[{pos}/{len(selected)}] fetched... (latest: {sym} -> {status})")

    tested = len(results)
    if tested == 0:
        print("Zero symbols tested before block/error.")
        sys.exit(1)

    levels = ["macro", "sector", "industry", "basic_industry"]
    matches = {lvl: 0 for lvl in levels}
    mismatches = []

    for r in results:
        if r["nse"] is None:
            mismatches.append((r["symbol"], "all", "NONE (missing on NSE)", r["db"][3], "extra in seed"))
            continue
        for idx_l, lvl in enumerate(levels):
            nse_val = r["nse"][idx_l]
            nse_raw = r["nse_raw"][idx_l]
            db_val = r["db"][idx_l]
            if nse_val == db_val:
                matches[lvl] += 1
            elif nse_raw.strip().lower() == db_val.strip().lower():
                matches[lvl] += 1
                mismatches.append((r["symbol"], lvl, nse_raw, db_val, "spelling"))
            elif not db_val:
                mismatches.append((r["symbol"], lvl, nse_raw, "(empty)", "missing in seed"))
            else:
                mismatches.append((r["symbol"], lvl, nse_raw, db_val, "real reclassification"))

    pcts = {lvl: (matches[lvl] / tested * 100.0) for lvl in levels}
    gate_pass = (pcts["basic_industry"] >= 98.0) and (pcts["sector"] >= 99.0) and not blocked

    os.makedirs("data", exist_ok=True)
    lines = [
        "# Seed vs NSE Quote Accuracy Report",
        "",
        f"- **Generated**: {datetime.now(timezone.utc).isoformat()}",
        f"- **Sample Seed**: `{SEED}`",
        f"- **Tested Symbols**: {tested} / {len(selected)} (blocked={blocked})",
        f"- **HARD Gate** (`basic_industry >= 98%` AND `sector >= 99%`): **{'PASS' if gate_pass else 'FAIL'}**",
        "",
        "## Match Rate Per Level",
        "| Level | Matches | Tested | Match % |",
        "|---|---:|---:|---:|",
    ]
    for lvl in levels:
        lines.append(f"| {lvl} | {matches[lvl]} | {tested} | {pcts[lvl]:.2f}% |")

    lines.extend([
        "",
        "## Mismatches",
        "| Symbol | Level | NSE Value | DB Value | Cause |",
        "|---|---|---|---|---|",
    ])
    if mismatches:
        for sym, lvl, nse_v, db_v, cause in mismatches:
            lines.append(f"| {sym} | {lvl} | {nse_v} | {db_v} | {cause} |")
    else:
        lines.append("| (none) | — | — | — | — |")

    # Update DB if gate passes
    changed_memberships = 0
    updated_rows = 0
    if gate_pass:
        with get_connection() as conn:
            with conn.cursor() as cur:
                for r in results:
                    if r["nse"] is None:
                        continue
                    m, s, i, b = r["nse"]
                    if m not in CURRENT_MACROS:
                        continue
                    if (m, s, i, b) != r["db"]:
                        changed_memberships += 1
                    cur.execute(
                        """
                        UPDATE instruments
                        SET macro_sector = %s, sector = %s, industry = %s, basic_industry = %s,
                            classification_source = 'nse_quote',
                            classification_updated_at = NOW()
                        WHERE token = %s;
                        """,
                        (m, s, i, b, r["token"]),
                    )
                    cur.execute(
                        """
                        UPDATE stock_industry
                        SET macro = %s, sector = %s, industry = %s, basic_industry = %s,
                            source = 'nse_quote', fetched_at = NOW()
                        WHERE symbol = %s;
                        """,
                        (m, s, i, b, r["symbol"]),
                    )
                    updated_rows += 1
            conn.commit()
        lines.extend([
            "",
            f"- **DB Updated**: {updated_rows} rows marked `classification_source='nse_quote'` ({changed_memberships} group memberships changed).",
        ])
    else:
        lines.extend([
            "",
            "- **DB Updated**: 0 rows (gate failed or blocked; data untouched).",
        ])

    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"Report written to {REPORT_PATH}")
    print(f"Gate: {'PASS' if gate_pass else 'FAIL'} | Sector: {pcts['sector']:.2f}% | Basic Industry: {pcts['basic_industry']:.2f}% | Updated: {updated_rows}, Changed: {changed_memberships}")
    if not gate_pass:
        sys.exit(1)


if __name__ == "__main__":
    main()
