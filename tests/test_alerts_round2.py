import os
import json
import urllib.request
import urllib.error
from unittest.mock import patch, MagicMock
from pipeline.alerts import send_telegram_alert

def test_telegram_alert_no_parse_mode_and_prefix():
    """Verify R3: alert uses plain text (no parse_mode), [Pipeline Alert] prefix, and truncated to 3500 chars."""
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__.return_value = mock_resp

    captured_req = None

    def fake_urlopen(req, timeout=10):
        nonlocal captured_req
        captured_req = req
        return mock_resp

    with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "dummy_tok", "TELEGRAM_CHAT_ID": "dummy_chat"}), \
         patch("urllib.request.urlopen", side_effect=fake_urlopen):

        # Message with characters that would crash Telegram Markdown parser: _ * [ ] `
        tricky_msg = "Error in table_name: column `foo` failed [SPLIT_OR_BONUS] *critical*"
        res = send_telegram_alert(tricky_msg)
        assert res is True

        assert captured_req is not None
        payload = json.loads(captured_req.data.decode("utf-8"))
        assert "parse_mode" not in payload, "Payload must NOT contain parse_mode (plain text only)"
        assert payload["text"].startswith("[Pipeline Alert] ")
        assert "Error in table_name: column `foo` failed [SPLIT_OR_BONUS] *critical*" in payload["text"]

def test_telegram_alert_truncation_3500():
    """Verify R3: alert message is truncated to 3500 characters."""
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__.return_value = mock_resp

    captured_req = None

    def fake_urlopen(req, timeout=10):
        nonlocal captured_req
        captured_req = req
        return mock_resp

    with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "dummy_tok", "TELEGRAM_CHAT_ID": "dummy_chat"}), \
         patch("urllib.request.urlopen", side_effect=fake_urlopen):

        huge_msg = "X" * 5000
        res = send_telegram_alert(huge_msg)
        assert res is True

        assert captured_req is not None
        payload = json.loads(captured_req.data.decode("utf-8"))
        assert len(payload["text"]) <= 3500

def test_telegram_alert_non_200_returns_false():
    """Verify R3: HTTP error returns False without exposing secrets."""
    error_body = json.dumps({"ok": False, "error_code": 400, "description": "Bad Request"}).encode("utf-8")
    http_err = urllib.error.HTTPError("https://api.telegram.org", 400, "Bad Request", {}, MagicMock(read=lambda: error_body))

    with patch.dict(os.environ, {"TELEGRAM_BOT_TOKEN": "dummy_tok", "TELEGRAM_CHAT_ID": "dummy_chat"}), \
         patch("urllib.request.urlopen", side_effect=http_err):

        res = send_telegram_alert("test alert")
        assert res is False
