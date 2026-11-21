import os
import logging
import urllib.request
import urllib.parse
import urllib.error
import json

logger = logging.getLogger("pipeline.alerts")

def send_telegram_alert(message: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        # Plain text with [Pipeline Alert] prefix, truncated to 3500 chars (R3)
        formatted_text = f"[Pipeline Alert] {str(message or '').strip()}"[:3500]
        payload = json.dumps({
            "chat_id": chat_id,
            "text": formatted_text,
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        desc = ""
        try:
            err_body = e.read().decode("utf-8")
            err_json = json.loads(err_body)
            desc = err_json.get("description", "")
        except Exception:
            pass
        logger.error(f"Failed to send Telegram alert: HTTP {e.code} - {desc}")
        return False
    except Exception as e:
        logger.error(f"Failed to send Telegram alert: {e}")
        return False
