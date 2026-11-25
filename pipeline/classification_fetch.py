"""
NSE equity master and quote classification adapter.

Portions adapted from dopawire/nse-relative-strength (MIT License).
Never bypasses access controls or rotates UAs; stops/defers on HTTP 403/429.
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

EQUITY_L_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_HOME_URL = "https://www.nseindia.com/"
NSE_QUOTE_API = (
    "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"
    "?functionName=getSymbolData&marketType={mt}&series={series}&symbol={symbol}"
)

DEFAULT_UA = "swing-personal-research/1.0"
BASE_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": NSE_HOME_URL,
}


@dataclass(frozen=True)
class EquityListRow:
    symbol: str
    company: str
    series: str
    isin: str


def parse_equity_list_csv(text: str) -> Dict[str, EquityListRow]:
    """Parse NSE EQUITY_L.csv text into {SYMBOL: EquityListRow}."""
    if not text or not text.strip():
        raise ValueError("Empty EQUITY_L.csv content")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("EQUITY_L.csv missing header row")

    normalized_headers = {h.strip().upper() for h in reader.fieldnames if h}
    required = {"SYMBOL", "NAME OF COMPANY", "SERIES", "ISIN NUMBER"}
    missing_cols = required - normalized_headers
    if missing_cols:
        raise ValueError(f"EQUITY_L.csv missing required columns: {sorted(missing_cols)}")

    rows: Dict[str, EquityListRow] = {}
    for row in reader:
        def get_col(key: str) -> str:
            if key in row and row[key] is not None:
                return row[key].strip()
            for col_name, val in row.items():
                if col_name and col_name.strip().upper() == key and val is not None:
                    return val.strip()
            return ""

        sym = get_col("SYMBOL").upper()
        if not sym:
            continue
        rows[sym] = EquityListRow(
            symbol=sym,
            company=get_col("NAME OF COMPANY"),
            series=get_col("SERIES").upper() or "EQ",
            isin=get_col("ISIN NUMBER").upper(),
        )
    return rows


def fetch_equity_list(
    session: Optional[requests.Session] = None,
    timeout: int = 20,
) -> Optional[Dict[str, EquityListRow]]:
    """
    Download NSE's official EQUITY_L.csv.
    Returns None on HTTP denial, timeout, or invalid CSV instead of raising.
    """
    client = session or requests
    try:
        resp = client.get(EQUITY_L_URL, headers={"User-Agent": DEFAULT_UA}, timeout=timeout)
        if resp.status_code != 200:
            logger.warning(f"EQUITY_L.csv returned HTTP {resp.status_code}; deferring.")
            return None
        return parse_equity_list_csv(resp.text)
    except Exception as exc:
        logger.warning(f"Failed fetching/parsing EQUITY_L.csv: {exc}")
        return None


class NseQuoteClassifier:
    """
    Lazy, rate-limited NSE GetQuoteApi client with bounded retries and immediate
    halt on HTTP 403/429. Session is only created when first lookup is requested.
    """

    def __init__(self, delay_seconds: float = 2.0, timeout: int = 12, max_retries: int = 1):
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self.max_retries = max_retries
        self._session: Optional[requests.Session] = None
        self._initialized = False
        self._blocked = False
        self.requests_made = 0
        self.retries_made = 0

    @property
    def is_blocked(self) -> bool:
        return self._blocked

    def _ensure_session(self) -> bool:
        if self._blocked:
            return False
        if self._initialized and self._session is not None:
            return True
        sess = requests.Session()
        try:
            self.requests_made += 1
            resp = sess.get(NSE_HOME_URL, headers=BASE_HEADERS, timeout=self.timeout)
            if resp.status_code in (403, 429):
                logger.warning(f"NSE homepage returned HTTP {resp.status_code}; deferring lookups.")
                self._blocked = True
                return False
            if resp.status_code != 200:
                logger.warning(f"NSE homepage warmup returned HTTP {resp.status_code}.")
                return False
            self._session = sess
            self._initialized = True
            return True
        except Exception as exc:
            logger.warning(f"NSE homepage warmup error: {exc}")
            return False

    def fetch_classification(
        self, symbol: str, series: str = "EQ"
    ) -> Tuple[str, Optional[Dict[str, str]]]:
        """
        Fetch 4-level classification for (symbol, series).
        Returns (status, data_dict_or_none) where status is one of:
        'ok', 'blocked', 'unmapped', 'error'.
        """
        if self._blocked:
            return "blocked", None
        if not self._ensure_session():
            return ("blocked" if self._blocked else "error"), None

        assert self._session is not None
        enc_sym = quote(symbol.upper(), safe="")
        ser = (series or "EQ").upper()
        tries = [("N", ser)]
        if ser != "EQ":
            tries.append(("N", "EQ"))
        tries.append(("G", ser if ser in ("BE", "BZ") else "BE"))

        hdrs = {
            "User-Agent": DEFAULT_UA,
            "Accept": "application/json, text/plain, */*",
            "Referer": f"https://www.nseindia.com/get-quotes/equity?symbol={enc_sym}",
            "X-Requested-With": "XMLHttpRequest",
        }

        for mt, se in tries:
            url = NSE_QUOTE_API.format(mt=mt, series=quote(se, safe=""), symbol=enc_sym)
            for attempt in range(self.max_retries + 1):
                if self.delay_seconds > 0:
                    time.sleep(self.delay_seconds)
                try:
                    self.requests_made += 1
                    resp = self._session.get(url, headers=hdrs, timeout=self.timeout)
                    if resp.status_code in (403, 429):
                        logger.warning(f"NSE GetQuoteApi returned HTTP {resp.status_code} for {symbol}; stopping.")
                        self._blocked = True
                        return "blocked", None
                    if resp.status_code != 200:
                        break
                    payload = resp.json()
                    eq_resp = payload.get("equityResponse") or []
                    sec_info = eq_resp[0].get("secInfo") if eq_resp else None
                    if isinstance(sec_info, dict):
                        macro = str(sec_info.get("macro") or "").strip()
                        sector = str(sec_info.get("sector") or "").strip()
                        ind = str(sec_info.get("industryInfo") or sec_info.get("industry") or "").strip()
                        basic = str(sec_info.get("basicIndustry") or "").strip()
                        if macro and sector and ind and basic:
                            return "ok", {
                                "macro": macro,
                                "sector": sector,
                                "industry": ind,
                                "basic_industry": basic,
                            }
                    break
                except requests.RequestException as exc:
                    if attempt < self.max_retries:
                        self.retries_made += 1
                        continue
                    logger.warning(f"Request failed for {symbol}: {exc}")
                    return "error", None
                except ValueError as exc:
                    logger.warning(f"Invalid JSON for {symbol}: {exc}")
                    return "error", None

        return "unmapped", None
