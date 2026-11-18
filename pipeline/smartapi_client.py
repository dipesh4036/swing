import os
import time
import logging
from typing import Optional, Dict, Any, List
import pyotp
from SmartApi import SmartConnect
from dotenv import load_dotenv

load_dotenv(".env")

logger = logging.getLogger("pipeline.smartapi")

class SmartAPIThrottledError(RuntimeError):
    """Raised when SmartAPI throttles requests and retries are exhausted."""
    pass

class SmartAPIClient:
    """
    Secure, rate-limited Angel One SmartAPI client with adaptive backoff.
    Enforces secrets safety (no credential logging, no JWT persistence)
    and read-only access (no order/portfolio endpoints).
    """
    def __init__(
        self,
        api_key: Optional[str] = None,
        client_id: Optional[str] = None,
        pin: Optional[str] = None,
        totp_secret: Optional[str] = None,
        requests_per_sec: Optional[float] = None
    ):
        self.api_key = api_key or os.environ.get("API_KEY")
        self.client_id = client_id or os.environ.get("CLIENT_ID")
        self.pin = pin or os.environ.get("PIN")
        self.totp_secret = totp_secret or os.environ.get("TOTP_SECRET")

        env_rate_str = os.environ.get("ANGEL_REQ_PER_SEC")
        if requests_per_sec is not None:
            self.initial_req_per_sec = float(requests_per_sec)
        elif env_rate_str:
            try:
                self.initial_req_per_sec = float(env_rate_str)
            except ValueError:
                self.initial_req_per_sec = 1.0
        else:
            self.initial_req_per_sec = 1.0

        self.current_req_per_sec = self.initial_req_per_sec
        self.clean_calls_streak = 0
        self.total_calls = 0
        self.throttle_count = 0
        self.last_req_time = 0.0

        if not all([self.api_key, self.client_id, self.pin, self.totp_secret]):
            raise ValueError("Missing one or more required SmartAPI credentials (API_KEY, CLIENT_ID, PIN, TOTP_SECRET).")

        self.smart_connect = SmartConnect(api_key=self.api_key)
        self.session_data = None
        self.reauth_count = 0
        self._authenticate()

    @classmethod
    def login_from_env(cls) -> "SmartAPIClient":
        """Instantiate client and authenticate using environment variables."""
        return cls()

    def set_rate(self, rate: float):
        """Manually override current request rate (e.g. for throttled retry pass)."""
        self.current_req_per_sec = max(0.1, float(rate))
        logger.info(f"SmartAPI request rate manually set to {self.current_req_per_sec:.2f} req/s")

    def on_throttle(self):
        """Reduce request rate by 25% down to floor of 0.4 req/s."""
        self.throttle_count += 1
        self.clean_calls_streak = 0
        old_rate = self.current_req_per_sec
        self.current_req_per_sec = max(0.4, round(self.current_req_per_sec * 0.75, 4))
        logger.warning(
            f"SmartAPI throttle detected! Reducing rate by 25%: {old_rate:.2f} -> {self.current_req_per_sec:.2f} req/s"
        )

    def on_clean_call(self):
        """Track clean calls and gradually recover rate (+5%) after 50 consecutive clean calls."""
        self.total_calls += 1
        self.clean_calls_streak += 1
        if self.clean_calls_streak >= 50 and self.current_req_per_sec < self.initial_req_per_sec:
            old_rate = self.current_req_per_sec
            self.current_req_per_sec = min(self.initial_req_per_sec, round(self.current_req_per_sec * 1.05, 4))
            self.clean_calls_streak = 0
            logger.info(
                f"Recovering adaptive rate (+5% after 50 clean calls): {old_rate:.2f} -> {self.current_req_per_sec:.2f} req/s"
            )

    def _rate_limit(self):
        min_interval = 1.0 / self.current_req_per_sec
        elapsed = time.time() - self.last_req_time
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)
        self.last_req_time = time.time()

    def _authenticate(self):
        if self.reauth_count >= 2:
            logger.warning("Maximum re-authentication limit (2) reached for this run. Skipping re-auth.")
            return False
        try:
            self.reauth_count += 1
            totp = pyotp.TOTP(self.totp_secret).now()
            data = self.smart_connect.generateSession(self.client_id, self.pin, totp)
            if not data or not data.get("status"):
                raise RuntimeError(f"SmartAPI login failed: {data.get('message', 'Unknown error')}")
            self.session_data = data
            logger.info("SmartAPI session authenticated successfully.")
            return True
        except Exception as e:
            logger.error("SmartAPI authentication encountered an exception.")
            raise

    def logout(self):
        """Terminate the active SmartAPI session at the end of the run."""
        if not self.session_data:
            return
        try:
            logger.info("Logging out and terminating SmartAPI session...")
            if hasattr(self.smart_connect, "terminateSession"):
                self.smart_connect.terminateSession(self.client_id)
        except Exception as e:
            logger.warning(f"Error during SmartAPI logout: {e}")
        finally:
            self.session_data = None

    def get_candle_data(
        self,
        exchange: str,
        symbol_token: str,
        interval: str,
        from_date: str,
        to_date: str,
        max_retries: int = 3
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

        # Genuine SmartAPI session/token expiry error codes
        EXPIRY_CODES = {"AG8001", "AG8002", "AG8003"}

        backoff = 1.0
        throttled = False
        for attempt in range(max_retries):
            self._rate_limit()
            try:
                res = self.smart_connect.getCandleData(params)
                if res and res.get("status") and res.get("data") is not None:
                    self.on_clean_call()
                    return res["data"]

                err_code = (res.get("errorcode") or "") if res else ""
                msg = (res.get("message") or "") if res else ""

                # Rate limiting
                if "exceeding access rate" in msg.lower() or "too many requests" in msg.lower():
                    throttled = True
                    self.on_throttle()
                    logger.warning(f"Rate limit hit for token {symbol_token}. Backing off {backoff:.1f}s...")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 8.0)
                    continue

                # Genuine token expiry check (codes AG8001, AG8002, AG8003 or explicit message)
                is_expiry = err_code in EXPIRY_CODES or "invalid token" in msg.lower() or "token expired" in msg.lower() or "session expired" in msg.lower()
                if is_expiry:
                    if self.reauth_count < 2:
                        logger.warning(f"Genuine session expiry code ({err_code}) detected for token {symbol_token}. Re-authenticating (attempt {self.reauth_count + 1}/2)...")
                        if self._authenticate():
                            continue
                    else:
                        logger.error(f"Session expired but re-auth cap (2) reached. Skipping token {symbol_token}.")
                        return []

                # On any other error, log and skip that token
                logger.warning(f"SmartAPI error for token {symbol_token} (code={err_code}, msg={msg}). Skipping token.")
                return []
            except Exception as e:
                err_str = str(e)
                if "exceeding access rate" in err_str.lower() or "too many requests" in err_str.lower():
                    throttled = True
                    self.on_throttle()
                    logger.warning(f"Rate limit exception for token {symbol_token}. Backing off {backoff:.1f}s...")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 8.0)
                    continue
                # On any unhandled error, skip that token
                logger.warning(f"Exception fetching candles for token {symbol_token}: {err_str}. Skipping token.")
                return []

        if throttled:
            raise SmartAPIThrottledError(f"SmartAPI throttled for token {symbol_token} after {max_retries} retries")

        return []



_client_instance: Optional[SmartAPIClient] = None

def get_smartapi_client() -> SmartAPIClient:
    global _client_instance
    if _client_instance is None:
        _client_instance = SmartAPIClient()
    return _client_instance
