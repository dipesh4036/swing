"""
NSE equity master and single-symbol quote classification client.

Uses an honest User-Agent, 2.5s pacing between per-symbol requests, and halts
immediately on HTTP 403 or 429 without retrying or bypassing access controls.
"""

import csv
import io
import logging
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple
from urllib.parse import quote

import requests

logger = logging.getLogger("pipeline.classification_fetch")

NSE_EQUITY_MASTER_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_ORIGIN_URL = "https://www.nseindia.com/"
NSE_SYMBOL_QUOTE_URL = (
    "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
    "?functionName=getSymbolData&marketType={market_type}&series={series}&symbol={symbol}"
)

RESEARCH_USER_AGENT = "swing-personal-research/1.0"
SESSION_HEADERS = {
    "User-Agent": RESEARCH_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_ORIGIN_URL,
}


@dataclass(frozen=True)
class EquityMasterEntry:
    symbol: str
    company_name: str
    series: str
    isin: str


def decode_equity_master_csv(raw_text: str) -> Dict[str, EquityMasterEntry]:
    """Parse NSE EQUITY_L.csv content into {SYMBOL: EquityMasterEntry}."""
    if not raw_text or not raw_text.strip():
        raise ValueError("Empty EQUITY_L.csv payload")

    reader = csv.DictReader(io.StringIO(raw_text))
    if not reader.fieldnames:
        raise ValueError("EQUITY_L.csv missing header row")

    header_set = {col.strip().upper() for col in reader.fieldnames if col}
    needed = {"SYMBOL", "NAME OF COMPANY", "SERIES", "ISIN NUMBER"}
    missing = needed - header_set
    if missing:
        raise ValueError(f"EQUITY_L.csv missing required columns: {sorted(missing)}")

    entries: Dict[str, EquityMasterEntry] = {}
    for row in reader:
        lookup = {k.strip().upper(): (v or "").strip() for k, v in row.items() if k}
        sym = lookup.get("SYMBOL", "").upper()
        if not sym:
            continue
        entries[sym] = EquityMasterEntry(
            symbol=sym,
            company_name=lookup.get("NAME OF COMPANY", ""),
            series=lookup.get("SERIES", "").upper() or "EQ",
            isin=lookup.get("ISIN NUMBER", "").upper(),
        )
    return entries


def download_equity_master(
    http_client: Optional[requests.Session] = None,
    timeout: int = 20,
) -> Optional[Dict[str, EquityMasterEntry]]:
    """Fetch NSE EQUITY_L.csv; return None if unreachable, blocked, or malformed."""
    client = http_client or requests
    try:
        resp = client.get(
            NSE_EQUITY_MASTER_URL,
            headers={"User-Agent": RESEARCH_USER_AGENT},
            timeout=timeout,
        )
        if resp.status_code != 200:
            logger.warning(f"EQUITY_L.csv returned HTTP {resp.status_code}; skipping equity list sync.")
            return None
        return decode_equity_master_csv(resp.text)
    except Exception as exc:
        logger.warning(f"Could not fetch EQUITY_L.csv: {exc}")
        return None


class PoliteNseQuoteClient:
    """
    Lazy-initialized, rate-limited NSE quote fetcher.
    Enforces >= 2.5s delay between requests and halts on first HTTP 403/429.
    """

    def __init__(self, delay_sec: float = 2.5, timeout: int = 12):
        self.delay_sec = delay_sec
        self.timeout = timeout
        self._session: Optional[requests.Session] = None
        self._ready = False
        self.halted = False
        self.requests_sent = 0

    def _init_session(self) -> bool:
        if self.halted:
            return False
        if self._ready and self._session is not None:
            return True

        sess = requests.Session()
        try:
            self.requests_sent += 1
            resp = sess.get(NSE_ORIGIN_URL, headers=SESSION_HEADERS, timeout=self.timeout)
            if resp.status_code in (403, 429):
                logger.warning(f"NSE origin returned HTTP {resp.status_code}; halting.")
                self.halted = True
                return False
            if resp.status_code != 200:
                logger.warning(f"NSE origin warmup status: HTTP {resp.status_code}")
                return False
            self._session = sess
            self._ready = True
            return True
        except requests.RequestException as exc:
            logger.warning(f"NSE origin warmup error: {exc}")
            return False

    def lookup_symbol(
        self, symbol: str, series: str = "EQ"
    ) -> Tuple[str, Optional[Dict[str, str]]]:
        """
        Look up 4-level NSE classification for (symbol, series).
        Returns (status, payload_dict_or_None) where status in {'ok', 'blocked', 'unmapped', 'error'}.
        """
        if self.halted:
            return "blocked", None
        if not self._init_session():
            return ("blocked" if self.halted else "error"), None

        assert self._session is not None
        sym_enc = quote(symbol.upper(), safe="")
        ser = (series or "EQ").upper()
        candidates = [("N", ser)]
        if ser != "EQ":
            candidates.append(("N", "EQ"))
        candidates.append(("G", ser if ser in ("BE", "BZ") else "BE"))

        headers = {
            "User-Agent": RESEARCH_USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.nseindia.com/get-quotes/equity?symbol={sym_enc}",
            "X-Requested-With": "XMLHttpRequest",
        }

        for market_type, cand_series in candidates:
            if self.delay_sec > 0:
                time.sleep(self.delay_sec)
            url = NSE_SYMBOL_QUOTE_URL.format(
                market_type=market_type,
                series=quote(cand_series, safe=""),
                symbol=sym_enc,
            )
            try:
                self.requests_sent += 1
                resp = self._session.get(url, headers=headers, timeout=self.timeout)
                if resp.status_code in (403, 429):
                    logger.warning(f"NSE quote API returned HTTP {resp.status_code} for {symbol}; halting immediately.")
                    self.halted = True
                    return "blocked", None
                if resp.status_code != 200:
                    continue
                body = resp.json()
                eq_list = body.get("equityResponse") or []
                sec_info = eq_list[0].get("secInfo") if eq_list else None
                if isinstance(sec_info, dict):
                    macro = str(sec_info.get("macro") or "").strip()
                    sector = str(sec_info.get("sector") or "").strip()
                    industry = str(sec_info.get("industryInfo") or sec_info.get("industry") or "").strip()
                    basic = str(sec_info.get("basicIndustry") or "").strip()
                    if macro and sector and industry and basic:
                        return "ok", {
                            "macro": macro,
                            "sector": sector,
                            "industry": industry,
                            "basic_industry": basic,
                        }
            except requests.RequestException as exc:
                logger.warning(f"Quote request error for {symbol}: {exc}")
                return "error", None
            except ValueError as exc:
                logger.warning(f"Malformed JSON response for {symbol}: {exc}")
                return "error", None

        return "unmapped", None
