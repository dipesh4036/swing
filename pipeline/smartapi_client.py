import os
import time
import logging
from typing import Optional, Dict, Any, List
import pyotp
from SmartApi import SmartConnect
from dotenv import load_dotenv

load_dotenv(".env")

logger = logging.getLogger("pipeline.smartapi")

class SmartAPIClient:
    """
    Secure, rate-limited Angel One SmartAPI client.
    Enforces secrets safety (no credential logging, no JWT persistence)
    and read-only access (no order/portfolio endpoints).
    """
    def __init__(
        self,
        api_key: Optional[str] = None,
        client_id: Optional[str] = None,
        pin: Optional[str] = None,
        totp_secret: Optional[str] = None,
        requests_per_sec: float = 1.8
    ):
        self.api_key = api_key or os.environ.get("API_KEY")
        self.client_id = client_id or os.environ.get("CLIENT_ID")
        self.pin = pin or os.environ.get("PIN")
        self.totp_secret = totp_secret or os.environ.get("TOTP_SECRET")
        self.min_interval = 1.0 / requests_per_sec
        self.last_req_time = 0.0

        if not all([self.api_key, self.client_id, self.pin, self.totp_secret]):
            raise ValueError("Missing one or more required SmartAPI credentials (API_KEY, CLIENT_ID, PIN, TOTP_SECRET).")

        self.smart_connect = SmartConnect(api_key=self.api_key)
        self.session_data = None
        self._authenticate()

    def _rate_limit(self):
        elapsed = time.time() - self.last_req_time
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self.last_req_time = time.time()

    def _authenticate(self):
        try:
            totp = pyotp.TOTP(self.totp_secret).now()
            # loginByPassword initiates session
            data = self.smart_connect.generateSession(self.client_id, self.pin, totp)
            if not data or not data.get("status"):
                raise RuntimeError(f"SmartAPI login failed: {data.get('message', 'Unknown error')}")
            self.session_data = data
            logger.info("SmartAPI session authenticated successfully.")
        except Exception as e:
            logger.error("SmartAPI authentication encountered an exception.")
            raise

    def get_candle_data(
        self,
        exchange: str,
        symbol_token: str,
        interval: str,
        from_date: str,
        to_date: str,
        max_retries: int = 5
    ) -> List[List[Any]]:
        """
        Fetch OHLCV candles from SmartAPI.
        Interval: ONE_DAY, ONE_MINUTE, etc.
        Dates: YYYY-MM-DD HH:MM
        Returns: list of [timestamp, open, high, low, close, volume]
        """
        params = {
            "exchange": exchange,
            "symboltoken": str(symbol_token),
            "interval": interval,
            "fromdate": from_date,
            "todate": to_date
        }

        backoff = 1.0
        for attempt in range(max_retries):
            self._rate_limit()
            try:
                res = self.smart_connect.getCandleData(params)
                if res and res.get("status") and res.get("data") is not None:
                    return res["data"]
                
                msg = res.get("message", "") if res else ""
                if "exceeding access rate" in msg.lower() or "too many requests" in msg.lower():
                    logger.warning(f"Rate limit hit for token {symbol_token}. Backing off {backoff:.1f}s...")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 16.0)
                    continue

                if "session" in msg.lower() or "token" in msg.lower() or "invalid" in msg.lower():
                    logger.warning("Session might have expired. Re-authenticating...")
                    self._authenticate()
                    continue

                logger.debug(f"SmartAPI returned no data or error for token {symbol_token}: {msg}")
                return []
            except Exception as e:
                err_str = str(e)
                if "exceeding access rate" in err_str.lower():
                    logger.warning(f"Rate limit exception for token {symbol_token}. Backing off {backoff:.1f}s...")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 16.0)
                    continue
                logger.error(f"Error fetching candles for {symbol_token}: {err_str}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 8.0)

        return []

