"""
Tab 5: Track Record outcomes & control selection (T1).
Computes realised 1/5/10/20 trading-session forward returns vs NIFTY 500,
stores them idempotently in plan_outcomes / plan_outcomes_control, and
provides deterministic forward-only control selection + 120-session backfill.
"""

import hashlib
import logging
import random
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

from psycopg2.extras import execute_values

from pipeline.db import get_connection
from pipeline.plan_rules import (
    CANDIDATE_MAX_OFF_52W_HIGH_PCT,
    CANDIDATE_MIN_RS_RATING,
    CANDIDATE_REQUIRED_STAGE,
    CONTROL_GROUP_NAME,
    CONTROL_MAX_PER_INDUSTRY,
    CONTROL_MAX_ROWS,
    OUTCOME_BENCHMARK_INDEX,
    OUTCOME_HORIZONS,
    OUTCOME_RETENTION_DAYS,
    OUTCOME_SPLIT_JUMP_PCT,
    PLAN_RULES_VERSION,
)

logger = logging.getLogger("pipeline.plan_outcomes")


def select_control_candidates(
    stock_rows: List[Dict[str, Any]],
    top_industries: List[Dict[str, Any]],
    plan_date: str,
    max_per_industry: int = CONTROL_MAX_PER_INDUSTRY,
    max_rows: int = CONTROL_MAX_ROWS,
) -> List[Dict[str, Any]]:
    """
    Reproducibly select up to 20 'same_filter_any_industry' control names:
    passes Stage 2, RS >= 70, liquid, <= 25% off 52W high, NOT in Top-3 industries,
    shuffled with fixed seed hash(plan_date), capped at 5 per industry.
    """
    top_labels = {str(t["label"]) for t in top_industries}
    eligible: List[Dict[str, Any]] = []
    seen_tokens: set = set()
    for s in stock_rows:
        tok = int(s["token"])
        if tok in seen_tokens:
            continue
        ind_label = s.get("industry")
        if not ind_label or ind_label in top_labels:
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
        seen_tokens.add(tok)
        eligible.append({
            "token": tok,
            "symbol": str(s["symbol"]),
            "industry_label": str(ind_label),
            "group_name": CONTROL_GROUP_NAME,
        })

    # Sort deterministically first, then shuffle with fixed sha256(plan_date) seed
    eligible.sort(key=lambda r: (r["token"], r["symbol"]))
    seed_int = int(hashlib.sha256(plan_date.encode("utf-8")).hexdigest(), 16)
    rng = random.Random(seed_int)
    rng.shuffle(eligible)

    per_ind: Dict[str, int] = {}
    selected: List[Dict[str, Any]] = []
    for item in eligible:
        ind = item["industry_label"]
        if per_ind.get(ind, 0) >= max_per_industry:
            continue
        per_ind[ind] = per_ind.get(ind, 0) + 1
        selected.append(item)
        if len(selected) >= max_rows:
            break
    return selected


def select_filter_only_candidates(
    stock_rows: List[Dict[str, Any]],
    top_industries: List[Dict[str, Any]],
    max_per_industry: int = CONTROL_MAX_PER_INDUSTRY,
    max_rows: int = CONTROL_MAX_ROWS,
) -> List[Dict[str, Any]]:
    """
    Screener-independent candidate set ('filter_only') for B3 Track Record:
    same filter (qualifying industry, Stage 2, RS >= 70, liquid, <= 25% off 52W high),
    ordered by RS desc then symbol asc, capped at 5 per industry and 20 total.
    """
    top_labels = {str(t["label"]) for t in top_industries}
    eligible: List[Dict[str, Any]] = []
    seen: set = set()
    for s in stock_rows:
        tok = int(s["token"])
        if tok in seen:
            continue
        ind = s.get("industry")
        if not ind or ind not in top_labels:
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
        seen.add(tok)
        eligible.append({
            "token": tok,
            "symbol": str(s["symbol"]),
            "industry_label": str(ind),
            "rs_rating": float(rs),
        })

    eligible.sort(key=lambda r: (-r["rs_rating"], r["symbol"]))
    per_ind: Dict[str, int] = {}
    selected: List[Dict[str, Any]] = []
    for item in eligible:
        ind = item["industry_label"]
        if per_ind.get(ind, 0) >= max_per_industry:
            continue
        per_ind[ind] = per_ind.get(ind, 0) + 1
        selected.append(item)
        if len(selected) >= max_rows:
            break
    return selected


def select_top_industries_any_stock(
    stock_rows: List[Dict[str, Any]],
    top_industries: List[Dict[str, Any]],
    plan_date: str,
    max_per_industry: int = CONTROL_MAX_PER_INDUSTRY,
    max_rows: int = CONTROL_MAX_ROWS,
) -> List[Dict[str, Any]]:
    """
    B4 control: ALL liquid stocks in the qualifying top-3 industries (no Stage 2, no RS filter),
    shuffled deterministically with sha256(plan_date) and capped at 5 per industry, 20 total.
    """
    top_labels = {str(t["label"]) for t in top_industries}
    eligible: List[Dict[str, Any]] = []
    seen: set = set()
    for s in stock_rows:
        tok = int(s["token"])
        if tok in seen:
            continue
        ind = s.get("industry")
        if not ind or ind not in top_labels:
            continue
        if not s.get("is_liquid"):
            continue
        seen.add(tok)
        eligible.append({
            "token": tok,
            "symbol": str(s["symbol"]),
            "industry_label": str(ind),
            "group_name": "top_industries_any_stock",
        })

    eligible.sort(key=lambda r: (r["token"], r["symbol"]))
    seed_int = int(hashlib.sha256(f"{plan_date}:top_any".encode("utf-8")).hexdigest(), 16)
    rng = random.Random(seed_int)
    rng.shuffle(eligible)

    per_ind: Dict[str, int] = {}
    selected: List[Dict[str, Any]] = []
    for item in eligible:
        ind = item["industry_label"]
        if per_ind.get(ind, 0) >= max_per_industry:
            continue
        per_ind[ind] = per_ind.get(ind, 0) + 1
        selected.append(item)
        if len(selected) >= max_rows:
            break
    return selected


def compute_outcome_row(
    plan_date: str,
    token: int,
    symbol: str,
    industry_label: str,
    rules_version: str,
    source: str,
    horizon: int,
    trading_days: Sequence[str],
    stock_candles_by_date: Dict[str, Dict[str, Optional[float]]],
    bench_by_date: Dict[str, Dict[str, Optional[float]]],
    split_jump_pct: float = OUTCOME_SPLIT_JUMP_PCT,
) -> Optional[Dict[str, Any]]:
    """
    Compute one outcome row for (plan_date, token, horizon).
    Returns None if horizon has NOT yet matured in trading_days.
    Returns status='missing' if matured in trading_days but token/benchmark candle missing or split jump detected.
    """
    try:
        idx = trading_days.index(plan_date)
    except ValueError:
        return None

    if idx + horizon >= len(trading_days):
        return None

    d_next = trading_days[idx + 1]
    fwd_date = trading_days[idx + horizon]

    c_base = stock_candles_by_date.get(plan_date)
    c_next = stock_candles_by_date.get(d_next)
    c_fwd = stock_candles_by_date.get(fwd_date)

    base_close = c_base.get("close") if c_base else None
    base_open_next = c_next.get("open") if c_next else None
    fwd_close = c_fwd.get("close") if c_fwd else None

    def _missing(reason: str) -> Dict[str, Any]:
        return {
            "plan_date": plan_date,
            "token": token,
            "symbol": symbol,
            "industry_label": industry_label,
            "rules_version": rules_version,
            "source": source,
            "horizon": horizon,
            "base_close": round(base_close, 2) if base_close is not None else None,
            "base_open_next": round(base_open_next, 2) if base_open_next is not None else None,
            "fwd_date": fwd_date,
            "fwd_close": round(fwd_close, 2) if fwd_close is not None else None,
            "ret_from_close_pct": None,
            "ret_from_open_pct": None,
            "bench_ret_from_close_pct": None,
            "bench_ret_from_open_pct": None,
            "excess_from_close_pct": None,
            "excess_from_open_pct": None,
            "status": "missing",
            "missing_reason": reason,
        }

    if (
        base_close is None or base_close <= 0
        or base_open_next is None or base_open_next <= 0
        or fwd_close is None or fwd_close <= 0
    ):
        return _missing("missing_candle")

    # Detect unadjusted split-like 1-day jump (> ±40%) on any session in (plan_date, fwd_date]
    prev_c = base_close
    for step in range(1, horizon + 1):
        d_step = trading_days[idx + step]
        c_step = stock_candles_by_date.get(d_step)
        if not c_step or c_step.get("close") is None or c_step["close"] <= 0:
            return _missing("missing_candle")
        curr_c = float(c_step["close"])
        day_move_pct = abs(curr_c / prev_c - 1.0) * 100.0
        if day_move_pct > split_jump_pct:
            return _missing("split_or_corporate_action")
        prev_c = curr_c

    b_base = bench_by_date.get(plan_date)
    b_next = bench_by_date.get(d_next)
    b_fwd = bench_by_date.get(fwd_date)
    if not b_base or not b_next or not b_fwd:
        return _missing("missing_benchmark")

    b_close_base = b_base.get("close")
    b_open_next = b_next.get("open") if (b_next.get("open") is not None and b_next["open"] > 0) else b_next.get("close")
    b_close_fwd = b_fwd.get("close")
    if (
        b_close_base is None or b_close_base <= 0
        or b_open_next is None or b_open_next <= 0
        or b_close_fwd is None or b_close_fwd <= 0
    ):
        return _missing("missing_benchmark")

    ret_close = (fwd_close / base_close - 1.0) * 100.0
    ret_open = (fwd_close / base_open_next - 1.0) * 100.0
    bench_close = (b_close_fwd / b_close_base - 1.0) * 100.0
    bench_open = (b_close_fwd / b_open_next - 1.0) * 100.0

    return {
        "plan_date": plan_date,
        "token": token,
        "symbol": symbol,
        "industry_label": industry_label,
        "rules_version": rules_version,
        "source": source,
        "horizon": horizon,
        "base_close": round(base_close, 2),
        "base_open_next": round(base_open_next, 2),
        "fwd_date": fwd_date,
        "fwd_close": round(fwd_close, 2),
        "ret_from_close_pct": round(ret_close, 4),
        "ret_from_open_pct": round(ret_open, 4),
        "bench_ret_from_close_pct": round(bench_close, 4),
        "bench_ret_from_open_pct": round(bench_open, 4),
        "excess_from_close_pct": round(ret_close - bench_close, 4),
        "excess_from_open_pct": round(ret_open - bench_open, 4),
        "status": "matured",
        "missing_reason": None,
    }


def compute_plan_outcomes(
    as_of: Optional[str] = None,
    default_source: str = "live",
    candidate_set: Optional[str] = None,
    method: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fill every matured (plan_date, token, horizon, candidate_set) in plan_outcomes and plan_outcomes_control.
    Idempotent upsert; preserves existing 'live' source.
    """
    eff_cset = candidate_set or ("filter_only" if default_source == "backfill" else "displayed")
    eff_method = method or ("live_v1" if default_source == "live" else "backfill_v1")
    with get_connection() as conn:
        with conn.cursor() as cur:
            if as_of:
                cur.execute(
                    "SELECT trade_date::text FROM trading_days WHERE trade_date <= %s ORDER BY trade_date ASC;",
                    (as_of,),
                )
            else:
                cur.execute("SELECT trade_date::text FROM trading_days ORDER BY trade_date ASC;")
            trading_days = [str(r[0]).split("T")[0] for r in cur.fetchall()]
            if not trading_days:
                return {"status": "skipped", "reason": "no_trading_days"}

            effective_as_of = as_of or trading_days[-1]
            cur.execute(
                """
                SELECT trade_date::text, open::float, close::float
                FROM daily_index_ohlcv
                WHERE index_name = %s AND trade_date <= %s
                ORDER BY trade_date ASC;
                """,
                (OUTCOME_BENCHMARK_INDEX, effective_as_of),
            )
            bench_by_date: Dict[str, Dict[str, Optional[float]]] = {
                str(r[0]).split("T")[0]: {"open": r[1], "close": r[2]} for r in cur.fetchall()
            }

            # Load candidate pairs (plan_date, token, symbol, industry_label, rules_version)
            cur.execute(
                """
                SELECT c.plan_date::text, c.token, c.symbol, c.industry_label, p.rules_version
                FROM daily_plan_candidates c
                JOIN daily_plan p ON p.plan_date = c.plan_date
                WHERE c.plan_date <= %s
                ORDER BY c.plan_date ASC, c.rank ASC;
                """,
                (effective_as_of,),
            )
            cand_items = [
                {
                    "plan_date": str(r[0]).split("T")[0],
                    "token": int(r[1]),
                    "symbol": str(r[2]),
                    "industry_label": str(r[3]),
                    "rules_version": str(r[4]),
                }
                for r in cur.fetchall()
            ]

            # Load control pairs
            cur.execute(
                """
                SELECT plan_date::text, token, symbol, industry_label, group_name, rules_version
                FROM plan_control
                WHERE plan_date <= %s
                ORDER BY plan_date ASC, token ASC;
                """,
                (effective_as_of,),
            )
            ctrl_items = [
                {
                    "plan_date": str(r[0]).split("T")[0],
                    "token": int(r[1]),
                    "symbol": str(r[2]),
                    "industry_label": str(r[3]),
                    "group_name": str(r[4]),
                    "rules_version": str(r[5]),
                }
                for r in cur.fetchall()
            ]

            all_tokens = sorted({x["token"] for x in cand_items} | {x["token"] for x in ctrl_items})
            candles_by_tok: Dict[int, Dict[str, Dict[str, Optional[float]]]] = {}
            if all_tokens:
                min_date = min([x["plan_date"] for x in cand_items + ctrl_items])
                cur.execute(
                    """
                    SELECT token, trade_date::text, open::float, close::float
                    FROM stock_candles
                    WHERE token = ANY(%s) AND trade_date >= %s AND trade_date <= %s;
                    """,
                    (all_tokens, min_date, effective_as_of),
                )
                for tok, td, op, cl in cur.fetchall():
                    candles_by_tok.setdefault(int(tok), {})[str(td).split("T")[0]] = {
                        "open": op,
                        "close": cl,
                    }

            cand_rows: List[Tuple[Any, ...]] = []
            matured_cands = 0
            missing_cands = 0
            split_cands = 0
            for item in cand_items:
                tok_map = candles_by_tok.get(item["token"], {})
                for h in OUTCOME_HORIZONS:
                    out = compute_outcome_row(
                        item["plan_date"],
                        item["token"],
                        item["symbol"],
                        item["industry_label"],
                        item["rules_version"],
                        default_source,
                        h,
                        trading_days,
                        tok_map,
                        bench_by_date,
                    )
                    if out is None:
                        continue
                    if out["status"] == "matured":
                        matured_cands += 1
                    else:
                        missing_cands += 1
                        if out["missing_reason"] == "split_or_corporate_action":
                            split_cands += 1
                    cand_rows.append((
                        out["plan_date"], out["token"], out["symbol"], out["industry_label"],
                        out["rules_version"], out["source"], out["horizon"],
                        eff_cset, eff_method,
                        out["base_close"], out["base_open_next"], out["fwd_date"], out["fwd_close"],
                        out["ret_from_close_pct"], out["ret_from_open_pct"],
                        out["bench_ret_from_close_pct"], out["bench_ret_from_open_pct"],
                        out["excess_from_close_pct"], out["excess_from_open_pct"],
                        out["status"], out["missing_reason"],
                    ))

            if cand_rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO plan_outcomes (
                      plan_date, token, symbol, industry_label, rules_version, source, horizon,
                      candidate_set, method,
                      base_close, base_open_next, fwd_date, fwd_close,
                      ret_from_close_pct, ret_from_open_pct,
                      bench_ret_from_close_pct, bench_ret_from_open_pct,
                      excess_from_close_pct, excess_from_open_pct,
                      status, missing_reason
                    ) VALUES %s
                    ON CONFLICT (plan_date, token, horizon, candidate_set) DO UPDATE SET
                      symbol = EXCLUDED.symbol,
                      industry_label = EXCLUDED.industry_label,
                      rules_version = EXCLUDED.rules_version,
                      source = CASE WHEN plan_outcomes.source = 'live' THEN 'live' ELSE EXCLUDED.source END,
                      method = CASE WHEN plan_outcomes.source = 'live' THEN plan_outcomes.method ELSE EXCLUDED.method END,
                      base_close = EXCLUDED.base_close,
                      base_open_next = EXCLUDED.base_open_next,
                      fwd_date = EXCLUDED.fwd_date,
                      fwd_close = EXCLUDED.fwd_close,
                      ret_from_close_pct = EXCLUDED.ret_from_close_pct,
                      ret_from_open_pct = EXCLUDED.ret_from_open_pct,
                      bench_ret_from_close_pct = EXCLUDED.bench_ret_from_close_pct,
                      bench_ret_from_open_pct = EXCLUDED.bench_ret_from_open_pct,
                      excess_from_close_pct = EXCLUDED.excess_from_close_pct,
                      excess_from_open_pct = EXCLUDED.excess_from_open_pct,
                      status = EXCLUDED.status,
                      missing_reason = EXCLUDED.missing_reason;
                    """,
                    cand_rows,
                )

            ctrl_rows: List[Tuple[Any, ...]] = []
            for item in ctrl_items:
                tok_map = candles_by_tok.get(item["token"], {})
                for h in OUTCOME_HORIZONS:
                    out = compute_outcome_row(
                        item["plan_date"],
                        item["token"],
                        item["symbol"],
                        item["industry_label"],
                        item["rules_version"],
                        default_source,
                        h,
                        trading_days,
                        tok_map,
                        bench_by_date,
                    )
                    if out is None:
                        continue
                    ctrl_rows.append((
                        out["plan_date"], out["token"], out["symbol"], out["industry_label"],
                        item["group_name"], out["rules_version"], out["source"], out["horizon"],
                        eff_method,
                        out["base_close"], out["base_open_next"], out["fwd_date"], out["fwd_close"],
                        out["ret_from_close_pct"], out["ret_from_open_pct"],
                        out["bench_ret_from_close_pct"], out["bench_ret_from_open_pct"],
                        out["excess_from_close_pct"], out["excess_from_open_pct"],
                        out["status"], out["missing_reason"],
                    ))

            if ctrl_rows:
                execute_values(
                    cur,
                    """
                    INSERT INTO plan_outcomes_control (
                      plan_date, token, symbol, industry_label, group_name, rules_version, source, horizon,
                      method,
                      base_close, base_open_next, fwd_date, fwd_close,
                      ret_from_close_pct, ret_from_open_pct,
                      bench_ret_from_close_pct, bench_ret_from_open_pct,
                      excess_from_close_pct, excess_from_open_pct,
                      status, missing_reason
                    ) VALUES %s
                    ON CONFLICT (plan_date, token, group_name, horizon) DO UPDATE SET
                      symbol = EXCLUDED.symbol,
                      industry_label = EXCLUDED.industry_label,
                      rules_version = EXCLUDED.rules_version,
                      source = CASE WHEN plan_outcomes_control.source = 'live' THEN 'live' ELSE EXCLUDED.source END,
                      method = CASE WHEN plan_outcomes_control.source = 'live' THEN plan_outcomes_control.method ELSE EXCLUDED.method END,
                      base_close = EXCLUDED.base_close,
                      base_open_next = EXCLUDED.base_open_next,
                      fwd_date = EXCLUDED.fwd_date,
                      fwd_close = EXCLUDED.fwd_close,
                      ret_from_close_pct = EXCLUDED.ret_from_close_pct,
                      ret_from_open_pct = EXCLUDED.ret_from_open_pct,
                      bench_ret_from_close_pct = EXCLUDED.bench_ret_from_close_pct,
                      bench_ret_from_open_pct = EXCLUDED.bench_ret_from_open_pct,
                      excess_from_close_pct = EXCLUDED.excess_from_close_pct,
                      excess_from_open_pct = EXCLUDED.excess_from_open_pct,
                      status = EXCLUDED.status,
                      missing_reason = EXCLUDED.missing_reason;
                    """,
                    ctrl_rows,
                )

            cutoff = date.fromisoformat(effective_as_of) - timedelta(days=OUTCOME_RETENTION_DAYS)
            cur.execute("DELETE FROM plan_outcomes WHERE plan_date < %s;", (cutoff.isoformat(),))
            cur.execute("DELETE FROM plan_outcomes_control WHERE plan_date < %s;", (cutoff.isoformat(),))
            cur.execute("DELETE FROM plan_control WHERE plan_date < %s;", (cutoff.isoformat(),))

        conn.commit()

    return {
        "status": "ok",
        "as_of": effective_as_of,
        "candidate_outcomes": len(cand_rows),
        "matured": matured_cands,
        "missing": missing_cands,
        "split_flagged": split_cands,
        "control_outcomes": len(ctrl_rows),
    }


def backfill_plans_and_outcomes(sessions: int = 120) -> Dict[str, Any]:
    """
    Backfill Daily Plans + Outcomes for the last `sessions` trading days where
    every required input exists <= plan_date (zero look-ahead).
    """
    from pipeline.plan import build_daily_plan

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT b.trade_date::text
                FROM daily_market_breadth b
                WHERE b.universe = 'nifty500'
                  AND EXISTS (SELECT 1 FROM industry_top_groups t WHERE t.snapshot_date <= b.trade_date)
                GROUP BY b.trade_date
                ORDER BY b.trade_date DESC
                LIMIT %s;
                """,
                (sessions,),
            )
            target_dates = sorted(str(r[0]).split("T")[0] for r in cur.fetchall())

    built = 0
    for d in target_dates:
        build_daily_plan(
            d,
            generate_summary=False,
            store_control=True,
            allow_historical_metrics=True,
            prune_old=False,
        )
        built += 1

    outcomes_res = compute_plan_outcomes(default_source="backfill", candidate_set="filter_only", method="backfill_v1")

    if target_dates:
        from pipeline.plan_rules import PLAN_RETENTION_DAYS
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM daily_plan WHERE plan_date < (%s::date - (%s || ' days')::interval);",
                    (target_dates[-1], PLAN_RETENTION_DAYS),
                )
            conn.commit()
    return {
        "status": "ok",
        "plans_built": built,
        "first_date": target_dates[0] if target_dates else None,
        "last_date": target_dates[-1] if target_dates else None,
        "outcomes": outcomes_res,
    }
