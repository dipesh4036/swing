#!/usr/bin/env python3
"""
D1 — Price Audit against NSE official files (CI-safe) and Angel SmartAPI (manual, local-only).
Also audits corporate actions (>35% 1-day close moves or split/bonus ratios).

Rules:
- Angel: >= 400ms spacing, stop at first 403/429, nothing Angel-sourced written to DB or logs.
- NSE bhavcopy/index file: honest User-Agent 'swing-personal-research/1.0', stop at first 403/429.
- Gate: >= 99.5% of compared close values within 0.05%.
"""

import argparse
import io
import json
import os
import random
import sys
import time
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv(".env")

USER_AGENT = "swing-personal-research/1.0"
NSE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
BHAVCOPY_PRIMARY = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"
BHAVCOPY_FALLBACK = "https://archives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"
INDEX_CLOSE_URL = "https://nsearchives.nseindia.com/content/indices/ind_close_all_{ddmmyyyy}.csv"

INDEX_NAME_MAP = {
    "NIFTY 50": "Nifty 50",
    "NIFTY 500": "Nifty 500",
    "NIFTY MIDCAP 150": "Nifty Midcap 150",
    "NIFTY SMALLCAP 250": "Nifty Smallcap 250",
}
ANGEL_INDEX_TOKENS = {
    "NIFTY 50": "99926000",
    "NIFTY 500": "99926004",
    "NIFTY MIDCAP 150": "99926060",
    "NIFTY SMALLCAP 250": "99926062",
}

GATE_CLOSE_PCT = 99.5
CLOSE_TOL_PCT = 0.05
VOL_TOL_PCT = 1.0
ANGEL_DELAY_SEC = 0.42
SPLIT_FACTORS = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0, 20.0]


def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _fetch_bhavcopy(d_str: str, sess: requests.Session) -> Optional[pd.DataFrame]:
    dt = datetime.strptime(d_str, "%Y-%m-%d").date()
    ymd = dt.strftime("%Y%m%d")
    for url in (BHAVCOPY_PRIMARY.format(date_str=ymd), BHAVCOPY_FALLBACK.format(date_str=ymd)):
        try:
            r = sess.get(url, headers=NSE_HEADERS, timeout=25)
            if r.status_code in (403, 429):
                raise RuntimeError(f"NSE returned HTTP {r.status_code} on {url}")
            if r.status_code == 200:
                with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
                    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
                    if not csv_names:
                        return None
                    with zf.open(csv_names[0]) as f:
                        df = pd.read_csv(f)
                        df.columns = [c.strip() for c in df.columns]
                        return df
        except RuntimeError:
            raise
        except Exception:
            continue
    return None


def _fetch_index_close_csv(d_str: str, sess: requests.Session) -> Optional[pd.DataFrame]:
    dt = datetime.strptime(d_str, "%Y-%m-%d").date()
    ddmmyyyy = dt.strftime("%d%m%Y")
    url = INDEX_CLOSE_URL.format(ddmmyyyy=ddmmyyyy)
    r = sess.get(url, headers=NSE_HEADERS, timeout=25)
    if r.status_code in (403, 429):
        raise RuntimeError(f"NSE returned HTTP {r.status_code} on {url}")
    if r.status_code != 200:
        return None
    df = pd.read_csv(io.StringIO(r.text))
    df.columns = [c.strip() for c in df.columns]
    return df


def run_bhavcopy_audit(sessions: int = 5) -> Dict[str, Any]:
    """D1.1: Compare ALL liquid stocks (close & volume) and 4 indices vs NSE official files for latest 5 sessions.
    Note: stock_candles daily ingest uses NSE bhavcopy, so this checks ingest transformation fidelity (not independent).
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT trade_date::text FROM trading_days ORDER BY trade_date DESC LIMIT %s;", (sessions,))
            dates = [str(r[0]).split("T")[0] for r in cur.fetchall()]

            cur.execute("SELECT DISTINCT token, symbol, isin FROM instruments WHERE exchange='NSE' AND instrument_type='EQ';")
            inst_map = {int(r[0]): (str(r[1]).upper(), str(r[2] or "").upper()) for r in cur.fetchall()}

            cur.execute("SELECT DISTINCT token FROM latest_industry_stock_metrics WHERE is_liquid = TRUE;")
            liquid_tokens = {int(r[0]) for r in cur.fetchall()}
    finally:
        conn.close()

    sess = requests.Session()
    stock_total = 0
    stock_close_matched = 0
    stock_vol_matched = 0
    idx_total = 0
    idx_matched = 0
    mismatches: List[Dict[str, Any]] = []
    dates_checked: List[str] = []

    conn = _get_conn()
    try:
        for d_str in dates:
            try:
                bhav = _fetch_bhavcopy(d_str, sess)
            except RuntimeError as e:
                print(f"[HALTED NSE] {e}")
                break
            if bhav is None:
                print(f"  [WARN] Bhavcopy unavailable for {d_str}")
                continue
            dates_checked.append(d_str)

            # Filter EQ/BE/SM/ST or match by ISIN/symbol
            if "SctySrs" in bhav.columns:
                bhav_eq = bhav[bhav["SctySrs"].isin(["EQ", "BE", "BZ", "SM", "ST"])].copy()
            else:
                bhav_eq = bhav.copy()

            by_isin = {}
            by_sym = {}
            for _, row in bhav_eq.iterrows():
                isin = str(row.get("ISIN", "")).strip().upper()
                sym = str(row.get("TckrSymb", "")).strip().upper()
                cl = row.get("ClsPric")
                vol = row.get("TtlTradgVol")
                if pd.notna(cl) and pd.notna(vol):
                    rec = (float(cl), float(vol))
                    if isin:
                        by_isin[isin] = rec
                    if sym:
                        by_sym[sym] = rec

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT token, close::float, volume::float FROM stock_candles WHERE trade_date = %s AND token = ANY(%s);",
                    (d_str, list(liquid_tokens)),
                )
                db_rows = cur.fetchall()

            for tok, db_cl, db_vol in db_rows:
                sym, isin = inst_map.get(int(tok), ("", ""))
                ref = by_isin.get(isin) or by_sym.get(sym)
                if not ref:
                    continue
                ref_cl, ref_vol = ref
                stock_total += 1
                diff_cl_pct = abs(db_cl - ref_cl) / ref_cl * 100.0 if ref_cl > 0 else 0.0
                diff_vol_pct = abs(db_vol - ref_vol) / ref_vol * 100.0 if ref_vol > 0 else (0.0 if db_vol == 0 else 100.0)
                if diff_cl_pct <= CLOSE_TOL_PCT:
                    stock_close_matched += 1
                else:
                    if len(mismatches) < 30:
                        mismatches.append({
                            "symbol": sym, "date": d_str, "ours": db_cl, "source": ref_cl,
                            "cause": f"close_diff_{diff_cl_pct:.3f}pct",
                        })
                if diff_vol_pct <= VOL_TOL_PCT:
                    stock_vol_matched += 1

            # Index closing file
            try:
                idx_df = _fetch_index_close_csv(d_str, sess)
            except RuntimeError as e:
                print(f"[HALTED NSE IDX] {e}")
                idx_df = None
            if idx_df is not None and "Index Name" in idx_df.columns:
                idx_lookup = {}
                for _, row in idx_df.iterrows():
                    nm = str(row.get("Index Name", "")).strip().lower()
                    val = row.get("Closing Index Value")
                    if pd.notna(val) and str(val).strip() not in ("-", ""):
                        try:
                            idx_lookup[nm] = float(val)
                        except ValueError:
                            pass
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT index_name, close::float FROM daily_index_ohlcv WHERE trade_date = %s AND index_name = ANY(%s);",
                        (d_str, list(INDEX_NAME_MAP.keys())),
                    )
                    for iname, db_icl in cur.fetchall():
                        ref_icl = idx_lookup.get(INDEX_NAME_MAP[iname].lower())
                        if ref_icl is not None:
                            idx_total += 1
                            if abs(db_icl - ref_icl) / ref_icl * 100.0 <= CLOSE_TOL_PCT:
                                idx_matched += 1
                            else:
                                mismatches.append({
                                    "symbol": iname, "date": d_str, "ours": db_icl, "source": ref_icl,
                                    "cause": "index_close_mismatch",
                                })
            time.sleep(0.3)
    finally:
        conn.close()

    total = stock_total + idx_total
    matched = stock_close_matched + idx_matched
    match_pct = round((matched / total) * 100.0, 3) if total > 0 else 0.0
    passed = total > 0 and match_pct >= GATE_CLOSE_PCT
    return {
        "check_id": "price_audit_bhavcopy",
        "source": "NSE CM Bhavcopy + Index Close (ingest check, circular)",
        "dates": sorted(dates_checked),
        "sample_n": total,
        "matched_n": matched,
        "match_pct": match_pct,
        "gate_pct": GATE_CLOSE_PCT,
        "passed": passed,
        "detail": {
            "note": "Circular ingest transformation check against NSE bhavcopy (same source as daily ingest); not an independent source.",
            "dates_checked": sorted(dates_checked),
            "stock_sample_n": stock_total,
            "stock_close_matched_n": stock_close_matched,
            "stock_vol_matched_n": stock_vol_matched,
            "index_sample_n": idx_total,
            "index_matched_n": idx_matched,
            "mismatches": mismatches,
        },
    }


def run_angel_audit(seed: int = 42, n_stocks: int = 60, n_outside_nifty500: int = 20, sessions_per_stock: int = 5) -> Dict[str, Any]:
    """D1.2: Independent audit against Angel SmartAPI (read-only, >= 400ms spacing, no Angel data written to DB or logs)."""
    from SmartApi import SmartConnect
    import pyotp

    api_key = os.environ.get("API_KEY", "")
    client_id = os.environ.get("CLIENT_ID", "")
    pin = os.environ.get("PIN", "")
    totp_secret = os.environ.get("TOTP_SECRET", "")
    if not all([api_key, client_id, pin, totp_secret]):
        raise RuntimeError("Missing Angel SmartAPI credentials in env")

    smart = SmartConnect(api_key=api_key)
    totp = pyotp.TOTP(totp_secret).now()
    sess_res = smart.generateSession(client_id, pin, totp)
    if not sess_res or not sess_res.get("status"):
        raise RuntimeError("Angel SmartAPI login failed")

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT m.token, m.symbol
                FROM latest_industry_stock_metrics m
                WHERE m.is_liquid = TRUE;
            """)
            liquid = [(int(r[0]), str(r[1])) for r in cur.fetchall()]
            cur.execute("SELECT DISTINCT symbol FROM index_constituents WHERE index_name = 'nifty500' AND COALESCE(is_active, TRUE) = TRUE;")
            n500_syms = {str(r[0]) for r in cur.fetchall()}
            cur.execute("SELECT trade_date::text FROM trading_days ORDER BY trade_date DESC LIMIT 260;")
            hist_dates = sorted(str(r[0]).split("T")[0] for r in cur.fetchall())
    finally:
        conn.close()

    outside = sorted([x for x in liquid if x[1] not in n500_syms], key=lambda x: x[0])
    inside = sorted([x for x in liquid if x[1] in n500_syms], key=lambda x: x[0])
    rng = random.Random(seed)
    pick_out = rng.sample(outside, min(n_outside_nifty500, len(outside)))
    pick_in = rng.sample(inside, min(n_stocks - len(pick_out), len(inside)))
    sample_stocks = pick_out + pick_in

    from_str = f"{hist_dates[0]} 00:00"
    to_str = f"{hist_dates[-1]} 23:59"

    close_total = 0
    close_matched = 0
    ohlc_matched = 0
    vol_matched = 0
    idx_total = 0
    idx_matched = 0
    mismatches: List[Dict[str, Any]] = []
    halted = False

    conn = _get_conn()
    try:
        for tok, sym in sample_stocks:
            if halted:
                break
            time.sleep(ANGEL_DELAY_SEC)
            try:
                resp = smart.getCandleData({
                    "exchange": "NSE",
                    "symboltoken": str(tok),
                    "interval": "ONE_DAY",
                    "fromdate": from_str,
                    "todate": to_str,
                })
            except Exception as exc:
                msg = str(exc)
                if "403" in msg or "429" in msg:
                    print(f"[HALTED ANGEL] {msg}")
                    halted = True
                    break
                continue
            if not resp or not resp.get("status"):
                code = str(resp.get("errorcode", "")) if isinstance(resp, dict) else ""
                if code in ("403", "429", "AB1004"):
                    print(f"[HALTED ANGEL] errorcode={code}")
                    halted = True
                    break
                continue
            candles = resp.get("data") or []
            angel_by_date = {}
            for c in candles:
                d_str = str(c[0]).split("T")[0]
                angel_by_date[d_str] = (float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5]) if len(c) > 5 else 0.0)

            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT trade_date::text, open::float, high::float, low::float, close::float, COALESCE(volume, 0)::float
                    FROM stock_candles
                    WHERE token = %s AND trade_date >= %s AND trade_date <= %s;
                    """,
                    (tok, hist_dates[0], hist_dates[-1]),
                )
                db_rows = {str(r[0]).split("T")[0]: (r[1], r[2], r[3], r[4], r[5]) for r in cur.fetchall()}

            common_dates = sorted(set(db_rows.keys()) & set(angel_by_date.keys()))
            if not common_dates:
                continue
            picked_dates = rng.sample(common_dates, min(sessions_per_stock, len(common_dates)))
            for d_str in picked_dates:
                do, dh, dl, dc, dv = db_rows[d_str]
                ao, ah, al, ac, av = angel_by_date[d_str]
                close_total += 1
                c_ok = ac > 0 and abs(dc - ac) / ac * 100.0 <= CLOSE_TOL_PCT
                o_ok = (
                    c_ok
                    and (ao <= 0 or abs(do - ao) / ao * 100.0 <= CLOSE_TOL_PCT)
                    and (ah <= 0 or abs(dh - ah) / ah * 100.0 <= CLOSE_TOL_PCT)
                    and (al <= 0 or abs(dl - al) / al * 100.0 <= CLOSE_TOL_PCT)
                )
                v_ok = (av == 0 and dv == 0) or (av > 0 and abs(dv - av) / av * 100.0 <= VOL_TOL_PCT)
                if c_ok:
                    close_matched += 1
                else:
                    if len(mismatches) < 30:
                        mismatches.append({
                            "symbol": sym, "date": d_str, "ours": dc, "cause": "close_diff_gt_0.05pct",
                        })
                if o_ok:
                    ohlc_matched += 1
                if v_ok:
                    vol_matched += 1

        # 4 Indices over full 260-session history
        for iname, itok in ANGEL_INDEX_TOKENS.items():
            if halted:
                break
            time.sleep(ANGEL_DELAY_SEC)
            try:
                resp = smart.getCandleData({
                    "exchange": "NSE",
                    "symboltoken": itok,
                    "interval": "ONE_DAY",
                    "fromdate": from_str,
                    "todate": to_str,
                })
            except Exception as exc:
                if "403" in str(exc) or "429" in str(exc):
                    halted = True
                break
            candles = (resp or {}).get("data") or []
            angel_idx = {str(c[0]).split("T")[0]: float(c[4]) for c in candles}
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT trade_date::text, close::float FROM daily_index_ohlcv WHERE index_name = %s AND trade_date >= %s;",
                    (iname, hist_dates[0]),
                )
                for td, db_c in cur.fetchall():
                    d_str = str(td).split("T")[0]
                    ac = angel_idx.get(d_str)
                    if ac and ac > 0:
                        idx_total += 1
                        if abs(db_c - ac) / ac * 100.0 <= CLOSE_TOL_PCT:
                            idx_matched += 1
                        else:
                            if len(mismatches) < 30:
                                mismatches.append({"symbol": iname, "date": d_str, "ours": db_c, "cause": "index_close_diff"})
    finally:
        conn.close()

    total = close_total + idx_total
    matched = close_matched + idx_matched
    match_pct = round((matched / total) * 100.0, 3) if total > 0 else 0.0
    passed = total > 0 and match_pct >= GATE_CLOSE_PCT
    return {
        "check_id": "price_audit_angel",
        "source": f"Angel SmartAPI (seed={seed}, {len(sample_stocks)} stocks x {sessions_per_stock}d + 4 indices)",
        "sample_n": total,
        "matched_n": matched,
        "match_pct": match_pct,
        "gate_pct": GATE_CLOSE_PCT,
        "passed": passed,
        "detail": {
            "seed": seed,
            "stocks_sampled": len(sample_stocks),
            "outside_nifty500_sampled": len(pick_out),
            "history_range": [hist_dates[0], hist_dates[-1]],
            "stock_close_sample_n": close_total,
            "stock_close_matched_n": close_matched,
            "stock_ohlc_matched_n": ohlc_matched,
            "stock_vol_matched_n": vol_matched,
            "index_sample_n": idx_total,
            "index_matched_n": idx_matched,
            "halted": halted,
            "mismatch_count": len(mismatches),
            "mismatches_meta": [{"symbol": m["symbol"], "date": m["date"], "cause": m["cause"]} for m in mismatches],
        },
    }


def run_corporate_actions_audit() -> Dict[str, Any]:
    """D1.3: Find 1-day close moves beyond +-35% in stock_candles inside the 260-session window."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT trade_date::text FROM trading_days ORDER BY trade_date DESC LIMIT 260;")
            dates = sorted(str(r[0]).split("T")[0] for r in cur.fetchall())
            min_d = dates[0]

            cur.execute("""
                WITH lagged AS (
                    SELECT c.token, i.symbol, c.trade_date::text AS td, c.close::float AS cl,
                           LAG(c.close::float) OVER (PARTITION BY c.token ORDER BY c.trade_date) AS prev_cl
                    FROM stock_candles c
                    JOIN instruments i ON i.token = c.token
                    WHERE c.trade_date >= %s
                      AND i.exchange = 'NSE' AND i.instrument_type = 'EQ'
                )
                SELECT token, symbol, td, prev_cl, cl, ((cl / prev_cl) - 1.0) * 100.0 AS pct_chg
                FROM lagged
                WHERE prev_cl > 0 AND ABS((cl / prev_cl) - 1.0) > 0.35
                ORDER BY td DESC, symbol ASC;
            """, (min_d,))
            jumps = cur.fetchall()

            cur.execute("""
                SELECT DISTINCT token, symbol, plan_date::text
                FROM daily_plan_candidates
                ORDER BY plan_date DESC;
            """)
            plan_cands = {(int(r[0]), str(r[1])) for r in cur.fetchall()}
            plan_toks = {t for t, _ in plan_cands}

            cur.execute("SELECT DISTINCT token FROM latest_industry_stock_metrics WHERE is_liquid = TRUE;")
            liquid_toks = {int(r[0]) for r in cur.fetchall()}
    finally:
        conn.close()

    events = []
    liquid_jump_tokens = set()
    in_plan_tokens = set()
    for tok, sym, td, prev_cl, cl, pct in jumps:
        tok = int(tok)
        ratio = round(prev_cl / cl, 3) if cl > 0 and prev_cl > cl else round(cl / prev_cl, 3)
        nearest_factor = min(SPLIT_FACTORS, key=lambda f: abs(f - ratio))
        is_split_like = abs(nearest_factor - ratio) / nearest_factor <= 0.12
        is_liq = tok in liquid_toks
        in_plan = tok in plan_toks
        if is_liq:
            liquid_jump_tokens.add(tok)
        if in_plan:
            in_plan_tokens.add(sym)
        events.append({
            "token": tok,
            "symbol": sym,
            "date": td.split("T")[0],
            "prev_close": round(prev_cl, 2),
            "close": round(cl, 2),
            "pct_chg": round(pct, 2),
            "ratio": ratio,
            "nearest_factor": nearest_factor if is_split_like else None,
            "is_liquid": is_liq,
            "in_daily_plan_candidates": in_plan,
        })

    return {
        "total_events": len(events),
        "liquid_stocks_with_discontinuity": len(liquid_jump_tokens),
        "in_daily_plan_candidates": sorted(in_plan_tokens),
        "events_sample": events[:40],
    }


def store_audit_result(res: Dict[str, Any], run_kind: str = "manual") -> None:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_audit (run_at, check_id, source, sample_n, matched_n, match_pct, gate_pct, passed, detail, run_kind)
                VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s);
                """,
                (
                    res["check_id"],
                    res["source"],
                    res["sample_n"],
                    res["matched_n"],
                    res["match_pct"],
                    res["gate_pct"],
                    res["passed"],
                    json.dumps(res["detail"]),
                    run_kind,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="D1 Price Audit")
    parser.add_argument("--mode", choices=["bhavcopy", "angel", "corp", "all"], default="all")
    parser.add_argument("--sessions", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--store", action="store_true", help="Store aggregate result to data_audit")
    parser.add_argument("--run-kind", choices=["ci", "manual"], default="manual")
    args = parser.parse_args()

    if args.mode in ("bhavcopy", "all"):
        res = run_bhavcopy_audit(sessions=args.sessions)
        print(f"[D1.1 Bhavcopy] matched {res['matched_n']} of {res['sample_n']} ({res['match_pct']}%) | gate={res['gate_pct']}% | passed={res['passed']}")
        if res["detail"]["mismatches"]:
            print("  Mismatches:", res["detail"]["mismatches"][:10])
        if args.store:
            store_audit_result(res, run_kind=args.run_kind)

    if args.mode in ("angel", "all"):
        res = run_angel_audit(seed=args.seed)
        print(f"[D1.2 Angel] matched {res['matched_n']} of {res['sample_n']} ({res['match_pct']}%) | OHLC={res['detail']['stock_ohlc_matched_n']}/{res['detail']['stock_close_sample_n']} | Vol={res['detail']['stock_vol_matched_n']}/{res['detail']['stock_close_sample_n']} | Idx={res['detail']['index_matched_n']}/{res['detail']['index_sample_n']} | passed={res['passed']}")
        if res["detail"]["mismatches_meta"]:
            print("  Mismatches:", res["detail"]["mismatches_meta"][:10])
        if args.store:
            store_audit_result(res, run_kind=args.run_kind)

    if args.mode in ("corp", "all"):
        corp = run_corporate_actions_audit()
        print(f"[D1.3 Corporate Actions] total >35% 1D events={corp['total_events']}, liquid stocks affected={corp['liquid_stocks_with_discontinuity']}, in daily_plan_candidates={corp['in_daily_plan_candidates']}")
        for ev in corp["events_sample"][:15]:
            print(f"  {ev['date']} | {ev['symbol']:12s} | {ev['prev_close']} -> {ev['close']} ({ev['pct_chg']:+.1f}%) | ratio={ev['ratio']} | factor={ev['nearest_factor']} | liq={ev['is_liquid']}")


if __name__ == "__main__":
    main()
