"""
UX1 & UX2: Deterministic minimax Top 3 across timeframes (1D/1W/1M/3M)
and optional constrained Gemini/template one-sentence summary.
"""

import logging
import math
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests
from psycopg2.extras import execute_values

from pipeline.db import get_connection
from pipeline.plan_rules import TOP_GROUP_CUTOFF_FRACTION, TOP_GROUP_CUTOFF_MIN

logger = logging.getLogger("pipeline.industry_top_groups")

LEVELS = ("macro", "sector", "industry", "basic_industry")
UNIVERSES = ("all", "liquid")
MAX_GEMINI_CALLS_PER_RUN = 24
GEMINI_TIMEOUT_SEC = 10

BANNED_NOTE_WORDS_RE = re.compile(
    r"\b(buy|sell|target|stop|entry|signal|score|probability|guaranteed|recommend|should|invest|expect|forecast)\b",
    re.IGNORECASE,
)


def _dense_ranks(items: List[Dict[str, Any]], field: str) -> Dict[str, int]:
    """Dense rank descending by `field` (strongest = 1), deterministic tie-break on label."""
    ordered = sorted(items, key=lambda r: (-float(r[field]), str(r["label"])))
    ranks: Dict[str, int] = {}
    prev_val: Optional[float] = None
    cur_rank = 0
    for r in ordered:
        val = float(r[field])
        if prev_val is None or val != prev_val:
            cur_rank += 1
            prev_val = val
        ranks[str(r["group_id"])] = cur_rank
    return ranks


def compute_top_groups_for_slice(
    rows: List[Dict[str, Any]],
    snapshot_date: str,
    level: str,
    universe: str,
) -> List[Dict[str, Any]]:
    """
    Compute up to 3 top groups for a single (snapshot_date, level, universe) slice:
    - Filter n_eligible >= 5 and non-null median_1d, median_1w, median_1m, median_3m.
    - Rank independently on each of 1D, 1W, 1M, 3M (dense rank descending, strongest=1).
    - Order by (worst_rank asc, mean_rank asc, rank_trend asc, label asc).
    - Return first 3 (never pad if < 3 qualify).
    """
    eligible = [
        r for r in rows
        if (r.get("n_eligible") or 0) >= 5
        and r.get("median_1d") is not None
        and r.get("median_1w") is not None
        and r.get("median_1m") is not None
        and r.get("median_3m") is not None
    ]
    if not eligible:
        return []

    r1d = _dense_ranks(eligible, "median_1d")
    r1w = _dense_ranks(eligible, "median_1w")
    r1m = _dense_ranks(eligible, "median_1m")
    r3m = _dense_ranks(eligible, "median_3m")

    scored: List[Dict[str, Any]] = []
    for r in eligible:
        gid = str(r["group_id"])
        d_rank = r1d[gid]
        w_rank = r1w[gid]
        m_rank = r1m[gid]
        q_rank = r3m[gid]
        worst = max(d_rank, w_rank, m_rank, q_rank)
        mean_r = round((d_rank + w_rank + m_rank + q_rank) / 4.0, 2)
        scored.append({
            "snapshot_date": snapshot_date,
            "level": level,
            "universe": universe,
            "group_id": gid,
            "label": str(r["label"]),
            "r_1d": d_rank,
            "r_1w": w_rank,
            "r_1m": m_rank,
            "r_3m": q_rank,
            "worst_rank": worst,
            "mean_rank": mean_r,
            "rank_trend": r.get("rank_trend"),
            "med_1d": round(float(r["median_1d"]), 4),
            "med_1w": round(float(r["median_1w"]), 4),
            "med_1m": round(float(r["median_1m"]), 4),
            "med_3m": round(float(r["median_3m"]), 4),
            "n_20d_high": int(r.get("n_20d_high") or 0),
            "n_20d_low": int(r.get("n_20d_low") or 0),
            "pct_above_50dma": round(float(r["pct_above_50dma"]), 2) if r.get("pct_above_50dma") is not None else None,
            "n_eligible": int(r["n_eligible"]),
        })

    cutoff = max(TOP_GROUP_CUTOFF_MIN, math.ceil(TOP_GROUP_CUTOFF_FRACTION * len(eligible)))

    scored.sort(
        key=lambda x: (
            x["worst_rank"],
            x["mean_rank"],
            x["rank_trend"] if x["rank_trend"] is not None else 999999,
            x["label"],
        )
    )
    top = scored[:3]
    for idx, item in enumerate(top, start=1):
        item["pos"] = idx
        item["cutoff"] = cutoff
        item["qualifies"] = bool(item["worst_rank"] <= cutoff)
    return top


def build_template_note(entry: Dict[str, Any]) -> str:
    """Deterministic fallback summary sentence."""
    if not entry.get("qualifies", True):
        cutoff = entry.get("cutoff")
        cutoff_str = f" > top {cutoff}" if cutoff is not None else ""
        return (
            f"Below cut-off (worst #{entry['worst_rank']}{cutoff_str}): "
            f"#{entry['r_1d']} on 1D, #{entry['r_1w']} on 1W, "
            f"#{entry['r_1m']} on 1M, #{entry['r_3m']} on 3M."
        )
    return (
        f"Best combined ranks: "
        f"#{entry['r_1d']} on 1D, #{entry['r_1w']} on 1W, "
        f"#{entry['r_1m']} on 1M, #{entry['r_3m']} on 3M."
    )


def _allowed_number_strings(entry: Dict[str, Any]) -> set:
    """Build all valid 0..2 decimal representations of input numbers."""
    raw_vals: List[float] = [
        float(entry["r_1d"]),
        float(entry["r_1w"]),
        float(entry["r_1m"]),
        float(entry["r_3m"]),
        float(entry["worst_rank"]),
        float(entry["med_1d"]),
        float(entry["med_1w"]),
        float(entry["med_1m"]),
        float(entry["med_3m"]),
        float(entry["n_20d_high"]),
        float(entry["n_20d_low"]),
        float(entry["n_eligible"]),
    ]
    if entry.get("pct_above_50dma") is not None:
        raw_vals.append(float(entry["pct_above_50dma"]))

    allowed: set = set()
    for v in raw_vals:
        av = abs(v)
        for fmt in (f"{av:.0f}", f"{av:.1f}", f"{av:.2f}"):
            allowed.add(fmt)
            if "." in fmt:
                allowed.add(fmt.rstrip("0").rstrip("."))
        # Also allow truncation/exact str
        allowed.add(str(int(av)))
    return allowed


def validate_gemini_note(text: str, entry: Dict[str, Any]) -> bool:
    """
    Validate Gemini output strictly before saving:
    - non-empty, <= 180 chars
    - no banned advisory/predictive words
    - group name appears unaltered
    - every standalone number in the sentence traces back to input numbers (0-2 decimals)
    """
    if not text or not isinstance(text, str):
        return False
    clean = " ".join(text.strip().split())
    if not clean or len(clean) > 180:
        return False
    if BANNED_NOTE_WORDS_RE.search(clean):
        return False

    label = str(entry.get("label") or "")
    if label and label not in clean:
        return False

    # Strip group label (in case group name contains a number, e.g. '2W') and standard timeframe/DMA tokens
    stripped = clean.replace(label, " ") if label else clean
    stripped = re.sub(r"\b(?:1D|1W|1M|3M|20D)\b", " ", stripped, flags=re.IGNORECASE)
    stripped = re.sub(r"\b50\s*-?\s*DMA\b", " ", stripped, flags=re.IGNORECASE)

    allowed = _allowed_number_strings(entry)
    for num_tok in re.findall(r"-?\d+(?:\.\d+)?", stripped):
        norm = num_tok.lstrip("-")
        if norm not in allowed:
            return False
    return True


def generate_note(
    entry: Dict[str, Any],
    http_post: Optional[Callable[..., Any]] = None,
    call_budget: Optional[List[int]] = None,
) -> Tuple[str, str]:
    """
    Generate one-sentence summary via Gemini (if GEMINI_API_KEY + GEMINI_MODEL are set)
    or deterministic template fallback. Never logs the API key.
    """
    template = build_template_note(entry)
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    model = (os.environ.get("GEMINI_MODEL") or "").strip()
    if not api_key or not model:
        return template, "template"
    if call_budget is not None:
        if call_budget[0] <= 0:
            return template, "template"
        call_budget[0] -= 1

    prompt = (
        "Write ONE plain sentence (at most 25 words) restating these numbers for an industry group. "
        "No advice, no prediction, no opinion, no reasons for the move. "
        "Use the exact group name unchanged and output only the sentence.\n"
        f"Group: {entry['label']} (level: {entry['level']})\n"
        f"Ranks: 1D #{entry['r_1d']}, 1W #{entry['r_1w']}, 1M #{entry['r_1m']}, 3M #{entry['r_3m']}\n"
        f"Medians (%): 1D {entry['med_1d']:+.2f}, 1W {entry['med_1w']:+.2f}, "
        f"1M {entry['med_1m']:+.2f}, 3M {entry['med_3m']:+.2f}\n"
        f"20D Highs/Lows: {entry['n_20d_high']} highs, {entry['n_20d_low']} lows; "
        f"Above 50 DMA: {entry['pct_above_50dma'] if entry['pct_above_50dma'] is not None else 'N/A'}%"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 80},
    }

    post_fn = http_post or requests.post
    for attempt in range(2):
        try:
            resp = post_fn(url, headers=headers, json=payload, timeout=GEMINI_TIMEOUT_SEC)
            if getattr(resp, "status_code", 0) == 200:
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                clean = " ".join(str(text).strip().split())
                if validate_gemini_note(clean, entry):
                    return clean, "gemini"
                return template, "template"
        except Exception:
            if attempt == 0:
                time.sleep(0.5)
                continue
    return template, "template"


def publish_top_groups(
    snapshot_date: Any,
    conn=None,
    generate_notes: bool = True,
    http_post: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """Compute and upsert industry_top_groups for `snapshot_date`, pruning > 30 days."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    snap_str = str(snapshot_date).split("T")[0]
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT g.group_id, g.level, g.label, s.universe,
                       s.n_eligible, s.median_1d, s.median_1w, s.median_1m, s.median_3m,
                       s.n_20d_high, s.n_20d_low, s.pct_above_50dma, s.rank_trend
                FROM daily_industry_strength s
                JOIN industry_groups g ON g.group_id = s.group_id
                WHERE s.trade_date = %s;
                """,
                (snap_str,),
            )
            fetched = cur.fetchall()

        buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        for r in fetched:
            key = (str(r[1]), str(r[3]))
            buckets.setdefault(key, []).append({
                "group_id": r[0],
                "level": r[1],
                "label": r[2],
                "universe": r[3],
                "n_eligible": r[4],
                "median_1d": r[5],
                "median_1w": r[6],
                "median_1m": r[7],
                "median_3m": r[8],
                "n_20d_high": r[9],
                "n_20d_low": r[10],
                "pct_above_50dma": r[11],
                "rank_trend": r[12],
            })

        budget = [MAX_GEMINI_CALLS_PER_RUN]
        gemini_accepted = 0
        template_count = 0
        insert_rows: List[Tuple[Any, ...]] = []

        for lvl in LEVELS:
            for univ in UNIVERSES:
                top = compute_top_groups_for_slice(buckets.get((lvl, univ), []), snap_str, lvl, univ)
                for item in top:
                    if generate_notes and item.get("qualifies", True):
                        note_text, note_source = generate_note(item, http_post=http_post, call_budget=budget)
                    else:
                        note_text, note_source = build_template_note(item), "template"
                    if note_source == "gemini":
                        gemini_accepted += 1
                    else:
                        template_count += 1
                    insert_rows.append((
                        snap_str, lvl, univ, item["pos"], item["group_id"],
                        item["r_1d"], item["r_1w"], item["r_1m"], item["r_3m"],
                        item["worst_rank"], item["mean_rank"],
                        item["med_1d"], item["med_1w"], item["med_1m"], item["med_3m"],
                        item["n_20d_high"], item["n_20d_low"],
                        item["pct_above_50dma"], item["n_eligible"],
                        note_text, note_source,
                        bool(item.get("qualifies", True)), item.get("cutoff"),
                    ))

        with conn.cursor() as cur:
            cur.execute("DELETE FROM industry_top_groups WHERE snapshot_date = %s;", (snap_str,))
            if insert_rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO industry_top_groups (
                        snapshot_date, level, universe, pos, group_id,
                        r_1d, r_1w, r_1m, r_3m, worst_rank, mean_rank,
                        med_1d, med_1w, med_1m, med_3m,
                        n_20d_high, n_20d_low, pct_above_50dma, n_eligible,
                        note_text, note_source, qualifies, cutoff
                    ) VALUES %s;
                    """,
                    insert_rows,
                    page_size=100,
                )
            cur.execute(
                "DELETE FROM industry_top_groups WHERE snapshot_date < (%s::date - INTERVAL '30 days');",
                (snap_str,),
            )
        conn.commit()
        logger.info(
            "Published %d top-group rows for %s (gemini_accepted=%d, template=%d).",
            len(insert_rows), snap_str, gemini_accepted, template_count,
        )
        return {
            "snapshot_date": snap_str,
            "rows": len(insert_rows),
            "gemini_accepted": gemini_accepted,
            "template_fallback": template_count,
        }
    finally:
        if should_close and conn:
            conn.close()


def backfill_top_groups(days: int = 30, conn=None, generate_notes_latest: bool = False) -> Dict[str, Any]:
    """Backfill industry_top_groups for the most recent `days` trading dates in daily_industry_strength."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT trade_date FROM daily_industry_strength ORDER BY trade_date DESC LIMIT %s;",
                (days,),
            )
            dates = [r[0] for r in cur.fetchall()]

        total_rows = 0
        for idx, d in enumerate(reversed(dates)):
            use_ai = generate_notes_latest and (idx == len(dates) - 1)
            res = publish_top_groups(d, conn=conn, generate_notes=use_ai)
            total_rows += res["rows"]
        return {"dates_processed": len(dates), "total_rows": total_rows}
    finally:
        if should_close and conn:
            conn.close()
