#!/usr/bin/env python3
"""
D2 — Independent recomputation of derived numbers from raw stock_candles / daily_index_ohlcv.
Imports NOTHING from `pipeline/`. Uses only plain pandas, numpy, and psycopg2.

Checks for 5 dates (latest, latest-5, 3 random in last 120 sessions, seed=42):
- NIFTY 500 breadth: advances, declines, % above 50/200 SMA, 20D highs/lows, breakouts_20d
- RS rating (Spearman >= 0.99) & Stage 2 agreement (>= 99.5%) for liquid stocks
- Industry group medians (1D, 1W, 1M, 3M) within 0.01 pp & 20D H/L for 10 random groups/level + Top-3 qualifying
- Daily Plan block 2: 5- and 20-session index returns
"""

import argparse
import json
import math
import os
import random
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv(".env")

# Deliberately self-contained constants (no pipeline imports)
LIQ_PRICE_MIN = 20.0
LIQ_VOL_SMA50_MIN = 25000.0
LIQ_TURNOVER_MED20_MIN = 5_000_000.0
CORP_ACTION_JUMP = 0.40
TOP_GROUP_CUTOFF_MIN = 5
TOP_GROUP_CUTOFF_FRAC = 0.20


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _spearman_corr(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 2:
        return 1.0
    rx = pd.Series(x).rank(method="average").to_numpy()
    ry = pd.Series(y).rank(method="average").to_numpy()
    mx, my = rx.mean(), ry.mean()
    num = float(np.sum((rx - mx) * (ry - my)))
    den = float(np.sqrt(np.sum((rx - mx) ** 2) * np.sum((ry - my) ** 2)))
    return num / den if den > 0 else 0.0


def _pick_5_dates(cur, seed: int = 42) -> List[str]:
    cur.execute("SELECT trade_date::text FROM trading_days ORDER BY trade_date DESC LIMIT 120;")
    days = [str(r[0]).split("T")[0] for r in cur.fetchall()]
    latest = days[0]
    lat_m5 = days[min(5, len(days) - 1)]
    pool = [d for d in days[1:] if d != lat_m5]
    rng = random.Random(seed)
    picks = rng.sample(pool, min(3, len(pool)))
    return [latest, lat_m5] + sorted(picks, reverse=True)


def check_breadth(cur, target_dates: List[str]) -> Dict[str, Any]:
    """Recompute NIFTY 500 breadth from raw stock_candles & compare against daily_market_breadth."""
    cur.execute(
        "SELECT DISTINCT symbol FROM index_constituents WHERE index_name = 'nifty500' AND COALESCE(is_active, TRUE) = TRUE;"
    )
    n500_syms = {str(r[0]) for r in cur.fetchall()}

    min_target = min(target_dates)
    cur.execute(
        """
        WITH start_d AS (
            SELECT trade_date FROM trading_days WHERE trade_date <= %s ORDER BY trade_date DESC LIMIT 270
        )
        SELECT c.token, i.symbol, c.trade_date::text, c.high::float, c.low::float, c.close::float, COALESCE(c.volume, 0)::float
        FROM stock_candles c
        JOIN instruments i ON i.token = c.token
        WHERE i.exchange = 'NSE' AND i.instrument_type = 'EQ'
          AND i.symbol = ANY(%s)
          AND c.trade_date >= (SELECT MIN(trade_date) FROM start_d)
          AND c.trade_date <= %s
        ORDER BY c.token, c.trade_date;
        """,
        (min_target, list(n500_syms), max(target_dates)),
    )
    rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["token", "symbol", "trade_date", "high", "low", "close", "volume"])
    df["trade_date"] = df["trade_date"].str.split("T").str[0]
    df = df.sort_values(["token", "trade_date"]).reset_index(drop=True)

    g = df.groupby("token", sort=False)
    df["prev_close"] = g["close"].shift(1)
    df["ret_1d"] = df["close"] / df["prev_close"] - 1.0
    df["advance"] = ((df["close"] > df["prev_close"]) & df["prev_close"].notna()).astype(int)
    df["decline"] = ((df["close"] < df["prev_close"]) & df["prev_close"].notna()).astype(int)
    df["sma_50"] = g["close"].transform(lambda s: s.rolling(50, min_periods=50).mean())
    df["sma_200"] = g["close"].transform(lambda s: s.rolling(200, min_periods=200).mean())
    df["above_50"] = ((df["close"] > df["sma_50"]) & df["sma_50"].notna()).astype(int)
    df["valid_50"] = df["sma_50"].notna().astype(int)
    df["above_200"] = ((df["close"] > df["sma_200"]) & df["sma_200"].notna()).astype(int)
    df["valid_200"] = df["sma_200"].notna().astype(int)
    df["high_20d"] = g["high"].transform(lambda s: s.shift(1).rolling(20, min_periods=20).max())
    df["low_20d"] = g["low"].transform(lambda s: s.shift(1).rolling(20, min_periods=20).min())
    df["is_high_20d"] = ((df["close"] >= df["high_20d"]) & df["high_20d"].notna()).astype(int)
    df["is_low_20d"] = ((df["close"] <= df["low_20d"]) & df["low_20d"].notna()).astype(int)
    df["vol_sma_50"] = g["volume"].transform(lambda s: s.shift(1).rolling(50, min_periods=50).mean())
    bo_elig = (df["close"] >= 20) & (df["vol_sma_50"] >= 25000) & df["high_20d"].notna()
    df["breakout_20d"] = (bo_elig & (df["close"] > df["high_20d"]) & (df["volume"] >= 1.5 * df["vol_sma_50"])).astype(int)

    comparisons = []
    passed_all = True
    for d_str in target_dates:
        sub = df[df["trade_date"] == d_str]
        adv = int(sub["advance"].sum())
        dec = int(sub["decline"].sum())
        v50 = int(sub["valid_50"].sum())
        v200 = int(sub["valid_200"].sum())
        p50 = round(float(sub["above_50"].sum()) / v50 * 100.0, 2) if v50 > 0 else 0.0
        p200 = round(float(sub["above_200"].sum()) / v200 * 100.0, 2) if v200 > 0 else 0.0
        h20 = int(sub["is_high_20d"].sum())
        l20 = int(sub["is_low_20d"].sum())
        bo20 = int(sub["breakout_20d"].sum())

        cur.execute(
            """
            SELECT advances, declines, pct_above_50sma::float, pct_above_200sma::float,
                   highs_20d, lows_20d, breakouts_20d
            FROM daily_market_breadth
            WHERE universe = 'nifty500' AND trade_date = %s;
            """,
            (d_str,),
        )
        db_row = cur.fetchone()
        if not db_row:
            continue
        db_adv, db_dec, db_p50, db_p200, db_h20, db_l20, db_bo = db_row
        ok = (
            abs(adv - db_adv) <= 1
            and abs(dec - db_dec) <= 1
            and abs(h20 - db_h20) <= 1
            and abs(l20 - db_l20) <= 1
            and abs(bo20 - db_bo) <= 1
            and abs(p50 - (db_p50 or 0)) <= 0.25
            and abs(p200 - (db_p200 or 0)) <= 0.25
        )
        if not ok:
            passed_all = False
        comparisons.append({
            "date": d_str,
            "adv": (adv, db_adv),
            "dec": (dec, db_dec),
            "pct50": (p50, round(db_p50 or 0, 2)),
            "pct200": (p200, round(db_p200 or 0, 2)),
            "h20": (h20, db_h20),
            "l20": (l20, db_l20),
            "bo20": (bo20, db_bo),
            "ok": ok,
        })

    matched = sum(1 for c in comparisons if c["ok"])
    return {
        "check_id": "recompute_breadth",
        "comparisons": comparisons,
        "sample_n": len(comparisons),
        "matched_n": matched,
        "match_pct": round(matched / len(comparisons) * 100.0, 2) if comparisons else 0.0,
        "gate_pct": 100.0,
        "passed": passed_all and len(comparisons) > 0,
    }


def check_rs_and_stage2(cur, latest_date: str) -> Dict[str, Any]:
    """Recompute IBD RS rating & Stage 2 flag for all liquid stocks on latest_date."""
    cur.execute(
        """
        WITH dates AS (
            SELECT trade_date FROM trading_days WHERE trade_date <= %s ORDER BY trade_date DESC LIMIT 260
        )
        SELECT c.token, c.trade_date::text, c.close::float
        FROM stock_candles c
        WHERE c.trade_date >= (SELECT MIN(trade_date) FROM dates)
          AND c.trade_date <= %s
        ORDER BY c.token, c.trade_date;
        """,
        (latest_date, latest_date),
    )
    by_tok: Dict[int, List[Tuple[str, float]]] = {}
    for tok, td, cl in cur.fetchall():
        by_tok.setdefault(int(tok), []).append((str(td).split("T")[0], float(cl)))

    # Load tokens in latest_industry_stock_metrics so RS universe matches
    cur.execute(
        """
        SELECT DISTINCT m.token, m.rs_rating::float
        FROM latest_industry_stock_metrics m
        WHERE m.snapshot_id = (
            SELECT snapshot_id FROM industry_snapshots
            WHERE status = 'completed' AND trade_date = %s
            ORDER BY completed_at DESC LIMIT 1
        );
        """,
        (latest_date,),
    )
    all_snap_rs = {int(r[0]): r[1] for r in cur.fetchall()}

    cur.execute(
        """
        SELECT DISTINCT m.token, m.rs_rating::float
        FROM latest_industry_stock_metrics m
        WHERE m.is_liquid = TRUE AND m.rs_rating IS NOT NULL
          AND m.snapshot_id = (
            SELECT snapshot_id FROM industry_snapshots
            WHERE status = 'completed' AND trade_date = %s
            ORDER BY completed_at DESC LIMIT 1
          );
        """,
        (latest_date,),
    )
    db_rs = {int(r[0]): float(r[1]) for r in cur.fetchall()}

    raw_scores: Dict[int, float] = {}
    stage2_recomp: Dict[int, int] = {}
    for tok, series in by_tok.items():
        if tok not in all_snap_rs:
            continue
        if not series or series[-1][0] != latest_date:
            continue
        closes = np.array([x[1] for x in series], dtype=float)
        n = len(closes)
        # Corp action break check
        has_break = False
        if n >= 2:
            tail = closes[-min(252, n):]
            rets = np.abs(tail[1:] / tail[:-1] - 1.0)
            if np.any(rets > CORP_ACTION_JUMP):
                has_break = True
        if n > 63 and not has_break and closes[-1] > 0:
            c0 = closes[-1]
            r3 = c0 / closes[-64] - 1.0
            r6 = (c0 / closes[-127] - 1.0) if n > 126 else r3
            r9 = (c0 / closes[-190] - 1.0) if n > 189 else r3
            r12 = (c0 / closes[-253] - 1.0) if n > 252 else r3
            raw_scores[tok] = 2.0 * r3 + r6 + r9 + r12

        if n >= 170:
            sma150 = pd.Series(closes).rolling(150, min_periods=150).mean().to_numpy()
            if np.isfinite(sma150[-1]) and np.isfinite(sma150[-21]) and sma150[-21] > 0:
                slope = (sma150[-1] / sma150[-21] - 1.0) * 100.0
                stage2_recomp[tok] = 1 if (closes[-1] > sma150[-1] and slope >= 1.0) else 0

    recomp_rs: Dict[int, int] = {}
    if raw_scores:
        ordered = sorted(raw_scores, key=raw_scores.get)
        n_rated = len(ordered)
        for idx, tok in enumerate(ordered):
            recomp_rs[tok] = max(1, min(99, round(100 * (idx + 1) / n_rated)))

    common = sorted(set(db_rs.keys()) & set(recomp_rs.keys()))
    arr_db = np.array([db_rs[t] for t in common], dtype=float)
    arr_re = np.array([recomp_rs[t] for t in common], dtype=float)
    spearman = _spearman_corr(arr_db, arr_re)
    max_abs = float(np.max(np.abs(arr_db - arr_re))) if len(common) else 0.0

    # Stage 2 check against daily_plan_candidates (latest)
    cur.execute(
        """
        SELECT token FROM daily_plan_candidates
        WHERE plan_date = (SELECT MAX(plan_date) FROM daily_plan_candidates);
        """
    )
    cand_toks = [int(r[0]) for r in cur.fetchall()]
    st2_ok = sum(1 for t in cand_toks if stage2_recomp.get(t) == 1)
    st2_pct = round(st2_ok / len(cand_toks) * 100.0, 2) if cand_toks else 100.0

    return {
        "check_id": "recompute_rs_stage2",
        "rs_sample_n": len(common),
        "rs_spearman": round(spearman, 5),
        "rs_max_abs_diff": max_abs,
        "stage2_cand_checked": len(cand_toks),
        "stage2_cand_agree_pct": st2_pct,
        "passed": spearman >= 0.99 and st2_pct >= 99.5,
    }


def check_industry_medians_and_top3(cur, latest_date: str, seed: int = 42) -> Dict[str, Any]:
    """Recompute group medians (1D, 1W, 1M, 3M) & 20D H/L for 10 random groups/level and Top-3 qualifying."""
    cur.execute(
        """
        SELECT s.snapshot_id
        FROM industry_snapshots s
        WHERE s.status = 'completed' AND s.trade_date = %s
        ORDER BY s.completed_at DESC LIMIT 1;
        """,
        (latest_date,),
    )
    row = cur.fetchone()
    if not row:
        return {"check_id": "recompute_medians_top3", "passed": False, "reason": "no_snapshot"}
    snap_id = row[0]

    cur.execute(
        """
        SELECT s.group_id, g.level, g.label, s.median_1d::float, s.median_1w::float, s.median_1m::float, s.median_3m::float,
               s.n_20d_high, s.n_20d_low
        FROM daily_industry_strength s
        JOIN industry_groups g ON g.group_id = s.group_id
        WHERE s.trade_date = %s AND s.universe = 'all';
        """,
        (latest_date,),
    )
    db_groups = cur.fetchall()

    # Load all stock metrics from latest_industry_stock_metrics for that snapshot
    cur.execute(
        """
        SELECT m.token, m.ret_1d::float, m.ret_1w::float, m.ret_1m::float, m.ret_3m::float,
               m.at_20d_high, m.at_20d_low,
               m.macro, m.sector, m.industry, m.basic_industry
        FROM latest_industry_stock_metrics m
        WHERE m.snapshot_id = %s;
        """,
        (snap_id,),
    )
    stock_rows = cur.fetchall()

    by_level_label: Dict[Tuple[str, str], List[Tuple[Any, ...]]] = {}
    for r in stock_rows:
        _, r1d, r1w, r1m, r3m, h20, l20, mac, sec, ind, bas = r
        vals = (r1d, r1w, r1m, r3m, bool(h20), bool(l20))
        if mac:
            by_level_label.setdefault(("macro", mac), []).append(vals)
        if sec:
            by_level_label.setdefault(("sector", sec), []).append(vals)
        if ind:
            by_level_label.setdefault(("industry", ind), []).append(vals)
        if bas:
            by_level_label.setdefault(("basic_industry", bas), []).append(vals)

    rng = random.Random(seed)
    by_lvl: Dict[str, List[Tuple[Any, ...]]] = {}
    for g in db_groups:
        by_lvl.setdefault(g[1], []).append(g)

    checked = 0
    matched = 0
    max_diff_pp = 0.0
    sample_table = []
    for lvl in ("macro", "sector", "industry", "basic_industry"):
        pool = sorted(by_lvl.get(lvl, []), key=lambda x: x[2])
        picks = rng.sample(pool, min(10, len(pool)))
        for gid, _, lbl, d1, d1w, d1m, d3m, dh20, dl20 in picks:
            mems = by_level_label.get((lvl, lbl), [])
            if not mems:
                continue
            checked += 1
            c1d = float(np.median([m[0] for m in mems if m[0] is not None])) if any(m[0] is not None for m in mems) else None
            c1w = float(np.median([m[1] for m in mems if m[1] is not None])) if any(m[1] is not None for m in mems) else None
            c1m = float(np.median([m[2] for m in mems if m[2] is not None])) if any(m[2] is not None for m in mems) else None
            c3m = float(np.median([m[3] for m in mems if m[3] is not None])) if any(m[3] is not None for m in mems) else None
            ch20 = sum(1 for m in mems if m[4])
            cl20 = sum(1 for m in mems if m[5])
            diffs = []
            for a, b in ((c1d, d1), (c1w, d1w), (c1m, d1m), (c3m, d3m)):
                if a is not None and b is not None:
                    diffs.append(abs(a - b))
            mx = max(diffs) if diffs else 0.0
            max_diff_pp = max(max_diff_pp, mx)
            ok = mx <= 0.01 and ch20 == dh20 and cl20 == dl20
            if ok:
                matched += 1
            if len(sample_table) < 12:
                sample_table.append({
                    "level": lvl, "label": lbl, "max_med_diff_pp": round(mx, 4),
                    "h20": (ch20, dh20), "l20": (cl20, dl20), "ok": ok,
                })

    # Verify Top-3 qualifying for 'industry' / 'all' (n_eligible >= 5)
    cur.execute(
        """
        SELECT s.group_id, g.label, s.median_1d::float, s.median_1w::float, s.median_1m::float, s.median_3m::float, s.n_eligible
        FROM daily_industry_strength s
        JOIN industry_groups g ON g.group_id = s.group_id
        WHERE s.trade_date = %s AND g.level = 'industry' AND s.universe = 'all' AND s.n_eligible >= 5;
        """,
        (latest_date,),
    )
    ind_rows = [r for r in cur.fetchall() if all(r[i] is not None for i in (2, 3, 4, 5))]
    top3_ok = True
    top3_recomp = []
    if ind_rows:
        def _ranks(col_idx: int) -> Dict[str, int]:
            ordered = sorted(ind_rows, key=lambda r: (-r[col_idx], r[1]))
            return {r[0]: i + 1 for i, r in enumerate(ordered)}
        r1d, r1w, r1m, r3m = _ranks(2), _ranks(3), _ranks(4), _ranks(5)
        cutoff = max(TOP_GROUP_CUTOFF_MIN, math.ceil(TOP_GROUP_CUTOFF_FRAC * len(ind_rows)))
        scored = []
        for r in ind_rows:
            gid = r[0]
            ranks = (r1d[gid], r1w[gid], r1m[gid], r3m[gid])
            scored.append((max(ranks), sum(ranks) / 4.0, r[1], max(ranks) <= cutoff))
        scored.sort(key=lambda x: (x[0], x[1], x[2]))
        top3_recomp = [x[2] for x in scored[:3]]

        cur.execute(
            """
            SELECT g.label FROM industry_top_groups t
            JOIN industry_groups g ON g.group_id = t.group_id
            WHERE t.snapshot_date = %s AND t.level = 'industry' AND t.universe = 'all'
            ORDER BY t.pos ASC LIMIT 3;
            """,
            (latest_date,),
        )
        db_top3 = [r[0] for r in cur.fetchall()]
        top3_ok = (top3_recomp == db_top3)

    match_pct = round(matched / checked * 100.0, 2) if checked else 0.0
    return {
        "check_id": "recompute_medians_top3",
        "sample_n": checked,
        "matched_n": matched,
        "match_pct": match_pct,
        "max_diff_pp": round(max_diff_pp, 4),
        "top3_recomp": top3_recomp,
        "top3_match": top3_ok,
        "sample": sample_table,
        "passed": match_pct == 100.0 and top3_ok,
    }


def check_cap_returns(cur, latest_date: str) -> Dict[str, Any]:
    """Recompute 5D and 20D index returns vs daily_plan.caps."""
    indices = ["NIFTY 50", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250", "NIFTY 500"]
    cur.execute(
        """
        SELECT plan_date::text, caps FROM daily_plan
        WHERE plan_date <= %s ORDER BY plan_date DESC LIMIT 1;
        """,
        (latest_date,),
    )
    row = cur.fetchone()
    if not row or not row[1]:
        return {"check_id": "recompute_cap_returns", "passed": False}
    plan_date = str(row[0]).split("T")[0]
    caps = row[1]
    stored_items = list(caps.get("segments") or [])
    if caps.get("benchmark"):
        stored_items.append(caps["benchmark"])
    stored_by_idx = {it.get("index_name"): it for it in stored_items if it.get("index_name")}

    matched = 0
    checked = 0
    details = []
    for iname in indices:
        cur.execute(
            """
            SELECT close::float FROM daily_index_ohlcv
            WHERE index_name = %s AND trade_date <= %s
            ORDER BY trade_date DESC LIMIT 25;
            """,
            (iname, plan_date),
        )
        closes = [r[0] for r in cur.fetchall()]
        if len(closes) < 21 or iname not in stored_by_idx:
            continue
        r5 = round((closes[0] / closes[5] - 1.0) * 100.0, 2)
        r20 = round((closes[0] / closes[20] - 1.0) * 100.0, 2)
        st = stored_by_idx[iname]
        checked += 1
        ok = abs(r5 - float(st["ret_5d"])) <= 0.01 and abs(r20 - float(st["ret_20d"])) <= 0.01
        if ok:
            matched += 1
        details.append({"index": iname, "r5": (r5, st["ret_5d"]), "r20": (r20, st["ret_20d"]), "ok": ok})

    return {
        "check_id": "recompute_cap_returns",
        "plan_date": plan_date,
        "sample_n": checked,
        "matched_n": matched,
        "details": details,
        "passed": checked > 0 and matched == checked,
    }


def main():
    parser = argparse.ArgumentParser(description="D2 Independent Recomputation")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--store", action="store_true")
    parser.add_argument("--run-kind", choices=["ci", "manual"], default="manual")
    args = parser.parse_args()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            dates = _pick_5_dates(cur, seed=args.seed)
            print(f"[D2] 5 audit dates (seed={args.seed}): {dates}")

            b_res = check_breadth(cur, dates)
            print(f"[D2 Breadth] {b_res['matched_n']}/{b_res['sample_n']} dates matched | passed={b_res['passed']}")
            for c in b_res["comparisons"]:
                print(f"  {c['date']} | adv={c['adv']} dec={c['dec']} >50={c['pct50']} >200={c['pct200']} h20={c['h20']} bo20={c['bo20']} ok={c['ok']}")

            rs_res = check_rs_and_stage2(cur, dates[0])
            print(f"[D2 RS/Stage2] n={rs_res['rs_sample_n']} spearman={rs_res['rs_spearman']} max_abs={rs_res['rs_max_abs_diff']} | Stage2={rs_res['stage2_cand_agree_pct']}% ({rs_res['stage2_cand_checked']} cands) | passed={rs_res['passed']}")

            med_res = check_industry_medians_and_top3(cur, dates[0], seed=args.seed)
            print(f"[D2 Medians/Top3] {med_res['matched_n']}/{med_res['sample_n']} groups (max_diff={med_res['max_diff_pp']} pp) | Top3={med_res.get('top3_recomp')} match={med_res.get('top3_match')} | passed={med_res['passed']}")

            cap_res = check_cap_returns(cur, dates[0])
            print(f"[D2 Cap Returns] {cap_res['matched_n']}/{cap_res['sample_n']} indices matched on {cap_res.get('plan_date')} | passed={cap_res['passed']}")
            for d in cap_res.get("details", []):
                print(f"  {d['index']:18s} | 5D={d['r5']} | 20D={d['r20']} | ok={d['ok']}")

            if args.store:
                rows_to_store = [
                    ("recompute_breadth", "Independent pandas/numpy vs daily_market_breadth", b_res["sample_n"], b_res["matched_n"], b_res["match_pct"], 100.0, b_res["passed"], b_res),
                    ("recompute_rs_stage2", "Independent pandas/numpy vs RS/Stage2", rs_res["rs_sample_n"], rs_res["rs_sample_n"] if rs_res["passed"] else 0, round(rs_res["rs_spearman"] * 100.0, 2), 99.0, rs_res["passed"], rs_res),
                    ("recompute_medians_top3", "Independent pandas/numpy vs daily_industry_strength/top3", med_res["sample_n"], med_res["matched_n"], med_res["match_pct"], 100.0, med_res["passed"], med_res),
                    ("recompute_cap_returns", "Independent pandas/numpy vs daily_plan.caps", cap_res["sample_n"], cap_res["matched_n"], round(cap_res["matched_n"] / cap_res["sample_n"] * 100.0, 2) if cap_res["sample_n"] else 0.0, 100.0, cap_res["passed"], cap_res),
                ]
                for cid, src, sn, mn, mp, gp, ps, det in rows_to_store:
                    cur.execute(
                        """
                        INSERT INTO data_audit (run_at, check_id, source, sample_n, matched_n, match_pct, gate_pct, passed, detail, run_kind)
                        VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s);
                        """,
                        (cid, src, sn, mn, mp, gp, ps, json.dumps(det), args.run_kind),
                    )
                conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
