"""
Tab 5 / Daily Plan: Idempotent plain-text Telegram summary (T4).
Reads stored daily_plan + daily_plan_candidates, formats <= 900 chars
deterministically (no AI), validates against banned words, and sends
via pipeline.alerts.send_telegram_text only when notified_at IS NULL.
"""

import logging
import re
from typing import Any, Callable, Dict, List, Optional

from pipeline.alerts import send_telegram_text
from pipeline.db import get_connection
from pipeline.industry_top_groups import BANNED_NOTE_WORDS_RE
from pipeline.plan_rules import TELEGRAM_SUMMARY_MAX_CHARS, TRACK_RECORD_BANNED_WORDS

logger = logging.getLogger("pipeline.plan_notify")

PLAN_URL = "https://swing.dipeshdev.site/plan"
EXTRA_BANNED_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(w) for w in TRACK_RECORD_BANNED_WORDS) + r")\b",
    flags=re.IGNORECASE,
)


def validate_telegram_text(text: str) -> bool:
    if not text or len(text) > TELEGRAM_SUMMARY_MAX_CHARS:
        return False
    if BANNED_NOTE_WORDS_RE.search(text) or EXTRA_BANNED_RE.search(text):
        return False
    return True


def format_daily_telegram_text(plan: Dict[str, Any]) -> str:
    plan_date = str(plan.get("plan_date") or "")
    minimal = f"Daily Plan {plan_date}\n{PLAN_URL}"

    mkt = plan.get("market") or {}
    caps = plan.get("caps") or {}
    brk = plan.get("breakouts") or {}
    top_ind = plan.get("top_industries") or {}
    cands: List[Dict[str, Any]] = plan.get("candidates") or []
    tot_cands = int(plan.get("total_candidates") or len(cands))

    lines: List[str] = [f"Daily Plan {plan_date}"]

    if mkt.get("status") == "available":
        lines.append(
            f"Market: {mkt.get('state')} (>50SMA {mkt.get('pct_above_50sma', 0):.0f}%, "
            f">200SMA {mkt.get('pct_above_200sma', 0):.0f}%, net20D {int(mkt.get('net_highs_20d') or 0):+d})"
        )
    else:
        lines.append("Market: unavailable")

    if caps.get("status") == "available":
        segs = caps.get("segments") or []
        seg_str = ", ".join(
            f"{s['label'].split()[0]} {s['ret_20d']:+.1f}%"
            for s in segs
            if s.get("ret_20d") is not None
        )
        lines.append(f"Caps: {caps.get('leader', 'no clear leader')} (20D: {seg_str})")

    if brk.get("status") == "available":
        cnts = brk.get("counts") or {}
        bo = cnts.get("stage2_breakout") or {}
        vcp = cnts.get("vcp") or {}
        npv = cnts.get("near_pivot") or {}
        ft = (brk.get("follow_through") or {}).get("label") or "too few to judge"
        lines.append(
            f"Breakouts (vs 5D): S2BO {bo.get('today', 0)}/{bo.get('prev_5d', '-')}, "
            f"VCP {vcp.get('today', 0)}/{vcp.get('prev_5d', '-')}, "
            f"Near {npv.get('today', 0)}/{npv.get('prev_5d', '-')}; 5D FT: {ft}"
        )

    if top_ind.get("status") == "available" and (top_ind.get("groups") or []):
        as_of = top_ind.get("as_of")
        stale = f" (Industries as of {as_of})" if as_of and as_of != plan_date else ""
        qual_groups = [g for g in (top_ind.get("groups") or []) if g.get("qualifies", True)]
        if qual_groups:
            ind_str = ", ".join(
                f"#{g['pos']} {g['label']} (w#{g['worstRank']})"
                for g in qual_groups[:3]
            )
            lines.append(f"Top 3{stale}: {ind_str}")
        else:
            cutoff = top_ind["groups"][0].get("cutoff")
            cutoff_str = f"top {cutoff}" if cutoff is not None else "cut-off"
            lines.append(f"Top 3{stale}: none met {cutoff_str}")

    if cands:
        by_ind: Dict[str, List[str]] = {}
        for c in cands[:5]:
            by_ind.setdefault(str(c["industry_label"]), []).append(str(c["symbol"]))
        grouped_str = "; ".join(f"{k}: {', '.join(v)}" for k, v in by_ind.items())
        lines.append(f"Candidates ({tot_cands} total, first {min(5, len(cands))}): {grouped_str}")
    else:
        lines.append(f"Candidates: {tot_cands}")

    footer = PLAN_URL
    body = "\n".join(lines)
    max_body = TELEGRAM_SUMMARY_MAX_CHARS - len(footer) - 1
    if len(body) > max_body:
        body = body[: max(0, max_body - 3)].rstrip() + "..."
    final_text = f"{body}\n{footer}"

    if not validate_telegram_text(final_text):
        return minimal
    return final_text


def send_daily_plan_telegram(
    plan_date: Optional[str] = None,
    send_fn: Callable[[str], bool] = send_telegram_text,
) -> Dict[str, Any]:
    """
    Send the daily Telegram summary once per plan_date (when notified_at IS NULL).
    Sets notified_at = NOW() only on successful send; never raises on HTTP/env errors.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            if plan_date:
                cur.execute(
                    """
                    SELECT plan_date::text, market, caps, breakouts, top_industries,
                           total_candidates, notified_at
                    FROM daily_plan
                    WHERE plan_date = %s;
                    """,
                    (plan_date,),
                )
            else:
                cur.execute(
                    """
                    SELECT plan_date::text, market, caps, breakouts, top_industries,
                           total_candidates, notified_at
                    FROM daily_plan
                    ORDER BY plan_date DESC
                    LIMIT 1;
                    """
                )
            row = cur.fetchone()
            if not row:
                return {"status": "skipped", "reason": "no_plan"}

            pd = str(row[0]).split("T")[0]
            if row[6] is not None:
                return {"status": "skipped", "reason": "already_notified", "plan_date": pd}

            cur.execute(
                """
                SELECT symbol, industry_label
                FROM daily_plan_candidates
                WHERE plan_date = %s
                ORDER BY rank ASC
                LIMIT 5;
                """,
                (pd,),
            )
            cands = [{"symbol": r[0], "industry_label": r[1]} for r in cur.fetchall()]

            plan_dict = {
                "plan_date": pd,
                "market": row[1],
                "caps": row[2],
                "breakouts": row[3],
                "top_industries": row[4],
                "total_candidates": int(row[5]),
                "candidates": cands,
            }
            text = format_daily_telegram_text(plan_dict)
            ok = send_fn(text)
            if ok:
                cur.execute("UPDATE daily_plan SET notified_at = NOW() WHERE plan_date = %s;", (pd,))
                conn.commit()
                return {"status": "sent", "plan_date": pd, "length": len(text)}
            return {"status": "not_sent", "plan_date": pd, "length": len(text)}
