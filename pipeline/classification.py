"""
DB-backed NSE 4-level industry classification management:
- One-time local CSV import (`import_classification_file`)
- Incremental daily sync (`sync_classification`, capped at 20 API calls/run, 5-run delist, ISIN rename)
- Manual overrides & delisting (`set_classification_override`, `mark_classification_delisted`)
- Backup export (`export_classification_csv`)
"""

import csv
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from psycopg2.extras import execute_values

from pipeline.classification_fetch import PoliteNseQuoteClient, download_equity_master
from pipeline.db import get_connection

logger = logging.getLogger("pipeline.classification")

OFFICIAL_NSE_MACROS = frozenset({
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

_JOINING_WORDS = frozenset({"and", "of", "in", "for", "the", "or", "with"})
_LOWERCASE_COMPANY_WORDS = frozenset({
    "of", "and", "the", "ltd", "co", "pvt", "one", "new", "for",
    "in", "big", "sun", "tea", "oil", "gas", "art", "web", "hi", "go",
    "om", "sky", "we", "win", "gem", "tek",
})

DAILY_SYNC_MAX_REQUESTS = 20
DELIST_CONSECUTIVE_RUNS = 5


def normalize_label(raw: Optional[str]) -> str:
    """Normalize NSE hierarchy labels to consistent Title Case with lowercase connectors."""
    cleaned = re.sub(r"\s*\ufffd+\s*", " - ", raw or "")
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return ""
    if cleaned.isupper() and len(cleaned) > 4:
        cleaned = cleaned.title()
    parts = cleaned.split(" ")
    normalized: List[str] = []
    for idx, token in enumerate(parts):
        if idx > 0 and token.lower() in _JOINING_WORDS:
            normalized.append(token.lower())
        elif token and token[0].isalpha() and not any(ch.isupper() for ch in token):
            normalized.append(token[0].upper() + token[1:])
        else:
            normalized.append(token)
    return " ".join(normalized)


def normalize_company_name(raw: Optional[str]) -> str:
    """Convert ALL-CAPS company names to Title Case while keeping short acronyms uppercase."""
    cleaned = " ".join((raw or "").split())
    if not cleaned or not cleaned.isupper():
        return cleaned

    def _title_token(tok: str) -> str:
        alpha = "".join(ch for ch in tok if ch.isalpha())
        if not alpha:
            return tok
        low = alpha.lower()
        if low in _LOWERCASE_COMPANY_WORDS:
            replacement = low if low in ("of", "and", "the", "for", "in") else low.capitalize()
            return tok.replace(alpha, replacement) if alpha in tok else tok
        if len(alpha) <= 3 or not (set(low) & set("aeiouy")):
            return tok
        chars: List[str] = []
        cap_next = True
        for ch in tok:
            if ch.isalpha():
                chars.append(ch.upper() if cap_next else ch.lower())
            else:
                chars.append(ch)
            cap_next = not ch.isalpha() and ch != "'"
        return "".join(chars)

    words: List[str] = []
    for idx, word in enumerate(cleaned.split(" ")):
        rebuilt = "-".join(_title_token(part) for part in word.split("-"))
        if idx == 0 and rebuilt[:1].islower():
            rebuilt = rebuilt[0].upper() + rebuilt[1:]
        words.append(rebuilt)
    return " ".join(words)


@dataclass(frozen=True)
class ImportedRow:
    symbol: str
    company: str
    series: str
    isin: str
    macro: str
    sector: str
    industry: str
    basic_industry: str
    source: str = "import"

    def valid(self) -> bool:
        return bool(
            self.symbol
            and self.macro in OFFICIAL_NSE_MACROS
            and self.sector
            and self.industry
            and self.basic_industry
        )


def _record_audit(cur, entries: List[Tuple[str, str, Optional[str], Optional[str], str]]) -> None:
    if not entries:
        return
    execute_values(
        cur,
        "INSERT INTO classification_audit (symbol, field, old_value, new_value, source) VALUES %s;",
        entries,
        page_size=1000,
    )


def _batch_update_instruments(
    conn,
    updates: List[Tuple[int, str, str, str, str, str, str, str]],
) -> None:
    """
    Apply classification updates in bulk.
    Each tuple: (token, symbol, macro, sector, industry, basic_industry, source, status)
    """
    if not updates:
        return
    with conn.cursor() as cur:
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
                classification_attempts = 0,
                missing_equity_l_streak = 0
            FROM (VALUES %s) AS v(
                macro_sector, sector, industry, basic_industry,
                classification_source, classification_status, token
            )
            WHERE i.token = v.token;
            """,
            [(u[2], u[3], u[4], u[5], u[6], u[7], u[0]) for u in updates],
            page_size=1000,
        )


def _load_db_overrides(conn) -> Dict[str, Tuple[str, str, str, str]]:
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, macro, sector, industry, basic_industry FROM classification_overrides;")
        return {
            str(r[0]).upper(): (str(r[1]), str(r[2]), str(r[3]), str(r[4]))
            for r in cur.fetchall()
        }


def _load_db_symbol_changes(conn) -> List[Tuple[str, str, Optional[str]]]:
    with conn.cursor() as cur:
        cur.execute("SELECT old_symbol, new_symbol, isin FROM symbol_changes;")
        return [(str(r[0]).upper(), str(r[1]).upper(), str(r[2]).upper() if r[2] else None) for r in cur.fetchall()]


def import_classification_file(
    file_path: str,
    overrides_path: Optional[str] = None,
    symbol_changes_path: Optional[str] = None,
    delisted_path: Optional[str] = None,
    dry_run: bool = False,
    conn=None,
) -> Dict[str, Any]:
    """
    One-time, idempotent import of a local classification CSV into Neon DB.
    Matches ISIN first, then uppercase symbol. Stores overrides/renames/delistings in DB tables.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Classification import file not found: {file_path}")

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # 1. Parse optional overrides CSV into DB table
        override_rows: List[Tuple[str, str, str, str, str, str]] = []
        override_map: Dict[str, Tuple[str, str, str, str]] = _load_db_overrides(conn)
        if overrides_path and os.path.exists(overrides_path):
            with open(overrides_path, newline="", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    sym = (row.get("symbol") or "").strip().upper()
                    if not sym:
                        continue
                    vals = (
                        normalize_label(row.get("macro")),
                        normalize_label(row.get("sector")),
                        normalize_label(row.get("industry")),
                        normalize_label(row.get("basicIndustry") or row.get("basic_industry")),
                    )
                    if all(vals) and vals[0] in OFFICIAL_NSE_MACROS:
                        override_map[sym] = vals
                        override_rows.append((sym, vals[0], vals[1], vals[2], vals[3], (row.get("note") or "").strip()))

        # 2. Parse optional symbol_changes CSV
        change_rows: List[Tuple[str, str, Optional[str], Optional[str]]] = []
        if symbol_changes_path and os.path.exists(symbol_changes_path):
            with open(symbol_changes_path, newline="", encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    old_s = (row.get("old") or row.get("old_symbol") or "").strip().upper()
                    new_s = (row.get("new") or row.get("new_symbol") or "").strip().upper()
                    isin_v = (row.get("isin") or "").strip().upper() or None
                    date_v = (row.get("date") or row.get("changed_on") or "").strip() or None
                    if old_s and new_s:
                        change_rows.append((old_s, new_s, isin_v, date_v))

        # 3. Parse optional delisted CSV
        delisted_syms: set = set()
        if delisted_path and os.path.exists(delisted_path):
            with open(delisted_path, newline="", encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    sym = (row.get("symbol") or "").strip().upper()
                    if sym:
                        delisted_syms.add(sym)

        # 4. Read main CSV
        rows_read = 0
        skipped_reasons: Dict[str, int] = {}
        by_isin: Dict[str, ImportedRow] = {}
        by_sym: Dict[str, ImportedRow] = {}

        with open(file_path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            required = {"symbol", "isin", "macro", "sector", "industry"}
            headers = set(reader.fieldnames or [])
            if not required.issubset(headers) or not ({"basicIndustry", "basic_industry"} & headers):
                raise ValueError(f"Import CSV {file_path} missing required columns")

            for row in reader:
                rows_read += 1
                sym = (row.get("symbol") or "").strip().upper()
                isin = (row.get("isin") or "").strip().upper()
                if not sym or not isin:
                    skipped_reasons["missing_identity"] = skipped_reasons.get("missing_identity", 0) + 1
                    continue

                if sym in override_map:
                    m, s, i, b = override_map[sym]
                    src = "import"
                else:
                    m = normalize_label(row.get("macro"))
                    s = normalize_label(row.get("sector"))
                    i = normalize_label(row.get("industry"))
                    b = normalize_label(row.get("basicIndustry") or row.get("basic_industry"))
                    src = "import"

                rec = ImportedRow(
                    symbol=sym,
                    company=normalize_company_name(row.get("company") or sym),
                    series=(row.get("series") or "EQ").strip().upper(),
                    isin=isin,
                    macro=m,
                    sector=s,
                    industry=i,
                    basic_industry=b,
                    source=src,
                )
                if not rec.valid():
                    skipped_reasons["invalid_or_retired_scheme"] = skipped_reasons.get("invalid_or_retired_scheme", 0) + 1
                    continue

                if isin in by_isin and (by_isin[isin].macro, by_isin[isin].sector, by_isin[isin].industry, by_isin[isin].basic_industry) != (m, s, i, b):
                    skipped_reasons["duplicate_isin_conflict"] = skipped_reasons.get("duplicate_isin_conflict", 0) + 1
                    continue

                by_isin[isin] = rec
                by_sym[sym] = rec

        # 5. Match against DB instruments (ISIN first, then symbol)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, isin, macro_sector, sector, industry, basic_industry,
                       classification_source, classification_status
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY symbol;
                """
            )
            db_instruments = cur.fetchall()

        matched = 0
        updated = 0
        unchanged = 0
        updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        audit_rows: List[Tuple[str, str, Optional[str], Optional[str], str]] = []
        delisted_tokens: List[int] = []

        for tok, sym, isin, cur_m, cur_s, cur_i, cur_b, cur_src, cur_status in db_instruments:
            sym_u = str(sym).upper()
            isin_u = str(isin).upper() if isin else ""

            if sym_u in delisted_syms and cur_status != "delisted":
                delisted_tokens.append(tok)
                audit_rows.append((sym_u, "classification_status", cur_status, "delisted", "import_delisted"))
                continue

            rec = by_isin.get(isin_u) if isin_u else None
            if rec is None and sym_u in by_sym:
                cand = by_sym[sym_u]
                if not isin_u or not cand.isin or isin_u == cand.isin:
                    rec = cand

            if rec is None:
                continue

            matched += 1
            if (
                cur_m == rec.macro
                and cur_s == rec.sector
                and cur_i == rec.industry
                and cur_b == rec.basic_industry
                and cur_status == "mapped"
            ):
                unchanged += 1
                continue

            updated += 1
            updates.append((tok, sym_u, rec.macro, rec.sector, rec.industry, rec.basic_industry, "import", "mapped"))
            if cur_b != rec.basic_industry:
                audit_rows.append((sym_u, "basic_industry", cur_b, rec.basic_industry, "import"))

        if not dry_run:
            with conn.cursor() as cur:
                if override_rows:
                    execute_values(
                        cur,
                        """
                        INSERT INTO classification_overrides (symbol, macro, sector, industry, basic_industry, note, updated_at)
                        VALUES %s
                        ON CONFLICT (symbol) DO UPDATE SET
                            macro = EXCLUDED.macro, sector = EXCLUDED.sector,
                            industry = EXCLUDED.industry, basic_industry = EXCLUDED.basic_industry,
                            note = EXCLUDED.note, updated_at = NOW();
                        """,
                        override_rows,
                        template="(%s, %s, %s, %s, %s, %s, NOW())",
                    )
                if change_rows:
                    execute_values(
                        cur,
                        """
                        INSERT INTO symbol_changes (old_symbol, new_symbol, isin, changed_on)
                        VALUES %s
                        ON CONFLICT (old_symbol, new_symbol) DO NOTHING;
                        """,
                        change_rows,
                    )
                if delisted_tokens:
                    cur.execute(
                        "UPDATE instruments SET classification_status = 'delisted', classification_updated_at = NOW() WHERE token = ANY(%s);",
                        (delisted_tokens,),
                    )
                if audit_rows:
                    _record_audit(cur, audit_rows)
            conn.commit()
            if updates:
                _batch_update_instruments(conn, updates)
                conn.commit()

        distinct_levels = {
            "macro": len({r.macro for r in by_sym.values()}),
            "sector": len({r.sector for r in by_sym.values()}),
            "industry": len({r.industry for r in by_sym.values()}),
            "basic_industry": len({r.basic_industry for r in by_sym.values()}),
        }
        summary = {
            "dry_run": dry_run,
            "rows_read": rows_read,
            "matched": matched,
            "inserted": 0,
            "updated": updated,
            "unchanged": unchanged,
            "skipped": sum(skipped_reasons.values()),
            "skipped_reasons": skipped_reasons,
            "distinct_levels": distinct_levels,
        }
        logger.info(f"Classification import summary: {summary}")
        return summary
    finally:
        if should_close and conn:
            conn.close()


def set_classification_override(
    symbol: str,
    macro: str,
    sector: str,
    industry: str,
    basic_industry: str,
    note: str = "manual cli",
    conn=None,
) -> Dict[str, Any]:
    """Manually set 4-level classification override in DB and record audit entries."""
    sym_u = symbol.strip().upper()
    m = normalize_label(macro)
    s = normalize_label(sector)
    i = normalize_label(industry)
    b = normalize_label(basic_industry)
    if m not in OFFICIAL_NSE_MACROS or not (s and i and b):
        raise ValueError(f"Invalid classification hierarchy: {m}/{s}/{i}/{b}")

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO classification_overrides (symbol, macro, sector, industry, basic_industry, note, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (symbol) DO UPDATE SET
                    macro = EXCLUDED.macro, sector = EXCLUDED.sector,
                    industry = EXCLUDED.industry, basic_industry = EXCLUDED.basic_industry,
                    note = EXCLUDED.note, updated_at = NOW();
                """,
                (sym_u, m, s, i, b, note),
            )
            cur.execute(
                "SELECT token, macro_sector, sector, industry, basic_industry FROM instruments WHERE symbol = %s AND exchange = 'NSE';",
                (sym_u,),
            )
            rows = cur.fetchall()
            audit: List[Tuple[str, str, Optional[str], Optional[str], str]] = []
            for tok, old_m, old_s, old_i, old_b in rows:
                if old_b != b:
                    audit.append((sym_u, "basic_industry", old_b, b, "manual_set"))
                cur.execute(
                    """
                    UPDATE instruments
                    SET macro_sector = %s, sector = %s, industry = %s, basic_industry = %s,
                        classification_source = 'override', classification_status = 'mapped',
                        classification_updated_at = NOW()
                    WHERE token = %s;
                    """,
                    (m, s, i, b, tok),
                )
            _record_audit(cur, audit)
        conn.commit()
        return {"symbol": sym_u, "updated_tokens": len(rows), "hierarchy": [m, s, i, b]}
    finally:
        if should_close and conn:
            conn.close()


def mark_classification_delisted(symbol: str, reason: str = "manual remove", conn=None) -> Dict[str, Any]:
    """Mark a symbol as delisted on instruments (without deleting row) and record audit."""
    sym_u = symbol.strip().upper()
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT token, classification_status FROM instruments WHERE symbol = %s AND exchange = 'NSE';",
                (sym_u,),
            )
            rows = cur.fetchall()
            audit = [
                (sym_u, "classification_status", r[1], f"delisted ({reason})", "manual_remove")
                for r in rows
            ]
            if rows:
                cur.execute(
                    "UPDATE instruments SET classification_status = 'delisted', classification_updated_at = NOW() WHERE symbol = %s AND exchange = 'NSE';",
                    (sym_u,),
                )
                _record_audit(cur, audit)
        conn.commit()
        return {"symbol": sym_u, "delisted_tokens": len(rows), "reason": reason}
    finally:
        if should_close and conn:
            conn.close()


def export_classification_csv(out_path: str = "data/classification_backup.csv", conn=None) -> Dict[str, Any]:
    """Export current DB classifications to a local gitignored CSV backup."""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT symbol, name, instrument_type, isin, macro_sector, sector, industry, basic_industry,
                       classification_source, classification_status
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY symbol;
                """
            )
            rows = cur.fetchall()
        with open(out_path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["symbol", "company", "series", "isin", "macro", "sector", "industry", "basicIndustry", "source", "status"])
            for r in rows:
                writer.writerow(r)
        return {"path": out_path, "rows": len(rows)}
    finally:
        if should_close and conn:
            conn.close()


def sync_classification(
    conn=None,
    dry_run: bool = False,
    retry_missing: bool = False,
    refresh_symbol: Optional[str] = None,
    fetch_equity: bool = True,
    max_requests: int = DAILY_SYNC_MAX_REQUESTS,
    client: Optional[PoliteNseQuoteClient] = None,
) -> Dict[str, Any]:
    """
    DB-first incremental classification sync:
    1. Reads overrides, symbol_changes, and instruments from DB.
    2. Applies DB overrides & ISIN-based symbol renames first.
    3. Tracks missing symbols on EQUITY_L.csv: 5 consecutive misses -> delisted; reappearance -> reactivated.
    4. Queues unmapped/due symbols (capped at `max_requests` = 20 per run, 2.5s pacing, halts on first 403/429).
    """
    t0 = time.time()
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        overrides = _load_db_overrides(conn)
        renames = _load_db_symbol_changes(conn)
        rename_by_isin = {isin: (old_s, new_s) for old_s, new_s, isin in renames if isin}

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT token, symbol, isin, instrument_type,
                       macro_sector, sector, industry, basic_industry,
                       classification_source, classification_status,
                       classification_retry_after, COALESCE(classification_attempts, 0),
                       COALESCE(missing_equity_l_streak, 0)
                FROM instruments
                WHERE exchange = 'NSE' AND COALESCE(is_active, TRUE) = TRUE
                ORDER BY symbol;
                """
            )
            instruments = cur.fetchall()

        equity_map = download_equity_master() if (fetch_equity and not dry_run) else None
        equity_list_healthy = bool(equity_map and len(equity_map) >= 0.8 * max(1, len(instruments)))

        now_utc = datetime.now(timezone.utc)
        by_sym_row = {str(r[1]).upper(): r for r in instruments}
        override_updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        audit_rows: List[Tuple[str, str, Optional[str], Optional[str], str]] = []
        queue: List[Tuple[int, str, str, int]] = []
        delisted_tokens: List[int] = []
        reactivated_updates: List[Tuple[str, int]] = []
        streak_inc_tokens: List[int] = []
        streak_reset_tokens: List[int] = []
        already_mapped = 0

        target_sym = refresh_symbol.strip().upper() if refresh_symbol else None

        for row in instruments:
            (
                token, sym, isin, itype,
                cur_m, cur_s, cur_i, cur_b,
                _cur_src, cur_status, retry_after, attempts, miss_streak,
            ) = row
            sym_u = str(sym).upper()
            isin_u = str(isin).upper() if isin else ""
            has_valid = bool(cur_m in OFFICIAL_NSE_MACROS and cur_s and cur_i and cur_b)

            # Equity list presence / delisting / reactivation tracking
            if equity_list_healthy and equity_map is not None:
                if sym_u in equity_map:
                    if cur_status == "delisted":
                        new_st = "mapped" if has_valid else "unmapped"
                        reactivated_updates.append((new_st, token))
                        audit_rows.append((sym_u, "classification_status", "delisted", new_st, "equity_l_reactivated"))
                    elif miss_streak > 0:
                        streak_reset_tokens.append(token)
                else:
                    next_streak = miss_streak + 1
                    if next_streak >= DELIST_CONSECUTIVE_RUNS and cur_status != "delisted":
                        delisted_tokens.append(token)
                        audit_rows.append((sym_u, "classification_status", cur_status, "delisted", "missing_5_runs"))
                    elif cur_status != "delisted":
                        streak_inc_tokens.append(token)
                    continue

            if cur_status == "delisted":
                continue

            if target_sym:
                if sym_u == target_sym:
                    ser = (equity_map[sym_u].series if equity_map and sym_u in equity_map else itype) or "EQ"
                    queue.append((token, sym_u, ser, attempts))
                continue

            # Apply DB override if present and different
            if sym_u in overrides:
                om, os_, oi, ob = overrides[sym_u]
                if (cur_m, cur_s, cur_i, cur_b) != (om, os_, oi, ob) or cur_status != "mapped":
                    override_updates.append((token, sym_u, om, os_, oi, ob, "override", "mapped"))
                    audit_rows.append((sym_u, "basic_industry", cur_b, ob, "db_override"))
                else:
                    already_mapped += 1
                continue

            if has_valid:
                already_mapped += 1
                continue

            # Apply symbol rename by ISIN if old_symbol is classified in DB
            if isin_u and isin_u in rename_by_isin:
                old_s, new_s = rename_by_isin[isin_u]
                if new_s == sym_u and old_s in by_sym_row:
                    old_r = by_sym_row[old_s]
                    if old_r[4] in OFFICIAL_NSE_MACROS and old_r[5] and old_r[6] and old_r[7]:
                        override_updates.append((token, sym_u, old_r[4], old_r[5], old_r[6], old_r[7], "rename_isin", "mapped"))
                        audit_rows.append((sym_u, "basic_industry", cur_b, old_r[7], f"isin_rename:{old_s}->{new_s}"))
                        continue

            if not retry_missing and retry_after is not None:
                retry_dt = retry_after if retry_after.tzinfo else retry_after.replace(tzinfo=timezone.utc)
                if retry_dt > now_utc:
                    continue

            ser = (equity_map[sym_u].series if equity_map and sym_u in equity_map else itype) or "EQ"
            queue.append((token, sym_u, ser, attempts))

        if not dry_run:
            if override_updates:
                _batch_update_instruments(conn, override_updates)
            with conn.cursor() as cur:
                if delisted_tokens:
                    cur.execute(
                        "UPDATE instruments SET classification_status = 'delisted', missing_equity_l_streak = missing_equity_l_streak + 1, classification_updated_at = NOW() WHERE token = ANY(%s);",
                        (delisted_tokens,),
                    )
                if streak_inc_tokens:
                    cur.execute(
                        "UPDATE instruments SET missing_equity_l_streak = COALESCE(missing_equity_l_streak, 0) + 1 WHERE token = ANY(%s);",
                        (streak_inc_tokens,),
                    )
                if streak_reset_tokens:
                    cur.execute(
                        "UPDATE instruments SET missing_equity_l_streak = 0 WHERE token = ANY(%s);",
                        (streak_reset_tokens,),
                    )
                for new_st, tok in reactivated_updates:
                    cur.execute(
                        "UPDATE instruments SET classification_status = %s, missing_equity_l_streak = 0, classification_updated_at = NOW() WHERE token = %s;",
                        (new_st, tok),
                    )
                if audit_rows:
                    _record_audit(cur, audit_rows)
            conn.commit()

        # Cap per-run external NSE quote lookups to max_requests (20)
        capped_queue = queue[:max_requests] if max_requests > 0 else queue
        api_updates: List[Tuple[int, str, str, str, str, str, str, str]] = []
        retry_updates: List[Tuple[datetime, int, str, int]] = []
        api_audit: List[Tuple[str, str, Optional[str], Optional[str], str]] = []
        blocked = False
        requests_sent = 0

        if capped_queue and not dry_run:
            fetcher = client or PoliteNseQuoteClient(delay_sec=2.5)
            for token, sym_u, ser, attempts in capped_queue:
                status, payload = fetcher.lookup_symbol(sym_u, series=ser)
                if status == "ok" and payload:
                    m = normalize_label(payload["macro"])
                    s = normalize_label(payload["sector"])
                    i = normalize_label(payload["industry"])
                    b = normalize_label(payload["basic_industry"])
                    if m in OFFICIAL_NSE_MACROS and s and i and b:
                        api_updates.append((token, sym_u, m, s, i, b, "nse_quote_api", "mapped"))
                        api_audit.append((sym_u, "basic_industry", None, b, "nse_quote_api"))
                    else:
                        retry_updates.append((now_utc + timedelta(days=7), attempts + 1, "retired_scheme", token))
                elif status == "blocked":
                    blocked = True
                    break
                else:
                    hours = 24 if status == "error" else 72
                    retry_updates.append((now_utc + timedelta(hours=hours), attempts + 1, status, token))

            requests_sent = fetcher.requests_sent
            if api_updates:
                _batch_update_instruments(conn, api_updates)
            with conn.cursor() as cur:
                if retry_updates:
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
                if api_audit:
                    _record_audit(cur, api_audit)
            conn.commit()

        return {
            "dry_run": dry_run,
            "total_instruments": len(instruments),
            "already_mapped": already_mapped,
            "override_or_rename_updated": len(override_updates),
            "delisted": len(delisted_tokens),
            "reactivated": len(reactivated_updates),
            "queued_total": len(queue),
            "queued_capped": len(capped_queue),
            "api_updated": len(api_updates),
            "requests_sent": requests_sent,
            "blocked": blocked,
            "duration_sec": round(time.time() - t0, 2),
        }
    finally:
        if should_close and conn:
            conn.close()
