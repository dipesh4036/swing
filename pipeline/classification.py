"""
NSE 4-level industry classification normalization, validation, bootstrap, and incremental sync.

Portions of normalization and schema constants adapted from dopawire/nse-relative-strength (MIT License).
"""

import csv
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from psycopg2.extras import execute_values

from pipeline.classification_fetch import NseQuoteClassifier, fetch_equity_list
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.classification")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SEED_MASTER_CSV = os.path.join(DATA_DIR, "nse_stock_master.csv")
OVERRIDES_CSV = os.path.join(DATA_DIR, "nse_classification_overrides.csv")
SYMBOL_CHANGES_CSV = os.path.join(DATA_DIR, "nse_symbol_changes.csv")

# NSE's current (2023+) 12 macro groups
CURRENT_MACROS = frozenset({
    "Commodities",
    "Consumer Discretionary",
    "Diversified",
    "Energy",
    "Fast Moving Consumer Goods",
    "Financial Services",
    "Healthcare",
    "Industrials",
    "Information Technology",
    "Services",
    "Telecommunication",
    "Utilities",
})

_LOWER_WORDS = {"and", "of", "in", "for", "the", "or", "with"}
_COMMON_SHORT = {
    "of", "and", "the", "ltd", "co", "pvt", "one", "new", "for",
    "in", "big", "sun", "tea", "oil", "gas", "art", "web", "hi", "go",
    "om", "sky", "we", "win", "gem", "tek",
}


def standard_name(value: Optional[str]) -> str:
    """
    Normalize classification label spelling:
    Title Case words, joining words lowercase after first word,
    acronyms kept intact, mis-decoded dashes repaired.
    """
    v = re.sub(r"\s*\ufffd+\s*", " - ", value or "")
    v = " ".join(v.split())
    if not v:
        return ""
    if v.isupper() and len(v) > 4:
        v = v.title()
    words = v.split(" ")
    for i, w in enumerate(words):
        if i and w.lower() in _LOWER_WORDS:
            words[i] = w.lower()
            continue
        if not w or not w[0].isalpha() or any(c.isupper() for c in w):
            continue
        words[i] = w[0].upper() + w[1:]
    return " ".join(words)


def standard_company(name: Optional[str]) -> str:
    """Normalize ALL-CAPS NSE company names to Title Case while preserving acronyms."""
    cleaned = " ".join((name or "").split())
    if not cleaned or not cleaned.isupper():
        return cleaned

    def fix(tok: str) -> str:
        letters = "".join(c for c in tok if c.isalpha())
        if not letters:
            return tok
        low = letters.lower()
        if low in _COMMON_SHORT:
            word = low if low in ("of", "and", "the", "for", "in") else low.capitalize()
            return tok.replace(letters, word) if letters in tok else tok
        if len(letters) <= 3 or not (set(low) & set("aeiouy")):
            return tok
        out = []
        up = True
        for c in tok:
            if c.isalpha():
                out.append(c.upper() if up else c.lower())
            else:
                out.append(c)
            up = not c.isalpha() and c != "'"
        return "".join(out)

    words = []
    for i, w in enumerate(cleaned.split(" ")):
        w = "-".join(fix(p) for p in w.split("-"))
        if i == 0 and w[:1].islower():
            w = w[0].upper() + w[1:]
        words.append(w)
    return " ".join(words)


@dataclass(frozen=True)
class ClassificationRecord:
    symbol: str
    company: str
    series: str
    isin: str
    macro: str
    sector: str
    industry: str
    basic_industry: str
    source: str = "seed"

    def is_valid(self) -> bool:
        return bool(
            self.symbol
            and self.macro in CURRENT_MACROS
            and self.sector
            and self.industry
            and self.basic_industry
        )

    def hierarchy_tuple(self) -> Tuple[str, str, str, str]:
        return (self.macro, self.sector, self.industry, self.basic_industry)


def load_overrides(path: str = OVERRIDES_CSV) -> Dict[str, Tuple[str, str, str, str]]:
    """Load explicit overrides keyed by uppercase symbol."""
    if not os.path.exists(path):
        return {}
    overrides: Dict[str, Tuple[str, str, str, str]] = {}
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        required = {"symbol", "macro", "sector", "industry", "basicIndustry"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise ValueError(f"Overrides CSV {path} missing required columns {sorted(required)}")
        for row in reader:
            sym = (row.get("symbol") or "").strip().upper()
            if not sym:
                continue
            vals = (
                standard_name(row.get("macro")),
                standard_name(row.get("sector")),
                standard_name(row.get("industry")),
                standard_name(row.get("basicIndustry")),
            )
            if all(vals):
                overrides[sym] = vals
    return overrides


def load_seed_records(
    master_path: str = SEED_MASTER_CSV,
    overrides_path: str = OVERRIDES_CSV,
) -> Tuple[List[ClassificationRecord], List[str]]:
    """
    Load and validate pinned seed CSV + overrides.
    Rejects missing identity and detects conflicting duplicate classifications.
    Returns (valid_records, conflict_or_error_notes).
    """
    if not os.path.exists(master_path):
        raise FileNotFoundError(f"Seed master CSV not found: {master_path}")

    overrides = load_overrides(overrides_path)
    seen_isin: Dict[str, ClassificationRecord] = {}
    seen_sym: Dict[str, ClassificationRecord] = {}
    records: List[ClassificationRecord] = []
    conflicts: List[str] = []

    with open(master_path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        required = {"symbol", "company", "series", "isin", "macro", "sector", "industry", "basicIndustry"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise ValueError(f"Seed CSV {master_path} missing required columns {sorted(required)}")

        for line_no, row in enumerate(reader, start=2):
            sym = (row.get("symbol") or "").strip().upper()
            isin = (row.get("isin") or "").strip().upper()
            if not sym or not isin:
                conflicts.append(f"Line {line_no}: missing symbol or ISIN")
                continue

            if sym in overrides:
                macro, sector, ind, basic = overrides[sym]
                src = "override"
            else:
                macro = standard_name(row.get("macro"))
                sector = standard_name(row.get("sector"))
                ind = standard_name(row.get("industry"))
                basic = standard_name(row.get("basicIndustry"))
                src = "seed"

            rec = ClassificationRecord(
                symbol=sym,
                company=standard_company(row.get("company") or sym),
                series=(row.get("series") or "EQ").strip().upper(),
                isin=isin,
                macro=macro,
                sector=sector,
                industry=ind,
                basic_industry=basic,
                source=src,
            )

            if not rec.is_valid():
                conflicts.append(f"{sym} ({isin}): invalid or retired classification ({macro}/{sector}/{ind}/{basic})")
                continue

            if isin in seen_isin and seen_isin[isin].hierarchy_tuple() != rec.hierarchy_tuple():
                conflicts.append(f"Duplicate ISIN conflict for {isin}: {seen_isin[isin].symbol} vs {sym}")
                continue
            if sym in seen_sym and seen_sym[sym].hierarchy_tuple() != rec.hierarchy_tuple():
                conflicts.append(f"Duplicate symbol conflict for {sym}")
                continue

            seen_isin[isin] = rec
            seen_sym[sym] = rec
            records.append(rec)

    return records, conflicts


def _build_seed_lookups(
    records: List[ClassificationRecord],
) -> Tuple[Dict[str, ClassificationRecord], Dict[str, ClassificationRecord]]:
    by_isin: Dict[str, ClassificationRecord] = {}
    by_sym: Dict[str, ClassificationRecord] = {}
    for rec in records:
        if rec.isin:
            by_isin[rec.isin] = rec
        by_sym[rec.symbol] = rec
    return by_isin, by_sym


def match_instrument_to_seed(
    symbol: str,
    isin: Optional[str],
    by_isin: Dict[str, ClassificationRecord],
    by_sym: Dict[str, ClassificationRecord],
) -> Optional[ClassificationRecord]:
    """Match ISIN first, then uppercase symbol fallback (only if ISIN does not conflict)."""
    clean_isin = (isin or "").strip().upper()
    clean_sym = (symbol or "").strip().upper()

    if clean_isin and clean_isin in by_isin:
        return by_isin[clean_isin]

    if clean_sym and clean_sym in by_sym:
        cand = by_sym[clean_sym]
        if clean_isin and cand.isin and clean_isin != cand.isin:
            return None
        return cand

    return None


def _upsert_classification_batches(
    conn,
    updates: List[Tuple[int, str, str, str, str, str, str, str]],
) -> None:
    """
    Update instruments classification columns and upsert stock_industry atomically.
    updates tuple: (token, symbol, macro, sector, industry, basic_industry, source, status)
    """
    if not updates:
        return

    with conn.cursor() as cur:
        inst_rows = [
            (u[2], u[3], u[4], u[5], u[6], u[7], u[0])
            for u in updates
        ]
        execute_values(
            cur,
            """
            UPDATE instruments AS i
            SET macro_sector = v.macro_sector,
                sector = v.sector,
                industry = v.industry,
                basic_industry = v.basic_industry,
                classification_source = v.classification_source,
                classification_status = v.classification_status,
                classification_updated_at = NOW(),
                classification_retry_after = NULL,
                classification_attempts = 0
            FROM (VALUES %s) AS v(
                macro_sector, sector, industry, basic_industry,
                classification_source, classification_status, token
            )
            WHERE i.token = v.token;
            """,
            inst_rows,
            page_size=1000,
        )

        # Keep stock_industry in sync for backward compatibility
        si_rows = [
            (u[1], u[2], u[3], u[4], u[5], u[6])
            for u in updates
        ]
        execute_values(
            cur,
            """
            INSERT INTO stock_industry (symbol, macro, sector, industry, basic_industry, source, fetched_at)
            VALUES %s
            ON CONFLICT (symbol) DO UPDATE SET
                macro = EXCLUDED.macro,
                sector = EXCLUDED.sector,
                industry = EXCLUDED.industry,
                basic_industry = EXCLUDED.basic_industry,
                source = EXCLUDED.source,
                fetched_at = NOW();
            """,
            si_rows,
            template="(%s, %s, %s, %s, %s, %s, NOW())",
            page_size=1000,
        )


def bootstrap_classification(conn=None, dry_run: bool = False) -> Dict[str, Any]:
    """
    Idempotently bootstrap classification on active NSE instruments from the pinned CSV seed + overrides.
    Never overwrites tokens, prices, or provider identifiers.
    """
    t0 = time.time()
    records, conflicts = load_seed_records()
    by_isin, by_sym = _build_seed_lookups(records)

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, isin, instrument_type,
                       macro_sector, sector, industry, basic_industry,
                       classification_source, classification_status
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY symbol;
                """
            )
            instruments = cur.fetchall()

        matched = 0
        unchanged = 0
        updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        unresolved: List[str] = []

        for row in instruments:
            token, sym, isin, _itype, cur_m, cur_s, cur_i, cur_b, cur_src, cur_status = row
            rec = match_instrument_to_seed(sym, isin, by_isin, by_sym)
            if rec is None:
                unresolved.append(sym)
                continue

            matched += 1
            if (
                cur_m == rec.macro
                and cur_s == rec.sector
                and cur_i == rec.industry
                and cur_b == rec.basic_industry
                and cur_src == rec.source
                and cur_status == "mapped"
            ):
                unchanged += 1
                continue

            updates.append((
                token,
                sym,
                rec.macro,
                rec.sector,
                rec.industry,
                rec.basic_industry,
                rec.source,
                "mapped",
            ))

        if not dry_run and updates:
            _upsert_classification_batches(conn, updates)
            conn.commit()

        duration = round(time.time() - t0, 2)
        summary = {
            "dry_run": dry_run,
            "total_instruments": len(instruments),
            "seed_records": len(records),
            "matched": matched,
            "updated": len(updates),
            "unchanged": unchanged,
            "unmapped": len(unresolved),
            "conflicts": len(conflicts),
            "unresolved_sample": unresolved[:15],
            "duration_sec": duration,
        }
        logger.info(
            f"Classification bootstrap complete (dry_run={dry_run}): "
            f"total={summary['total_instruments']}, matched={matched}, updated={len(updates)}, "
            f"unmapped={len(unresolved)}, conflicts={len(conflicts)}, {duration}s"
        )
        return summary
    finally:
        if should_close and conn:
            conn.close()


def sync_classification(
    conn=None,
    dry_run: bool = False,
    retry_missing: bool = False,
    refresh_symbol: Optional[str] = None,
    fetch_equity: bool = True,
    classifier: Optional[NseQuoteClassifier] = None,
) -> Dict[str, Any]:
    """
    Incremental classification sync:
    1. Reads existing instrument classification state once.
    2. Applies local pinned seed + overrides to any unmapped/incomplete instruments first.
    3. Queues only remaining missing/incomplete (or due retries if retry_missing, or refresh_symbol).
    4. If queue is empty, returns immediately with 0 per-stock lookups.
    5. On HTTP 403/429 or timeout, preserves prior valid data and records retry backoff.
    """
    t0 = time.time()
    records, conflicts = load_seed_records()
    by_isin, by_sym = _build_seed_lookups(records)
    overrides = load_overrides()

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, isin, instrument_type,
                       macro_sector, sector, industry, basic_industry,
                       classification_source, classification_status,
                       classification_retry_after, COALESCE(classification_attempts, 0)
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY symbol;
                """
            )
            instruments = cur.fetchall()

        now_utc = datetime.now(timezone.utc)
        seed_updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        queue: List[Tuple[int, str, str, int]] = []  # (token, symbol, series, attempts)
        already_mapped = 0

        target_sym = refresh_symbol.strip().upper() if refresh_symbol else None
        equity_map = fetch_equity_list() if (fetch_equity and not dry_run) else None

        for row in instruments:
            (
                token, sym, isin, itype,
                cur_m, cur_s, cur_i, cur_b,
                cur_src, cur_status, retry_after, attempts,
            ) = row
            sym_u = sym.upper()
            has_valid = bool(
                cur_m in CURRENT_MACROS and cur_s and cur_i and cur_b
            )

            # Force refresh specific symbol if requested
            if target_sym:
                if sym_u == target_sym:
                    ser = (equity_map[sym_u].series if equity_map and sym_u in equity_map else itype) or "EQ"
                    queue.append((token, sym_u, ser, attempts))
                continue

            if has_valid:
                already_mapped += 1
                continue

            # Try local seed + overrides before queuing any external request
            rec = match_instrument_to_seed(sym_u, isin, by_isin, by_sym)
            if rec is not None:
                seed_updates.append((
                    token, sym_u, rec.macro, rec.sector, rec.industry, rec.basic_industry,
                    rec.source, "mapped",
                ))
                continue

            # Check retry cooldown unless retry_missing is explicitly enabled
            if not retry_missing and retry_after is not None:
                retry_dt = retry_after if retry_after.tzinfo else retry_after.replace(tzinfo=timezone.utc)
                if retry_dt > now_utc:
                    continue

            ser = (equity_map[sym_u].series if equity_map and sym_u in equity_map else itype) or "EQ"
            queue.append((token, sym_u, ser, attempts))

        if not dry_run and seed_updates:
            _upsert_classification_batches(conn, seed_updates)
            conn.commit()

        api_updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        retry_updates: List[Tuple[datetime, int, str, int]] = []
        unresolved: List[str] = []
        requests_made = 0
        retries_made = 0
        blocked = False

        if queue and not dry_run:
            client = classifier or NseQuoteClassifier()
            for token, sym_u, ser, attempts in queue:
                if sym_u in overrides:
                    m, s, i, b = overrides[sym_u]
                    api_updates.append((token, sym_u, m, s, i, b, "override", "mapped"))
                    continue

                status, data = client.fetch_classification(sym_u, series=ser)
                if status == "ok" and data:
                    m = standard_name(data["macro"])
                    s = standard_name(data["sector"])
                    i = standard_name(data["industry"])
                    b = standard_name(data["basic_industry"])
                    if m in CURRENT_MACROS and s and i and b:
                        api_updates.append((token, sym_u, m, s, i, b, "nse_quote_api", "mapped"))
                    else:
                        unresolved.append(sym_u)
                        next_try = now_utc + timedelta(days=7)
                        retry_updates.append((next_try, attempts + 1, "retired_scheme", token))
                elif status == "blocked":
                    blocked = True
                    unresolved.append(sym_u)
                    break
                else:
                    unresolved.append(sym_u)
                    next_try = now_utc + timedelta(hours=24 if status == "error" else 72)
                    retry_updates.append((next_try, attempts + 1, status, token))

            requests_made = client.requests_made
            retries_made = client.retries_made

            if api_updates:
                _upsert_classification_batches(conn, api_updates)
            if retry_updates:
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        UPDATE instruments
                        SET classification_retry_after = %s,
                            classification_attempts = %s,
                            classification_status = CASE
                                WHEN classification_status = 'mapped' THEN 'mapped'
                                ELSE %s
                            END
                        WHERE token = %s;
                        """,
                        retry_updates,
                    )
            if api_updates or retry_updates:
                conn.commit()

        duration = round(time.time() - t0, 2)
        summary = {
            "dry_run": dry_run,
            "total_instruments": len(instruments),
            "already_mapped": already_mapped,
            "seed_updated": len(seed_updates),
            "queued": len(queue),
            "api_updated": len(api_updates),
            "unmapped": len(unresolved),
            "conflicts": len(conflicts),
            "requests_made": requests_made,
            "retries_made": retries_made,
            "blocked": blocked,
            "duration_sec": duration,
        }
        logger.info(
            f"Classification sync complete (dry_run={dry_run}): mapped={already_mapped}, "
            f"seed_updated={len(seed_updates)}, queued={len(queue)}, api_updated={len(api_updates)}, "
            f"requests={requests_made}, blocked={blocked}, {duration}s"
        )
        return summary
    finally:
        if should_close and conn:
            conn.close()
