"""
D4 & D6.5 — Data audit runner, storage helpers, Telegram failure alert, and live backfill fidelity check.
"""

import json
import logging
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from pipeline.alerts import send_telegram_text
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.data_audit")

DATA_AUDIT_RETENTION_DAYS = 400


def prune_data_audit(cur, retention_days: int = DATA_AUDIT_RETENTION_DAYS) -> None:
    cur.execute(
        "DELETE FROM data_audit WHERE run_at < NOW() - (%s || ' days')::interval;",
        (retention_days,),
    )


def record_data_audit(
    cur,
    check_id: str,
    source: str,
    sample_n: int,
    matched_n: int,
    match_pct: float,
    gate_pct: float,
    passed: bool,
    detail: Dict[str, Any],
    run_kind: str = "ci",
) -> None:
    cur.execute(
        """
        INSERT INTO data_audit (run_at, check_id, source, sample_n, matched_n, match_pct, gate_pct, passed, detail, run_kind)
        VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s);
        """,
        (
            check_id,
            source,
            int(sample_n),
            int(matched_n),
            float(match_pct),
            float(gate_pct),
            bool(passed),
            json.dumps(detail),
            run_kind,
        ),
    )


def _spearman(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 2:
        return 1.0
    rx = pd.Series(x).rank(method="average").to_numpy()
    ry = pd.Series(y).rank(method="average").to_numpy()
    mx, my = rx.mean(), ry.mean()
    num = float(np.sum((rx - mx) * (ry - my)))
    den = float(np.sqrt(np.sum((rx - mx) ** 2) * np.sum((ry - my) ** 2)))
    return num / den if den > 0 else 0.0


def run_backfill_fidelity_check(plan_date: str, conn=None, run_kind: str = "ci") -> Optional[Dict[str, Any]]:
    """
    D6.5: Compare live snapshot metrics vs historical stock_candles recomputation for `plan_date`,
    and store RS Spearman, Stage 2 agreement, and candidate Jaccard in data_audit (`check_id='backfill_fidelity'`).
    """
    from pipeline.plan import _compute_historical_stock_metrics, _compute_stage2_tokens_at_date
    from pipeline.plan_outcomes import select_filter_only_candidates

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.token, m.symbol, m.industry, m.is_liquid, m.rs_rating, m.pct_from_52w_high
                FROM latest_industry_stock_metrics m
                WHERE m.snapshot_id = (
                    SELECT s.snapshot_id FROM industry_snapshots s
                    WHERE s.status = 'completed' AND s.trade_date = %s
                    ORDER BY s.completed_at DESC LIMIT 1
                );
                """,
                (plan_date,),
            )
            live_rows = cur.fetchall()
            if not live_rows:
                return None

            toks = [int(r[0]) for r in live_rows]
            live_stages = _compute_stage2_tokens_at_date(cur, plan_date, toks)
            live_by_tok: Dict[int, Dict[str, Any]] = {}
            for tok, sym, ind, liq, rs, off_hi in live_rows:
                t = int(tok)
                live_by_tok[t] = {
                    "token": t,
                    "symbol": sym,
                    "industry": ind,
                    "is_liquid": bool(liq),
                    "rs_rating": float(rs) if rs is not None else None,
                    "pct_from_52w_high": float(off_hi) if off_hi is not None else None,
                    "stage": live_stages.get(t, 0),
                }

            hist_rows = _compute_historical_stock_metrics(cur, plan_date, industry_filter=None)
            hist_by_tok = {int(r["token"]): r for r in hist_rows}

            common_liq = sorted(
                t for t in set(live_by_tok.keys()) & set(hist_by_tok.keys())
                if live_by_tok[t]["is_liquid"] and live_by_tok[t]["rs_rating"] is not None and hist_by_tok[t]["rs_rating"] is not None
            )
            if not common_liq:
                return None

            arr_l = np.array([live_by_tok[t]["rs_rating"] for t in common_liq], dtype=float)
            arr_h = np.array([hist_by_tok[t]["rs_rating"] for t in common_liq], dtype=float)
            rs_spearman = round(_spearman(arr_l, arr_h), 4)

            st2_agree = sum(1 for t in common_liq if live_by_tok[t]["stage"] == hist_by_tok[t]["stage"])
            st2_pct = round(st2_agree / len(common_liq) * 100.0, 2)

            # Candidate Jaccard (filter_only)
            cur.execute(
                """
                SELECT g.label FROM industry_top_groups t
                JOIN industry_groups g ON g.group_id = t.group_id
                WHERE t.snapshot_date = %s AND t.level = 'industry' AND t.universe = 'all' AND t.qualifies = TRUE;
                """,
                (plan_date,),
            )
            qual_groups = [{"label": r[0]} for r in cur.fetchall()]
            live_cands = {c["symbol"] for c in select_filter_only_candidates(list(live_by_tok.values()), qual_groups)}
            hist_cands = {c["symbol"] for c in select_filter_only_candidates(hist_rows, qual_groups)}
            union = live_cands | hist_cands
            jaccard = round(len(live_cands & hist_cands) / len(union), 4) if union else 1.0

            passed = rs_spearman >= 0.99 and st2_pct >= 99.5
            detail = {
                "plan_date": plan_date,
                "rs_spearman": rs_spearman,
                "stage2_agreement_pct": st2_pct,
                "jaccard": jaccard,
                "live_filter_only_count": len(live_cands),
                "hist_filter_only_count": len(hist_cands),
            }
            record_data_audit(
                cur,
                check_id="backfill_fidelity",
                source=f"live vs backfill on {plan_date}",
                sample_n=len(common_liq),
                matched_n=st2_agree,
                match_pct=st2_pct,
                gate_pct=99.5,
                passed=passed,
                detail=detail,
                run_kind=run_kind,
            )
            prune_data_audit(cur)
        conn.commit()
        return detail
    finally:
        if should_close and conn:
            conn.close()


def run_data_audit_cli(manual: bool = False) -> int:
    """
    Execute weekly CI checks (D1.1 bhavcopy + D2 recompute on latest date) or
    manual checks (D1.2 Angel + D1.3 corp + D3 classification).
    Sends Telegram alert ONLY when any check fails its gate.
    """
    failures: List[str] = []
    if not manual:
        # CI-safe: D1.1 Bhavcopy (latest 5 sessions) + D2 Recompute (latest date / 5 dates)
        r1 = subprocess.run(
            [sys.executable, "scripts/trust_price_audit.py", "--mode", "bhavcopy", "--sessions", "5", "--store", "--run-kind", "ci"],
            check=False,
        )
        if r1.returncode != 0:
            failures.append("D1.1 Bhavcopy check exited non-zero")
        r2 = subprocess.run(
            [sys.executable, "scripts/trust_recompute.py", "--store", "--run-kind", "ci"],
            check=False,
        )
        if r2.returncode != 0:
            failures.append("D2 Recompute check exited non-zero")

        # Inspect newest ci rows
        with get_connection() as conn:
            with conn.cursor() as cur:
                prune_data_audit(cur)
                cur.execute(
                    """
                    SELECT DISTINCT ON (check_id) check_id, match_pct, gate_pct, passed
                    FROM data_audit
                    WHERE run_kind = 'ci' AND run_at >= NOW() - INTERVAL '1 hour'
                    ORDER BY check_id, run_at DESC;
                    """
                )
                for cid, mp, gp, ps in cur.fetchall():
                    if not ps:
                        failures.append(f"{cid}: {mp}% < gate {gp}%")
            conn.commit()
    else:
        # Manual: Angel + Corp + NSE Classification
        r_ang = subprocess.run(
            [sys.executable, "scripts/trust_price_audit.py", "--mode", "angel", "--store", "--run-kind", "manual"],
            check=False,
        )
        if r_ang.returncode != 0:
            failures.append("D1.2 Angel audit exited non-zero")
        r_cls = subprocess.run(
            [sys.executable, "scripts/trust_classification_audit.py", "--max-symbols", "120"],
            check=False,
        )
        if r_cls.returncode != 0:
            failures.append("D3 Classification audit exited non-zero")

    if failures:
        msg = "Data Audit Gate Failure:\n" + "\n".join(f"- {f}" for f in failures[:8])
        logger.error(msg)
        send_telegram_text(msg)
        return 1
    logger.info("Data Audit completed with all checks passing.")
    return 0
