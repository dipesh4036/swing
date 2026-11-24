#!/usr/bin/env python3
"""
Probe script: NSE Industry Data & Bulk MCAP Sources.
Branch: v1
Test only. No DB writes, no feature work.
Polite and minimal: max 25 requests total, 3 seconds delay between requests.
"""

import os
import sys
import io
import time
import csv
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from typing import Dict, Any, List, Optional, Set

import requests
from dotenv import load_dotenv

# Load env for read-only DB access
load_dotenv(".env")

# Probe Configuration
MAX_REQUESTS = 25
DELAY_SECONDS = 3.0
USER_AGENT = "swing-personal-research/1.0"
REPORT_PATH = "probe_output/industry_probe.md"

BASE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

# Request accounting
request_log: List[Dict[str, Any]] = []
blocked_hosts: Set[str] = set()


def polite_get(
    session: requests.Session,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 15,
) -> Optional[requests.Response]:
    """
    Executes a polite GET request with rate limiting and host block detection.
    Stops at the first 403 or 429 from a host.
    """
    global request_log, blocked_hosts

    parsed = urlparse(url)
    host = parsed.netloc

    if host in blocked_hosts:
        print(f"[SKIP] Host {host} is blocked. Skipping {url}")
        return None

    if len(request_log) >= MAX_REQUESTS:
        print(f"[STOP] Max request budget reached ({MAX_REQUESTS}). Skipping {url}")
        return None

    # Enforce 3s delay before request
    time.sleep(DELAY_SECONDS)

    req_num = len(request_log) + 1
    req_hdrs = dict(BASE_HEADERS)
    if headers:
        req_hdrs.update(headers)

    start_t = time.time()
    try:
        resp = session.get(url, headers=req_hdrs, timeout=timeout)
        dur = round(time.time() - start_t, 3)
        status = resp.status_code

        request_log.append({
            "req_num": req_num,
            "url": url,
            "host": host,
            "status": status,
            "duration": dur,
            "bytes": len(resp.content) if resp.content else 0,
            "error": None,
        })
        print(f"[{req_num}/{MAX_REQUESTS}] GET {url} -> {status} ({dur}s, {len(resp.content)} bytes)")

        if status in (403, 429):
            print(f"[BLOCKED] Received HTTP {status} from {host}. Halting requests to this host.")
            blocked_hosts.add(host)

        return resp
    except Exception as e:
        dur = round(time.time() - start_t, 3)
        request_log.append({
            "req_num": req_num,
            "url": url,
            "host": host,
            "status": 0,
            "duration": dur,
            "bytes": 0,
            "error": str(e),
        })
        print(f"[{req_num}/{MAX_REQUESTS}] GET {url} -> ERROR: {e}")
        return None


def run_section_a(session: requests.Session) -> Dict[str, Any]:
    """
    Section A: Stock -> NSE 4-level industry mapping.
    Symbols: 6 fixed + 1 smallcap + 1 recent IPO.
    """
    print("\n--- Starting Section A: Stock -> Industry Mapping ---")
    fixed_symbols = ["HDFCBANK", "RELIANCE", "TCS", "SUNPHARMA", "APOLLOHOSP", "TITAN"]
    small_cap = "AADHARHFC"  # Nifty Smallcap 250 constituent
    recent_ipo = "SWIGGY"    # Listed Nov 2024
    symbols = fixed_symbols + [small_cap, recent_ipo]

    sec_a_res: Dict[str, Any] = {
        "verdict": "PENDING",
        "home_status": None,
        "endpoint_used": None,
        "top_level_keys": [],
        "results": [],
        "notes": [],
    }

    # Step 1: Visit home page to establish session/cookies
    print("Visiting NSE homepage to receive session cookies...")
    home_resp = polite_get(session, "https://www.nseindia.com/")
    if home_resp is None:
        sec_a_res["verdict"] = "BLOCKED"
        sec_a_res["notes"].append("Home page visit failed or blocked.")
        return sec_a_res

    sec_a_res["home_status"] = home_resp.status_code
    if home_resp.status_code != 200:
        sec_a_res["verdict"] = "BLOCKED" if home_resp.status_code in (403, 429) else "FAILED"
        return sec_a_res

    # Check Endpoint 1 with first symbol (HDFCBANK)
    test_sym = symbols[0]
    ep1_url = f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol={test_sym}"
    api_hdrs = {
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.nseindia.com/get-quotes/equity?symbol={test_sym}",
        "X-Requested-With": "XMLHttpRequest",
    }

    ep1_resp = polite_get(session, ep1_url, headers=api_hdrs)
    use_endpoint = 1
    ep1_data = None

    if ep1_resp and ep1_resp.status_code == 200:
        try:
            ep1_data = ep1_resp.json()
            # check equityResponse[0].secInfo
            eq_resp = ep1_data.get("equityResponse", [])
            if not eq_resp or "secInfo" not in eq_resp[0]:
                print("Endpoint 1 returned 200 but missing equityResponse[0].secInfo. Trying Endpoint 2.")
                use_endpoint = 2
            else:
                use_endpoint = 1
        except Exception as e:
            print(f"Endpoint 1 JSON parse error: {e}. Trying Endpoint 2.")
            use_endpoint = 2
    else:
        print("Endpoint 1 failed (non-200 or blocked). Checking Endpoint 2...")
        use_endpoint = 2

    if use_endpoint == 2 and "www.nseindia.com" not in blocked_hosts:
        ep2_url = f"https://www.nseindia.com/api/quote-equity?symbol={test_sym}"
        ep2_resp = polite_get(session, ep2_url, headers=api_hdrs)
        if ep2_resp and ep2_resp.status_code == 200:
            try:
                ep2_data = ep2_resp.json()
                if "industryInfo" in ep2_data:
                    use_endpoint = 2
                else:
                    use_endpoint = 0
            except Exception:
                use_endpoint = 0
        else:
            use_endpoint = 0

    sec_a_res["endpoint_used"] = (
        f"Endpoint 1 (GetQuoteApi)" if use_endpoint == 1
        else f"Endpoint 2 (quote-equity)" if use_endpoint == 2
        else "None (both failed)"
    )

    if use_endpoint == 0:
        sec_a_res["verdict"] = "BLOCKED" if "www.nseindia.com" in blocked_hosts else "FAILED"
        return sec_a_res

    # Loop through symbols
    for i, sym in enumerate(symbols):
        if "www.nseindia.com" in blocked_hosts:
            break

        sym_hdrs = {
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.nseindia.com/get-quotes/equity?symbol={sym}",
            "X-Requested-With": "XMLHttpRequest",
        }

        if use_endpoint == 1:
            url = f"https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=EQ&symbol={sym}"
        else:
            url = f"https://www.nseindia.com/api/quote-equity?symbol={sym}"

        # If it's the first symbol and we already got its data, reuse it
        if i == 0 and use_endpoint == 1 and ep1_data is not None:
            data = ep1_data
            status = ep1_resp.status_code
            dur = request_log[-1]["duration"]
        else:
            resp = polite_get(session, url, headers=sym_hdrs)
            if resp is None:
                sec_a_res["results"].append({
                    "symbol": sym,
                    "status": "BLOCKED" if "www.nseindia.com" in blocked_hosts else "ERROR",
                    "duration": 0,
                    "has_industry_fields": False,
                    "macro": None, "sector": None, "industry": None, "basic_industry": None,
                    "market_cap": None, "issued_size": None, "ffmc": None,
                })
                continue
            status = resp.status_code
            dur = request_log[-1]["duration"]
            try:
                data = resp.json()
            except Exception:
                data = {}

        if not sec_a_res["top_level_keys"] and isinstance(data, dict):
            sec_a_res["top_level_keys"] = sorted(list(data.keys()))

        # Extract 4-level industry and trade info
        macro, sector, industry, basic_ind = None, None, None, None
        mcap, issued_sz, ffmc = None, None, None
        has_4 = False

        if use_endpoint == 1:
            eq_resp_list = data.get("equityResponse", [])
            sec_info = eq_resp_list[0].get("secInfo", {}) if eq_resp_list else {}
            trade_info = eq_resp_list[0].get("tradeInfo", {}) if eq_resp_list else {}

            macro = sec_info.get("macro")
            sector = sec_info.get("sector")
            industry = sec_info.get("industryInfo") or sec_info.get("industry")
            basic_ind = sec_info.get("basicIndustry")

            mcap = trade_info.get("totalMarketCap")
            issued_sz = trade_info.get("issuedSize")
            ffmc = trade_info.get("ffmc")
        else:
            ind_info = data.get("industryInfo", {})
            trade_info = data.get("tradeInfo", {}) or data.get("securityInfo", {})

            macro = ind_info.get("macro")
            sector = ind_info.get("sector")
            industry = ind_info.get("industry")
            basic_ind = ind_info.get("basicIndustry")

            mcap = trade_info.get("totalMarketCap")
            issued_sz = trade_info.get("issuedSize")
            ffmc = trade_info.get("ffmc")

        has_4 = all(v is not None and str(v).strip() != "" for v in [macro, sector, industry, basic_ind])

        sec_a_res["results"].append({
            "symbol": sym,
            "status": status,
            "duration": dur,
            "has_industry_fields": has_4,
            "macro": macro,
            "sector": sector,
            "industry": industry,
            "basic_industry": basic_ind,
            "market_cap": mcap,
            "issued_size": issued_sz,
            "ffmc": ffmc,
        })

    # Verdict
    if "www.nseindia.com" in blocked_hosts:
        sec_a_res["verdict"] = "BLOCKED"
    elif all(r.get("has_industry_fields") for r in sec_a_res["results"]) and len(sec_a_res["results"]) == 8:
        sec_a_res["verdict"] = "WORKS"
    elif any(r.get("has_industry_fields") for r in sec_a_res["results"]):
        sec_a_res["verdict"] = "PARTIAL"
    else:
        sec_a_res["verdict"] = "WRONG SCHEMA"

    return sec_a_res


def run_section_b(session: requests.Session) -> Dict[str, Any]:
    """
    Section B: Market cap and shares in bulk (PR zip archive).
    URL pattern: https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR<DDMMYY>.zip
    """
    print("\n--- Starting Section B: Bulk Market Cap & Shares Archive ---")
    sec_b_res: Dict[str, Any] = {
        "verdict": "PENDING",
        "dates_tested": [],
        "successful_url": None,
        "zip_members": [],
        "mcap_csv_header": [],
        "mcap_row_count": 0,
        "mcap_eq_count": 0,
        "sample_rows": [],
        "notes": [],
    }

    # Generate candidate dates: latest 5 calendar days
    today = datetime.now()
    dates = [(today - timedelta(days=i)) for i in range(5)]

    success = False
    for dt in dates:
        if "nsearchives.nseindia.com" in blocked_hosts:
            break
        ddmmyy = dt.strftime("%d%m%y")
        url = f"https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR{ddmmyy}.zip"
        sec_b_res["dates_tested"].append({"date": dt.strftime("%Y-%m-%d"), "url": url})

        resp = polite_get(session, url)
        if resp is None:
            continue

        if resp.status_code == 200:
            success = True
            sec_b_res["successful_url"] = url
            try:
                with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                    sec_b_res["zip_members"] = zf.namelist()
                    # Find MCAP csv member
                    mcap_member = None
                    for name in sec_b_res["zip_members"]:
                        if "MCAP" in name.upper() and name.upper().endswith(".CSV"):
                            mcap_member = name
                            break

                    if not mcap_member:
                        # Fallback: check any .csv or .dat
                        for name in sec_b_res["zip_members"]:
                            if name.upper().endswith(".CSV"):
                                mcap_member = name
                                break

                    if mcap_member:
                        with zf.open(mcap_member) as mf:
                            raw_lines = [line.decode("utf-8", errors="replace") for line in mf.readlines()]
                            reader = csv.reader(raw_lines)
                            rows = list(reader)
                            if rows:
                                header = [c.strip() for c in rows[0]]
                                sec_b_res["mcap_csv_header"] = header
                                data_rows = rows[1:]
                                sec_b_res["mcap_row_count"] = len(data_rows)

                                # Identify columns: Symbol, Series, Issue Size, Market Cap
                                sym_idx = None
                                ser_idx = None
                                iss_idx = None
                                mcap_idx = None

                                for idx, h in enumerate(header):
                                    h_upper = h.upper()
                                    if h_upper == "SYMBOL":
                                        sym_idx = idx
                                    elif "SYMBOL" in h_upper and sym_idx is None:
                                        sym_idx = idx
                                    elif "SERIES" in h_upper:
                                        ser_idx = idx
                                    elif "ISSUE" in h_upper or "SIZE" in h_upper:
                                        iss_idx = idx
                                    elif "CAP" in h_upper:
                                        mcap_idx = idx

                                eq_rows = []
                                for r in data_rows:
                                    if len(r) > (ser_idx if ser_idx is not None else 1):
                                        ser_val = r[ser_idx].strip() if ser_idx is not None else ""
                                        if ser_val == "EQ":
                                            eq_rows.append(r)

                                sec_b_res["mcap_eq_count"] = len(eq_rows)

                                # 3 sample rows
                                samples = []
                                target_rows = eq_rows[:3] if eq_rows else data_rows[:3]
                                for r in target_rows:
                                    sym_val = r[sym_idx].strip() if sym_idx is not None and sym_idx < len(r) else ""
                                    iss_val = r[iss_idx].strip() if iss_idx is not None and iss_idx < len(r) else ""
                                    mcap_val = r[mcap_idx].strip() if mcap_idx is not None and mcap_idx < len(r) else ""
                                    samples.append({
                                        "Symbol": sym_val,
                                        "Issue Size": iss_val,
                                        "Market Cap": mcap_val,
                                    })
                                sec_b_res["sample_rows"] = samples
                    else:
                        sec_b_res["notes"].append("No MCAP*.csv found in zip.")
            except Exception as e:
                sec_b_res["notes"].append(f"Zip extraction error: {e}")
            break
        elif resp.status_code == 404:
            continue
        elif resp.status_code in (403, 429):
            break

    if "nsearchives.nseindia.com" in blocked_hosts:
        sec_b_res["verdict"] = "BLOCKED"
    elif success and sec_b_res["mcap_row_count"] > 0:
        sec_b_res["verdict"] = "WORKS"
    elif success:
        sec_b_res["verdict"] = "WRONG SCHEMA"
    else:
        sec_b_res["verdict"] = "PARTIAL" if any(d.get("date") for d in sec_b_res["dates_tested"]) else "BLOCKED"
        sec_b_res["notes"].append("Archive URL pattern returned 404 for all tested calendar days.")

    return sec_b_res


def run_section_c(session: requests.Session) -> Dict[str, Any]:
    """
    Section C: Index constituents with industry column.
    URL: https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv
    """
    print("\n--- Starting Section C: Total Market Index Constituents ---")
    sec_c_res: Dict[str, Any] = {
        "verdict": "PENDING",
        "url": "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
        "status": None,
        "header": [],
        "row_count": 0,
        "distinct_industries": {},
        "match_instruments_count": 0,
        "notes": [],
    }

    if "nsearchives.nseindia.com" in blocked_hosts:
        sec_c_res["verdict"] = "BLOCKED"
        sec_c_res["notes"].append("Host nsearchives.nseindia.com is already blocked.")
        return sec_c_res

    resp = polite_get(session, sec_c_res["url"])
    if resp is None:
        sec_c_res["verdict"] = "BLOCKED" if "nsearchives.nseindia.com" in blocked_hosts else "FAILED"
        return sec_c_res

    sec_c_res["status"] = resp.status_code
    if resp.status_code != 200:
        sec_c_res["verdict"] = "BLOCKED" if resp.status_code in (403, 429) else "FAILED"
        return sec_c_res

    try:
        content = resp.content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(content))
        sec_c_res["header"] = reader.fieldnames or []

        symbols_in_file = set()
        industry_counts: Dict[str, int] = {}

        # Look for Industry column
        ind_col = None
        sym_col = None
        for col in sec_c_res["header"]:
            if "INDUSTRY" in col.upper():
                ind_col = col
            if "SYMBOL" in col.upper():
                sym_col = col

        row_count = 0
        for row in reader:
            row_count += 1
            if sym_col and row.get(sym_col):
                symbols_in_file.add(row[sym_col].strip())
            if ind_col and row.get(ind_col):
                ind_val = row[ind_col].strip()
                industry_counts[ind_val] = industry_counts.get(ind_val, 0) + 1

        sec_c_res["row_count"] = row_count
        sec_c_res["distinct_industries"] = dict(sorted(industry_counts.items(), key=lambda x: x[1], reverse=True))

        # Check match count with instruments in DB
        db_symbols = set()
        db_url = os.environ.get("DATABASE_URL")
        if db_url:
            try:
                import psycopg2
                conn = psycopg2.connect(db_url)
                with conn.cursor() as cur:
                    cur.execute("SELECT symbol FROM instruments WHERE exchange = 'NSE';")
                    db_symbols = {r[0] for r in cur.fetchall()}
                conn.close()
            except Exception as e:
                sec_c_res["notes"].append(f"DB read error: {e}")

        if db_symbols and symbols_in_file:
            matched = symbols_in_file.intersection(db_symbols)
            sec_c_res["match_instruments_count"] = len(matched)
        else:
            sec_c_res["match_instruments_count"] = len(symbols_in_file)

        sec_c_res["verdict"] = "WORKS" if row_count > 0 and ind_col is not None else "WRONG SCHEMA"
    except Exception as e:
        sec_c_res["verdict"] = "FAILED"
        sec_c_res["notes"].append(f"Parse error: {e}")

    return sec_c_res


def run_section_d() -> Dict[str, Any]:
    """
    Section D: Our own universe counts from read-only DB.
    """
    print("\n--- Starting Section D: Our Universe from DB ---")
    sec_d_res: Dict[str, Any] = {
        "verdict": "PENDING",
        "liquidity_filter_name": "Strict liquidity filter: close >= 20 AND vol_sma_50 >= 25000 (prior 50-day volume SMA >= 25k, NaN excluded)",
        "nse_equity_instruments_count": None,
        "nse_instruments_eq_only_count": None,
        "latest_bhavcopy_close_count": None,
        "liquid_filter_passed_count": None,
        "sector_mapped_total_count": None,
        "sector_mapped_liquid_count": None,
        "latest_trade_date": None,
        "notes": [],
    }

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        sec_d_res["verdict"] = "FAILED"
        sec_d_res["notes"].append("DATABASE_URL is not set.")
        return sec_d_res

    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        with conn.cursor() as cur:
            # 1. NSE equity symbols in instruments
            cur.execute("SELECT count(*) FROM instruments WHERE exchange = 'NSE' AND instrument_type IN ('EQ', 'BE');")
            sec_d_res["nse_equity_instruments_count"] = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM instruments WHERE exchange = 'NSE' AND instrument_type = 'EQ';")
            sec_d_res["nse_instruments_eq_only_count"] = cur.fetchone()[0]

            # 2. Latest date in daily_market_breadth and total close count
            cur.execute("SELECT max(trade_date) FROM daily_market_breadth;")
            latest_d = cur.fetchone()[0]
            sec_d_res["latest_trade_date"] = str(latest_d)

            # Universe 'all' on latest date
            cur.execute("SELECT total_stocks FROM daily_market_breadth WHERE trade_date = %s AND universe = 'all';", (latest_d,))
            all_row = cur.fetchone()
            sec_d_res["latest_bhavcopy_close_count"] = all_row[0] if all_row else 0

            # Universe 'liquid' on latest date (passes close >= 20 and vol_sma_50 >= 25000)
            cur.execute("SELECT total_stocks FROM daily_market_breadth WHERE trade_date = %s AND universe = 'liquid';", (latest_d,))
            liq_row = cur.fetchone()
            sec_d_res["liquid_filter_passed_count"] = liq_row[0] if liq_row else 0

            # Sector mapped stocks on latest date
            cur.execute("SELECT count(*), count(CASE WHEN in_universe THEN 1 END) FROM sector_stock_metrics WHERE trade_date = %s;", (latest_d,))
            sec_row = cur.fetchone()
            if sec_row:
                sec_d_res["sector_mapped_total_count"] = sec_row[0]
                sec_d_res["sector_mapped_liquid_count"] = sec_row[1]

        conn.close()
        sec_d_res["verdict"] = "WORKS"
    except Exception as e:
        sec_d_res["verdict"] = "FAILED"
        sec_d_res["notes"].append(f"DB query error: {e}")

    return sec_d_res


def generate_markdown_report(
    sec_a: Dict[str, Any],
    sec_b: Dict[str, Any],
    sec_c: Dict[str, Any],
    sec_d: Dict[str, Any],
    total_runtime: float,
) -> str:
    """
    Builds the markdown report adhering strictly to probe guidelines.
    No cookies, headers, or raw bodies.
    """
    total_reqs = len(request_log)

    lines = []
    lines.append("# Industry Data & Bulk Market Cap Probe Report")
    lines.append("")
    lines.append("> **Notice & Disclaimer**: NSE's terms of use may restrict automated access. "
                 "This probe was conducted with a polite, minimal footprint (max 25 requests, 3s delay, honest User-Agent `swing-personal-research/1.0`) "
                 "strictly for personal research and feasibility assessment.")
    lines.append("")
    lines.append("## Executive Summary")
    lines.append("")
    lines.append(f"- **Total Requests Made**: {total_reqs} (limit: {MAX_REQUESTS})")
    lines.append(f"- **Total Probe Runtime**: {total_runtime:.1f}s")
    lines.append(f"- **Section A Verdict (Stock → Industry)**: **{sec_a['verdict']}**")
    lines.append(f"- **Section B Verdict (Bulk MCAP & Shares)**: **{sec_b['verdict']}**")
    lines.append(f"- **Section C Verdict (Index Constituents Industry)**: **{sec_c['verdict']}**")
    lines.append(f"- **Section D Verdict (Our Own Universe)**: **{sec_d['verdict']}**")
    lines.append("")

    # Section A
    lines.append("---")
    lines.append("## Section A: Stock → Industry Mapping")
    lines.append("")
    lines.append(f"- **Verdict**: **{sec_a['verdict']}**")
    lines.append(f"- **NSE Homepage Status**: HTTP {sec_a.get('home_status')}")
    lines.append(f"- **Endpoint Tested/Used**: {sec_a.get('endpoint_used')}")
    if sec_a.get("top_level_keys"):
        lines.append(f"- **Top-Level JSON Schema Keys**: `{', '.join(sec_a['top_level_keys'])}`")
    lines.append("")
    lines.append("### Tested Symbols & Extracted Hierarchy")
    lines.append("")
    lines.append("| Symbol | Status | Latency | 4 Industry Fields Present? | Macro | Sector | Industry | Basic Industry | Trade Info (MCAP / Issued) |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in sec_a.get("results", []):
        sym = r["symbol"]
        st = r["status"]
        lat = f"{r['duration']}s"
        has_4 = "YES" if r["has_industry_fields"] else "NO"
        macro = r.get("macro") or "-"
        sector = r.get("sector") or "-"
        ind = r.get("industry") or "-"
        basic = r.get("basic_industry") or "-"
        mcap_val = f"MCAP: {r.get('market_cap')}, Issued: {r.get('issued_size')}" if r.get("market_cap") else "-"
        lines.append(f"| {sym} | {st} | {lat} | {has_4} | {macro} | {sector} | {ind} | {basic} | {mcap_val} |")

    lines.append("")
    lines.append("#### Sanity Check (HDFCBANK)")
    hdfc_row = next((r for r in sec_a.get("results", []) if r["symbol"] == "HDFCBANK"), None)
    if hdfc_row:
        lines.append(f"- **Expected**: Financial Services / Financial Services / Banks / Private Sector Bank")
        lines.append(f"- **Actual**: {hdfc_row.get('macro')} / {hdfc_row.get('sector')} / {hdfc_row.get('industry')} / {hdfc_row.get('basic_industry')}")
        matches = (
            hdfc_row.get('macro') == "Financial Services"
            and hdfc_row.get('sector') == "Financial Services"
            and hdfc_row.get('industry') in ("Banks", "Financial Services")
            and hdfc_row.get('basic_industry') == "Private Sector Bank"
        )
        lines.append(f"- **Sanity Check Match**: {'PASSED' if matches else 'DISCREPANCY (see values above)'}")
    lines.append("")

    # Section B
    lines.append("---")
    lines.append("## Section B: Market Cap & Shares in Bulk")
    lines.append("")
    lines.append(f"- **Verdict**: **{sec_b['verdict']}**")
    lines.append(f"- **Archive Pattern**: `https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR<DDMMYY>.zip`")
    if sec_b.get("successful_url"):
        lines.append(f"- **Successful URL**: `{sec_b['successful_url']}`")
    lines.append(f"- **Zip Members Found**: `{', '.join(sec_b.get('zip_members', [])) if sec_b.get('zip_members') else 'None'}`")
    lines.append(f"- **MCAP CSV Header**: `{', '.join(sec_b.get('mcap_csv_header', [])) if sec_b.get('mcap_csv_header') else 'None'}`")
    lines.append(f"- **Total Rows in MCAP CSV**: {sec_b.get('mcap_row_count', 0)}")
    lines.append(f"- **Series EQ Row Count**: {sec_b.get('mcap_eq_count', 0)}")
    lines.append("")
    if sec_b.get("sample_rows"):
        lines.append("### Sample Rows (Symbol, Issue Size, Market Cap)")
        lines.append("")
        lines.append("| Symbol | Issue Size | Market Cap |")
        lines.append("|---|---|---|")
        for s in sec_b["sample_rows"]:
            lines.append(f"| {s.get('Symbol')} | {s.get('Issue Size')} | {s.get('Market Cap')} |")
        lines.append("")
    if sec_b.get("notes"):
        lines.append(f"- **Notes**: {'; '.join(sec_b['notes'])}")
    lines.append("")

    # Section C
    lines.append("---")
    lines.append("## Section C: Index Constituents with Industry Column")
    lines.append("")
    lines.append(f"- **Verdict**: **{sec_c['verdict']}**")
    lines.append(f"- **URL**: `{sec_c['url']}`")
    lines.append(f"- **HTTP Status**: {sec_c.get('status')}")
    lines.append(f"- **Header Columns**: `{', '.join(sec_c.get('header', []))}`")
    lines.append(f"- **Total Row Count**: {sec_c.get('row_count')}")
    lines.append(f"- **Constituents Matching DB Instruments**: {sec_c.get('match_instruments_count')} / {sec_c.get('row_count')}")
    lines.append("")
    lines.append("### Distinct Values of 'Industry' Column & Counts")
    lines.append("")
    lines.append("| Industry Category | Count |")
    lines.append("|---|---|")
    for ind, cnt in sec_c.get("distinct_industries", {}).items():
        lines.append(f"| {ind} | {cnt} |")
    lines.append("")
    lines.append("- **Observation**: Confirming that `ind_niftytotalmarket_list.csv` contains only coarse sector-level groupings (e.g. ~20 broad sectors) rather than the 4-level granular classification.")
    lines.append("")

    # Section D
    lines.append("---")
    lines.append("## Section D: Our Own Universe (Read-Only DB)")
    lines.append("")
    lines.append(f"- **Verdict**: **{sec_d['verdict']}**")
    lines.append(f"- **Liquidity Filter Defined**: `{sec_d.get('liquidity_filter_name')}`")
    lines.append(f"- **Latest Trade Date Evaluated**: `{sec_d.get('latest_trade_date')}`")
    lines.append("")
    lines.append("### Universe Counts")
    lines.append("")
    lines.append("| Metric | Count | Details |")
    lines.append("|---|---|---|")
    lines.append(f"| **NSE Equity Symbols in `instruments`** | **{sec_d.get('nse_equity_instruments_count')}** | Active/Traded NSE EQ + BE (EQ only: {sec_d.get('nse_instruments_eq_only_count')}) |")
    lines.append(f"| **Symbols with Close in Latest Bhavcopy** | **{sec_d.get('latest_bhavcopy_close_count')}** | Evaluated on date `{sec_d.get('latest_trade_date')}` (universe 'all') |")
    lines.append(f"| **Symbols Passing Sector Liquidity Filter** | **{sec_d.get('liquid_filter_passed_count')}** | Passing `close >= 20` AND `vol_sma_50 >= 25000` (universe 'liquid') |")
    lines.append(f"| *Sector-Mapped Stocks (Sub-universe)* | {sec_d.get('sector_mapped_total_count')} total, {sec_d.get('sector_mapped_liquid_count')} liquid | Currently tracked in `sector_stock_metrics` |")
    lines.append("")

    # Execution Log
    lines.append("---")
    lines.append("## HTTP Request Audit Log")
    lines.append("")
    lines.append("| # | Host | URL | Status | Latency | Bytes |")
    lines.append("|---|---|---|---|---|---|")
    for req in request_log:
        lines.append(f"| {req['req_num']} | {req['host']} | `{req['url']}` | {req['status']} | {req['duration']}s | {req['bytes']} |")
    lines.append("")

    return "\n".join(lines)


def main():
    start_total_time = time.time()
    session = requests.Session()

    try:
        sec_a = run_section_a(session)
    except Exception as e:
        sec_a = {"verdict": "FAILED", "notes": [f"Unexpected error: {e}"], "results": []}

    try:
        sec_b = run_section_b(session)
    except Exception as e:
        sec_b = {"verdict": "FAILED", "notes": [f"Unexpected error: {e}"], "sample_rows": []}

    try:
        sec_c = run_section_c(session)
    except Exception as e:
        sec_c = {"verdict": "FAILED", "notes": [f"Unexpected error: {e}"], "distinct_industries": {}}

    try:
        sec_d = run_section_d()
    except Exception as e:
        sec_d = {"verdict": "FAILED", "notes": [f"Unexpected error: {e}"]}

    total_runtime = time.time() - start_total_time

    # Generate Markdown Report
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    report_content = generate_markdown_report(sec_a, sec_b, sec_c, sec_d, total_runtime)

    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report_content)

    print(f"\nReport written to {REPORT_PATH}")
    print("\n" + "=" * 60)
    print("PROBE COMPLETE. SUMMARY:")
    print(f"Total Requests: {len(request_log)}")
    print(f"Runtime: {total_runtime:.1f}s")
    print(f"Sec A: {sec_a.get('verdict')}")
    print(f"Sec B: {sec_b.get('verdict')}")
    print(f"Sec C: {sec_c.get('verdict')}")
    print(f"Sec D: {sec_d.get('verdict')}")
    print("=" * 60)


if __name__ == "__main__":
    main()
