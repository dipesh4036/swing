"""
Tab 4: Daily Plan builder (P2 & P3).
Computes and stores market state, cap leadership, breakouts/Stage 2,
top 3 industries, deterministic candidate list, and constrained summary.
"""

import json
import logging
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np
import requests
from psycopg2.extras import execute_values

from pipeline.db import get_connection
from pipeline.industry_top_groups import BANNED_NOTE_WORDS_RE, GEMINI_TIMEOUT_SEC
from pipeline.plan_rules import (
    BREAKOUT_SCREENERS,
    CANDIDATE_MAX_OFF_52W_HIGH_PCT,
    CANDIDATE_MAX_PER_INDUSTRY,
    CANDIDATE_MAX_ROWS,
    CANDIDATE_MIN_RS_RATING,
    CANDIDATE_REQUIRED_STAGE,
    CANDIDATE_TOP_INDUSTRY_LEVEL,
    CANDIDATE_TOP_INDUSTRY_UNIVERSE,
    CAP_BENCHMARK,
    CAP_LEADER_MIN_GAP_PP,
    CAP_RETURN_LONG_SESSIONS,
    CAP_RETURN_SHORT_SESSIONS,
    CAP_SEGMENTS,
    FOLLOW_THROUGH_LOOKBACK_SESSIONS,
    FOLLOW_THROUGH_MIN_SAMPLE,
    MARKET_DELTA_LOOKBACK_SESSIONS,
    MARKET_STRONG_MIN_200SMA_PCT,
    MARKET_STRONG_MIN_50SMA_PCT,
    MARKET_STRONG_MIN_NET_20D,
    MARKET_UNIVERSE,
    MARKET_WEAK_MAX_200SMA_PCT,
    MARKET_WEAK_MAX_50SMA_PCT,
    PLAN_RETENTION_DAYS,
    PLAN_RULES_VERSION,
    PLAN_SUMMARY_MAX_CHARS,
    SCREENER_PRIORITY,
    STAGE2_UNIVERSES,
)

logger = logging.getLogger("pipeline.plan")


def evaluate_market_state(
    pct_50: Optional[float],
    pct_200: Optional[float],
    net_20d: Optional[int],
    pct_50_prev5: Optional[float] = None,
    as_of: Optional[str] = None,
) -> Dict[str, Any]:
    """Deterministic market posture from daily_market_breadth (nifty500)."""
    if pct_50 is None or pct_200 is None or net_20d is None:
        return {
            "status": "unavailable",
            "reason": "Missing pct_above_50sma, pct_above_200sma, or net_highs_20d for nifty500",
            "as_of": as_of,
        }

    p50 = round(float(pct_50), 2)
    p200 = round(float(pct_200), 2)
    net20 = int(net_20d)

    if p50 >= MARKET_STRONG_MIN_50SMA_PCT and p200 >= MARKET_STRONG_MIN_200SMA_PCT and net20 >= MARKET_STRONG_MIN_NET_20D:
        state = "Strong"
    elif p50 < MARKET_WEAK_MAX_50SMA_PCT or p200 < MARKET_WEAK_MAX_200SMA_PCT:
        state = "Weak"
    else:
        state = "Mixed"

    delta_5d = round(p50 - float(pct_50_prev5), 2) if pct_50_prev5 is not None else None
    return {
        "status": "available",
        "as_of": as_of,
        "universe": MARKET_UNIVERSE,
        "state": state,
        "pct_above_50sma": p50,
        "pct_above_200sma": p200,
        "net_highs_20d": net20,
        "delta_50sma_5d": delta_5d,
    }


def evaluate_cap_leadership(
    segments: List[Dict[str, Any]],
    benchmark: Optional[Dict[str, Any]] = None,
    as_of: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Determine cap leadership from 20-session returns across Large/Mid/Small.
    A segment leads only if best - runner_up >= CAP_LEADER_MIN_GAP_PP (1.0 pp).
    """
    valid_20d = [s for s in segments if s.get("ret_20d") is not None]
    if len(valid_20d) < 2:
        return {
            "status": "unavailable",
            "reason": "Insufficient index history for cap leadership",
            "as_of": as_of,
            "segments": segments,
            "benchmark": benchmark,
        }

    ranked = sorted(valid_20d, key=lambda s: float(s["ret_20d"]), reverse=True)
    gap = round(float(ranked[0]["ret_20d"]) - float(ranked[1]["ret_20d"]), 2)
    leader = ranked[0]["label"] if gap >= CAP_LEADER_MIN_GAP_PP else "no clear leader"

    return {
        "status": "available",
        "as_of": as_of,
        "leader": leader,
        "gap_pp": gap,
        "segments": segments,
        "benchmark": benchmark,
    }


def evaluate_follow_through(
    prior_breakouts: List[Tuple[int, Optional[float]]],
    latest_closes: Dict[int, float],
) -> Dict[str, Any]:
    """
    Of stage2_breakout picks from 5 sessions ago, compute share still >= pivot today.
    If sample n < 10, return 'too few to judge'.
    """
    valid = [(tok, piv) for tok, piv in prior_breakouts if piv is not None and piv > 0 and tok in latest_closes]
    n = len(valid)
    if n < FOLLOW_THROUGH_MIN_SAMPLE:
        return {
            "n": n,
            "holding_count": sum(1 for tok, piv in valid if latest_closes[tok] >= piv),
            "pct": None,
            "label": "too few to judge",
        }
    holding = sum(1 for tok, piv in valid if latest_closes[tok] >= piv)
    pct = round(holding / n * 100.0, 1)
    return {
        "n": n,
        "holding_count": holding,
        "pct": pct,
        "label": f"{pct:.1f}% ({holding}/{n})",
    }


def filter_and_order_candidates(
    stock_rows: List[Dict[str, Any]],
    top_industries: List[Dict[str, Any]],
    screener_hits_by_token: Dict[int, List[str]],
    max_per_industry: int = CANDIDATE_MAX_PER_INDUSTRY,
    hidden_by_industry_out: Optional[Dict[str, int]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Deterministic candidate filter (Block 5):
    - In today's top-3 industries (industry level, deduplicated)
    - rs_rating >= 70
    - stage == 2 (close > SMA150 and 20D SMA150 slope >= 1%)
    - is_liquid == True
    - pct_from_52w_high <= 25.0
    Ordered by screener hit priority, rs_rank desc, industry pos asc, symbol asc.
    Capped at max_per_industry (5) per industry and 20 rows total.
    """
    pos_by_label = {str(t["label"]): int(t["pos"]) for t in top_industries}
    if not pos_by_label:
        return [], 0

    matched: List[Dict[str, Any]] = []
    seen_tokens: set = set()
    for s in stock_rows:
        tok = int(s["token"])
        if tok in seen_tokens:
            continue
        ind_label = s.get("industry")
        if not ind_label or ind_label not in pos_by_label:
            continue
        if not s.get("is_liquid"):
            continue
        rs = s.get("rs_rating")
        if rs is None or float(rs) < CANDIDATE_MIN_RS_RATING:
            continue
        if int(s.get("stage") or 0) != CANDIDATE_REQUIRED_STAGE:
            continue
        off_hi = s.get("pct_from_52w_high")
        if off_hi is None or float(off_hi) > CANDIDATE_MAX_OFF_52W_HIGH_PCT:
            continue

        tok = int(s["token"])
        hits = screener_hits_by_token.get(tok, [])
        best_prio = min((SCREENER_PRIORITY[h] for h in hits if h in SCREENER_PRIORITY), default=99)
        ind_pos = pos_by_label[ind_label]

        reasons = [
            f"Stage 2",
            f"RS {round(float(rs))}",
            f"{ind_label} #{ind_pos}",
        ]
        if hits:
            reasons.extend(hits)

        seen_tokens.add(tok)
        matched.append({
            "token": tok,
            "symbol": str(s["symbol"]),
            "industry_label": ind_label,
            "level": CANDIDATE_TOP_INDUSTRY_LEVEL,
            "rs_rank": round(float(rs), 2),
            "stage": CANDIDATE_REQUIRED_STAGE,
            "screener_hits": hits,
            "reasons": reasons,
            "close": round(float(s["close"]), 2) if s.get("close") is not None else None,
            "ret_1d_pct": round(float(s["ret_1d_pct"]), 4) if s.get("ret_1d_pct") is not None else None,
            "pct_from_52w_high": round(float(off_hi), 4),
            "_prio": best_prio,
            "_ind_pos": ind_pos,
        })

    matched.sort(key=lambda r: (r["_prio"], -r["rs_rank"], r["_ind_pos"], r["symbol"]))
    total_matching = len(matched)

    total_per_ind: Dict[str, int] = {str(t["label"]): 0 for t in top_industries}
    shown_per_ind: Dict[str, int] = {str(t["label"]): 0 for t in top_industries}
    capped: List[Dict[str, Any]] = []

    for item in matched:
        ind_label = item["industry_label"]
        total_per_ind[ind_label] = total_per_ind.get(ind_label, 0) + 1
        if shown_per_ind.get(ind_label, 0) < max_per_industry and len(capped) < CANDIDATE_MAX_ROWS:
            capped.append(item)
            shown_per_ind[ind_label] = shown_per_ind.get(ind_label, 0) + 1

    if hidden_by_industry_out is not None:
        for lbl, tot in total_per_ind.items():
            hidden_by_industry_out[lbl] = max(0, tot - shown_per_ind.get(lbl, 0))

    for idx, item in enumerate(capped, start=1):
        item["rank"] = idx
        item.pop("_prio", None)
        item.pop("_ind_pos", None)
    return capped, total_matching


def _collect_plan_numbers(plan_payload: Dict[str, Any]) -> set:
    """Collect all numeric values from plan_payload (0-2 decimals) for P3 validation."""
    vals: List[float] = []

    def _walk(obj: Any):
        if isinstance(obj, bool) or obj is None:
            return
        if isinstance(obj, (int, float)):
            vals.append(abs(float(obj)))
        elif isinstance(obj, dict):
            for v in obj.values():
                _walk(v)
        elif isinstance(obj, list):
            for v in obj:
                _walk(v)

    _walk(plan_payload)
    allowed: set = set()
    for av in vals:
        for fmt in (f"{av:.0f}", f"{av:.1f}", f"{av:.2f}"):
            allowed.add(fmt)
            if "." in fmt:
                allowed.add(fmt.rstrip("0").rstrip("."))
        allowed.add(str(int(av)))
    return allowed


def build_plan_template_summary(plan_payload: Dict[str, Any]) -> str:
    """Deterministic template summary built solely from stored plan numbers."""
    mkt = plan_payload.get("market") or {}
    caps = plan_payload.get("caps") or {}
    brk = plan_payload.get("breakouts") or {}
    top_ind = plan_payload.get("top_industries") or {}
    tot_cand = int(plan_payload.get("total_candidates") or 0)

    parts: List[str] = []
    if mkt.get("status") == "available":
        parts.append(
            f"Market is {mkt['state']} ({mkt['pct_above_50sma']:.0f}% >50 SMA, {mkt['pct_above_200sma']:.0f}% >200 SMA, net 20D {mkt['net_highs_20d']:+d})."
        )
    else:
        parts.append("Market breadth is unavailable for this date.")

    if caps.get("status") == "available":
        parts.append(f"Cap leadership: {caps['leader']}.")

    top_names = [g["label"] for g in (top_ind.get("groups") or [])[:3]]
    if top_names:
        parts.append(f"Top industries: {', '.join(top_names)} ({tot_cand} candidates).")
    elif brk.get("status") == "available":
        s2_n = (brk.get("stage2_pct") or {}).get("nifty500")
        if s2_n is not None:
            parts.append(f"Nifty 500 Stage 2 share is {s2_n:.1f}% with {tot_cand} candidates.")

    return " ".join(parts)[:PLAN_SUMMARY_MAX_CHARS]


def validate_plan_summary(text: str, plan_payload: Dict[str, Any]) -> bool:
    """Validate Gemini summary: <= 400 chars, <= 3 sentences, 0 banned words, traceable numbers."""
    if not text or not isinstance(text, str):
        return False
    clean = " ".join(text.strip().split())
    if not clean or len(clean) > PLAN_SUMMARY_MAX_CHARS:
        return False
    if BANNED_NOTE_WORDS_RE.search(clean):
        return False

    stripped = re.sub(r"\b(?:1D|1W|1M|3M|5D|20D|50\s*-?\s*DMA|50\s*-?\s*SMA|200\s*-?\s*SMA|52W|Stage\s*2|Nifty\s*50|Nifty\s*100|Nifty\s*500|Midcap\s*150|Smallcap\s*250|Top\s*3)\b", " ", clean, flags=re.IGNORECASE)
    allowed = _collect_plan_numbers(plan_payload)
    for tok in re.findall(r"-?\d+(?:\.\d+)?", stripped):
        if tok.lstrip("-") not in allowed:
            return False
    return True


def generate_plan_summary(
    plan_payload: Dict[str, Any],
    http_post: Optional[Callable[..., Any]] = None,
) -> Tuple[str, str]:
    """One optional Gemini call per daily plan; falls back to template on any error/violation."""
    template = build_plan_template_summary(plan_payload)
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    model = (os.environ.get("GEMINI_MODEL") or "").strip()
    if not api_key or not model:
        return template, "template"

    prompt = (
        "Write at most 3 short plain sentences (max 400 chars total) restating these daily market numbers. "
        "No advice, no prediction, no reasons for moves, no buy/sell/target/stop/entry/signal/score words. "
        "Output only the sentences.\n"
        f"Data: {json.dumps(plan_payload, default=str)}"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
    body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.1, "maxOutputTokens": 140}}

    post_fn = http_post or requests.post
    for attempt in range(2):
        try:
            resp = post_fn(url, headers=headers, json=body, timeout=GEMINI_TIMEOUT_SEC)
            if getattr(resp, "status_code", 0) == 200:
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                clean = " ".join(str(text).strip().split())
                if validate_plan_summary(clean, plan_payload):
                    return clean, "gemini"
                return template, "template"
        except Exception:
            if attempt == 0:
                time.sleep(0.5)
                continue
    return template, "template"


def _compute_stage2_tokens_at_date(cur, target_date: str, candidate_tokens: List[int]) -> Dict[int, int]:
    """Compute Weinstein Stage 2 (1 or 0) as of target_date using stock_candles (no look-ahead)."""
    if not candidate_tokens:
        return {}
    cur.execute(
        """
        SELECT token, close
        FROM stock_candles
        WHERE token = ANY(%s) AND trade_date <= %s
        ORDER BY token, trade_date ASC;
        """,
        (candidate_tokens, target_date),
    )
    series: Dict[int, List[float]] = {}
    for tok, cl in cur.fetchall():
        if cl is not None:
            series.setdefault(int(tok), []).append(float(cl))

    stages: Dict[int, int] = {}
    for tok, closes in series.items():
        if len(closes) < 170:
            stages[tok] = 0
            continue
        arr = np.asarray(closes, dtype=np.float64)
        sma150_now = float(np.mean(arr[-150:]))
        sma150_prev20 = float(np.mean(arr[-170:-20]))
        slope = ((sma150_now - sma150_prev20) / sma150_prev20 * 100.0) if sma150_prev20 > 0 else 0.0
        stages[tok] = 2 if (slope >= 1.0 and closes[-1] > sma150_now) else 0
    return stages


def build_daily_plan(
    trade_date: Optional[str] = None,
    conn=None,
    generate_summary: bool = True,
    http_post: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """
    Build and store daily_plan + daily_plan_candidates for `trade_date` (or latest market breadth date).
    Uses ONLY data <= trade_date (no look-ahead).
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            if trade_date is None:
                cur.execute("SELECT MAX(trade_date)::text FROM daily_market_breadth WHERE universe = %s;", (MARKET_UNIVERSE,))
                trade_date = cur.fetchone()[0]
            if not trade_date:
                raise ValueError("No daily_market_breadth data found")
            plan_date = str(trade_date).split("T")[0]

            # 1. Market State
            cur.execute(
                """
                SELECT trade_date::text, pct_above_50sma, pct_above_200sma, net_highs_20d
                FROM daily_market_breadth
                WHERE universe = %s AND trade_date <= %s
                ORDER BY trade_date DESC
                LIMIT 6;
                """,
                (MARKET_UNIVERSE, plan_date),
            )
            mkt_rows = cur.fetchall()
            if mkt_rows and mkt_rows[0][0].split("T")[0] == plan_date:
                prev5 = mkt_rows[MARKET_DELTA_LOOKBACK_SESSIONS][1] if len(mkt_rows) > MARKET_DELTA_LOOKBACK_SESSIONS else None
                market_block = evaluate_market_state(
                    mkt_rows[0][1], mkt_rows[0][2], mkt_rows[0][3], prev5, as_of=plan_date
                )
            else:
                market_block = evaluate_market_state(None, None, None, as_of=mkt_rows[0][0].split("T")[0] if mkt_rows else None)

            # 2. Cap Leadership
            def _fetch_cap_item(spec: Dict[str, str]) -> Dict[str, Any]:
                cur.execute(
                    """
                    SELECT close FROM daily_index_ohlcv
                    WHERE index_name = %s AND trade_date <= %s
                    ORDER BY trade_date DESC LIMIT 21;
                    """,
                    (spec["index_name"], plan_date),
                )
                closes = [float(r[0]) for r in cur.fetchall() if r[0] is not None]
                r5 = round((closes[0] / closes[CAP_RETURN_SHORT_SESSIONS] - 1.0) * 100.0, 2) if len(closes) > CAP_RETURN_SHORT_SESSIONS and closes[CAP_RETURN_SHORT_SESSIONS] > 0 else None
                r20 = round((closes[0] / closes[CAP_RETURN_LONG_SESSIONS] - 1.0) * 100.0, 2) if len(closes) > CAP_RETURN_LONG_SESSIONS and closes[CAP_RETURN_LONG_SESSIONS] > 0 else None
                cur.execute(
                    """
                    SELECT pct_above_50sma FROM daily_market_breadth
                    WHERE universe = %s AND trade_date <= %s
                    ORDER BY trade_date DESC LIMIT 1;
                    """,
                    (spec["breadth_universe"], plan_date),
                )
                b_row = cur.fetchone()
                p50 = round(float(b_row[0]), 2) if b_row and b_row[0] is not None else None
                return {
                    "key": spec["key"],
                    "label": spec["label"],
                    "index_name": spec["index_name"],
                    "breadth_universe": spec["breadth_universe"],
                    "ret_5d": r5,
                    "ret_20d": r20,
                    "pct_above_50sma": p50,
                }

            cap_segments = [_fetch_cap_item(s) for s in CAP_SEGMENTS]
            cap_bench = _fetch_cap_item(CAP_BENCHMARK)
            caps_block = evaluate_cap_leadership(cap_segments, benchmark=cap_bench, as_of=plan_date)

            # 3. Breakouts & Stage 2
            cur.execute(
                """
                SELECT DISTINCT trade_date::text
                FROM daily_screener_results
                WHERE trade_date <= %s
                ORDER BY trade_date DESC
                LIMIT 6;
                """,
                (plan_date,),
            )
            scr_dates = [r[0].split("T")[0] for r in cur.fetchall()]
            if scr_dates and scr_dates[0] == plan_date:
                d0 = scr_dates[0]
                d1 = scr_dates[1] if len(scr_dates) > 1 else None
                d5 = scr_dates[5] if len(scr_dates) > 5 else None

                counts: Dict[str, Dict[str, Optional[int]]] = {}
                for scr in BREAKOUT_SCREENERS:
                    row_c: Dict[str, Optional[int]] = {"today": 0, "prev_1d": None, "prev_5d": None}
                    cur.execute("SELECT count(*) FROM daily_screener_results WHERE trade_date = %s AND screener = %s;", (d0, scr))
                    row_c["today"] = int(cur.fetchone()[0])
                    if d1:
                        cur.execute("SELECT count(*) FROM daily_screener_results WHERE trade_date = %s AND screener = %s;", (d1, scr))
                        row_c["prev_1d"] = int(cur.fetchone()[0])
                    if d5:
                        cur.execute("SELECT count(*) FROM daily_screener_results WHERE trade_date = %s AND screener = %s;", (d5, scr))
                        row_c["prev_5d"] = int(cur.fetchone()[0])
                    counts[scr] = row_c

                s2_pct: Dict[str, Optional[float]] = {}
                for u in STAGE2_UNIVERSES:
                    cur.execute(
                        "SELECT weinstein_stage_2_pct FROM daily_market_breadth WHERE universe = %s AND trade_date = %s;",
                        (u, plan_date),
                    )
                    r = cur.fetchone()
                    s2_pct[u] = round(float(r[0]), 2) if r and r[0] is not None else None

                follow_through = {"n": 0, "holding_count": 0, "pct": None, "label": "too few to judge"}
                if d5:
                    cur.execute(
                        "SELECT token, pivot FROM daily_screener_results WHERE trade_date = %s AND screener = 'stage2_breakout';",
                        (d5,),
                    )
                    prior_bo = [(int(r[0]), float(r[1]) if r[1] is not None else None) for r in cur.fetchall()]
                    if prior_bo:
                        toks = [t for t, _ in prior_bo]
                        cur.execute(
                            """
                            SELECT DISTINCT ON (token) token, close
                            FROM stock_candles
                            WHERE token = ANY(%s) AND trade_date <= %s
                            ORDER BY token, trade_date DESC;
                            """,
                            (toks, plan_date),
                        )
                        latest_cl = {int(r[0]): float(r[1]) for r in cur.fetchall() if r[1] is not None}
                        follow_through = evaluate_follow_through(prior_bo, latest_cl)

                breakouts_block = {
                    "status": "available",
                    "as_of": plan_date,
                    "counts": counts,
                    "stage2_pct": s2_pct,
                    "follow_through": follow_through,
                }
            else:
                breakouts_block = {
                    "status": "unavailable",
                    "reason": f"No daily_screener_results for {plan_date}",
                    "as_of": scr_dates[0] if scr_dates else None,
                }

            # 4. Top 3 Industries (use plan_date, or latest available snapshot <= plan_date)
            cur.execute(
                """
                SELECT MAX(snapshot_date)::text
                FROM industry_top_groups
                WHERE snapshot_date <= %s AND level = %s AND universe = %s;
                """,
                (plan_date, CANDIDATE_TOP_INDUSTRY_LEVEL, CANDIDATE_TOP_INDUSTRY_UNIVERSE),
            )
            src_row = cur.fetchone()
            industry_source_date = str(src_row[0]).split("T")[0] if src_row and src_row[0] else None

            tg_rows = []
            if industry_source_date:
                cur.execute(
                    """
                    SELECT t.pos, t.group_id, g.label, g.sector_label, g.parent_id, g.full_path,
                           t.r_1d, t.r_1w, t.r_1m, t.r_3m, t.worst_rank, t.mean_rank,
                           t.med_1d, t.med_1w, t.med_1m, t.med_3m,
                           t.n_20d_high, t.n_20d_low, t.pct_above_50dma, t.n_eligible,
                           t.note_text, t.note_source
                    FROM industry_top_groups t
                    JOIN industry_groups g ON g.group_id = t.group_id
                    WHERE t.snapshot_date = %s AND t.level = %s AND t.universe = %s
                    ORDER BY t.pos ASC;
                    """,
                    (industry_source_date, CANDIDATE_TOP_INDUSTRY_LEVEL, CANDIDATE_TOP_INDUSTRY_UNIVERSE),
                )
                tg_rows = cur.fetchall()
            top_groups_list = [
                {
                    "pos": int(r[0]),
                    "groupId": str(r[1]),
                    "label": str(r[2]),
                    "sectorLabel": str(r[3]) if r[3] else None,
                    "parentId": str(r[4]) if r[4] else None,
                    "fullPath": str(r[5]),
                    "r1d": int(r[6]),
                    "r1w": int(r[7]),
                    "r1m": int(r[8]),
                    "r3m": int(r[9]),
                    "worstRank": int(r[10]),
                    "meanRank": float(r[11]),
                    "med1d": float(r[12]),
                    "med1w": float(r[13]),
                    "med1m": float(r[14]),
                    "med3m": float(r[15]),
                    "n20dHigh": int(r[16]),
                    "n20dLow": int(r[17]),
                    "pctAbove50dma": float(r[18]) if r[18] is not None else None,
                    "nEligible": int(r[19]),
                    "noteText": str(r[20]),
                    "noteSource": str(r[21]),
                    "hiddenCandidates": 0,
                }
                for r in tg_rows
            ]
            if top_groups_list and industry_source_date:
                top_industries_block = {
                    "status": "available",
                    "as_of": industry_source_date,
                    "level": CANDIDATE_TOP_INDUSTRY_LEVEL,
                    "universe": CANDIDATE_TOP_INDUSTRY_UNIVERSE,
                    "groups": top_groups_list,
                }
            else:
                top_industries_block = {
                    "status": "unavailable",
                    "reason": f"No industry_top_groups rows on or before {plan_date}",
                    "as_of": None,
                    "level": CANDIDATE_TOP_INDUSTRY_LEVEL,
                    "universe": CANDIDATE_TOP_INDUSTRY_UNIVERSE,
                    "groups": [],
                }

            # 5. Final Candidates (using same industry_source_date consistently)
            candidates: List[Dict[str, Any]] = []
            total_candidates = 0
            if top_groups_list and industry_source_date:
                top_labels = [g["label"] for g in top_groups_list]
                cur.execute(
                    """
                    SELECT m.token, m.symbol, m.industry, m.is_liquid, m.rs_rating,
                           m.pct_from_52w_high, m.close, m.ret_1d
                    FROM latest_industry_stock_metrics m
                    WHERE m.snapshot_id = (
                        SELECT s.snapshot_id FROM industry_snapshots s
                        WHERE s.status = 'completed' AND s.trade_date = %s
                          AND EXISTS (SELECT 1 FROM latest_industry_stock_metrics m2 WHERE m2.snapshot_id = s.snapshot_id)
                        ORDER BY s.completed_at DESC
                        LIMIT 1
                    ) AND m.industry = ANY(%s);
                    """,
                    (industry_source_date, top_labels),
                )
                m_rows = cur.fetchall()
                stock_rows: List[Dict[str, Any]] = []
                if m_rows:
                    toks = [int(r[0]) for r in m_rows]
                    stages = _compute_stage2_tokens_at_date(cur, industry_source_date, toks)
                    for r in m_rows:
                        tok = int(r[0])
                        stock_rows.append({
                            "token": tok,
                            "symbol": r[1],
                            "industry": r[2],
                            "is_liquid": bool(r[3]),
                            "rs_rating": float(r[4]) if r[4] is not None else None,
                            "pct_from_52w_high": float(r[5]) if r[5] is not None else None,
                            "close": float(r[6]) if r[6] is not None else None,
                            "ret_1d_pct": float(r[7]) if r[7] is not None else None,
                            "stage": stages.get(tok, 0),
                        })

                cur.execute(
                    """
                    SELECT token, array_agg(screener ORDER BY screener)
                    FROM daily_screener_results
                    WHERE trade_date = %s
                    GROUP BY token;
                    """,
                    (plan_date,),
                )
                hits_map = {int(r[0]): list(r[1]) for r in cur.fetchall()}
                hidden_by_industry: Dict[str, int] = {}
                candidates, total_candidates = filter_and_order_candidates(
                    stock_rows,
                    top_groups_list,
                    hits_map,
                    hidden_by_industry_out=hidden_by_industry,
                )
                for g in top_groups_list:
                    g["hiddenCandidates"] = int(hidden_by_industry.get(g["label"], 0))

            summary_payload = {
                "plan_date": plan_date,
                "market": market_block,
                "caps": caps_block,
                "breakouts": breakouts_block,
                "top_industries": top_industries_block,
                "total_candidates": total_candidates,
            }
            if generate_summary:
                summary_text, summary_source = generate_plan_summary(summary_payload, http_post=http_post)
            else:
                summary_text, summary_source = build_plan_template_summary(summary_payload), "template"

            cur.execute(
                """
                INSERT INTO daily_plan (
                    plan_date, market, caps, breakouts, top_industries,
                    total_candidates, summary_text, summary_source, rules_version, generated_at
                ) VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s, %s, NOW())
                ON CONFLICT (plan_date) DO UPDATE SET
                    market = EXCLUDED.market,
                    caps = EXCLUDED.caps,
                    breakouts = EXCLUDED.breakouts,
                    top_industries = EXCLUDED.top_industries,
                    total_candidates = EXCLUDED.total_candidates,
                    summary_text = EXCLUDED.summary_text,
                    summary_source = EXCLUDED.summary_source,
                    rules_version = EXCLUDED.rules_version,
                    generated_at = NOW();
                """,
                (
                    plan_date,
                    json.dumps(market_block),
                    json.dumps(caps_block),
                    json.dumps(breakouts_block),
                    json.dumps(top_industries_block),
                    total_candidates,
                    summary_text,
                    summary_source,
                    PLAN_RULES_VERSION,
                ),
            )
            cur.execute("DELETE FROM daily_plan_candidates WHERE plan_date = %s;", (plan_date,))
            if candidates:
                execute_values(
                    cur,
                    """
                    INSERT INTO daily_plan_candidates (
                        plan_date, rank, token, symbol, industry_label, level,
                        rs_rank, stage, screener_hits, reasons, close, ret_1d_pct, pct_from_52w_high
                    ) VALUES %s;
                    """,
                    [
                        (
                            plan_date, c["rank"], c["token"], c["symbol"], c["industry_label"], c["level"],
                            c["rs_rank"], c["stage"], c["screener_hits"], c["reasons"],
                            c["close"], c["ret_1d_pct"], c["pct_from_52w_high"],
                        )
                        for c in candidates
                    ],
                )
            cur.execute(
                "DELETE FROM daily_plan WHERE plan_date < (%s::date - (%s || ' days')::interval);",
                (plan_date, PLAN_RETENTION_DAYS),
            )
        conn.commit()
        logger.info(
            "Built daily_plan for %s: market=%s, leader=%s, candidates=%d/%d, summary=%s",
            plan_date,
            market_block.get("state", "unavailable"),
            caps_block.get("leader", "unavailable"),
            len(candidates),
            total_candidates,
            summary_source,
        )
        return {
            "plan_date": plan_date,
            "market_state": market_block.get("state"),
            "cap_leader": caps_block.get("leader"),
            "candidates_stored": len(candidates),
            "total_candidates": total_candidates,
            "summary_source": summary_source,
        }
    finally:
        if should_close and conn:
            conn.close()


def backfill_daily_plan(days: int = 30, conn=None) -> Dict[str, Any]:
    """Backfill daily_plan for the most recent `days` dates in daily_market_breadth (no look-ahead)."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT trade_date::text FROM daily_market_breadth WHERE universe = %s ORDER BY trade_date DESC LIMIT %s;",
                (MARKET_UNIVERSE, days),
            )
            dates = [r[0].split("T")[0] for r in cur.fetchall()]

        results = []
        for idx, d in enumerate(reversed(dates)):
            use_ai = idx == len(dates) - 1
            results.append(build_daily_plan(trade_date=d, conn=conn, generate_summary=use_ai))
        return {"dates_processed": len(results), "latest": results[-1] if results else None}
    finally:
        if should_close and conn:
            conn.close()
