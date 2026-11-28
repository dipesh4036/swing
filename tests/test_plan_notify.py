import io
import json
import urllib.error
from unittest.mock import MagicMock

from pipeline.alerts import send_telegram_text
from pipeline.plan_notify import format_daily_telegram_text, send_daily_plan_telegram, validate_telegram_text


def _sample_plan(long_names=False):
    cands = [
        {"symbol": ("VERY_LONG_SYMBOL_" + str(i)) if long_names else f"SYM{i}", "industry_label": "Healthcare Services" if i < 3 else "Beverages"}
        for i in range(15)
    ]
    return {
        "plan_date": "2026-11-27",
        "market": {"status": "available", "state": "Mixed", "pct_above_50sma": 57.3, "pct_above_200sma": 49.2, "net_highs_20d": 11},
        "caps": {
            "status": "available",
            "leader": "Large Cap",
            "segments": [
                {"label": "Large Cap", "ret_20d": 11.6},
                {"label": "Mid Cap", "ret_20d": 6.6},
                {"label": "Small Cap", "ret_20d": 4.3},
            ],
        },
        "breakouts": {
            "status": "available",
            "counts": {
                "stage2_breakout": {"today": 17, "prev_5d": 19},
                "vcp": {"today": 24, "prev_5d": 16},
                "near_pivot": {"today": 45, "prev_5d": 101},
            },
            "follow_through": {"label": "57.9% (11/19)"},
        },
        "top_industries": {
            "status": "available",
            "as_of": "2026-11-23",
            "groups": [
                {"pos": 1, "label": "Auto Components", "worstRank": 25},
                {"pos": 2, "label": "Capital Markets", "worstRank": 26},
                {"pos": 3, "label": "Aerospace & Defense", "worstRank": 26},
            ],
        },
        "total_candidates": 57,
        "candidates": cands,
    }


def test_format_truncation_and_banned_word_fallback():
    txt = format_daily_telegram_text(_sample_plan(long_names=True))
    assert len(txt) <= 900
    assert "Industries as of 2026-11-23" in txt
    assert "https://swing.dipeshdev.site/plan" in txt
    assert validate_telegram_text(txt) is True

    bad_plan = _sample_plan()
    bad_plan["market"]["state"] = "Strong buy"  # banned word
    fb = format_daily_telegram_text(bad_plan)
    assert fb == "Daily Plan 2026-11-27\nhttps://swing.dipeshdev.site/plan"


def test_send_telegram_text_missing_env_and_http_500(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert send_telegram_text("hello") is False

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "secret-tok")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "secret-chat")

    def _raise_500(*a, **k):
        raise urllib.error.HTTPError("https://api.telegram.org", 500, "err", {}, io.BytesIO(b"fail"))

    monkeypatch.setattr("urllib.request.urlopen", _raise_500)
    assert send_telegram_text("hello") is False


def test_send_daily_plan_telegram_idempotent(monkeypatch):
    state = {"notified_at": None, "calls": 0}

    class FakeCur:
        def execute(self, sql, params=None):
            if "SELECT plan_date" in sql:
                self._mode = "plan"
            elif "SELECT symbol" in sql:
                self._mode = "cands"
            elif "UPDATE daily_plan" in sql:
                state["notified_at"] = "2026-11-28T00:00:00Z"

        def fetchone(self):
            p = _sample_plan()
            return ("2026-11-27", p["market"], p["caps"], p["breakouts"], p["top_industries"], 57, state["notified_at"])

        def fetchall(self):
            return [("MCX", "Capital Markets"), ("CRAFTSMAN", "Auto Components")]

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    class FakeConn:
        def cursor(self):
            return FakeCur()

        def commit(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            pass

    monkeypatch.setattr("pipeline.plan_notify.get_connection", lambda: FakeConn())

    def _send_fail(txt):
        state["calls"] += 1
        return False

    res_fail = send_daily_plan_telegram("2026-11-27", send_fn=_send_fail)
    assert res_fail["status"] == "not_sent"
    assert state["notified_at"] is None  # HTTP 500 leaves notified_at null

    def _send_ok(txt):
        state["calls"] += 1
        return True

    r1 = send_daily_plan_telegram("2026-11-27", send_fn=_send_ok)
    assert r1["status"] == "sent"
    assert state["notified_at"] is not None

    r2 = send_daily_plan_telegram("2026-11-27", send_fn=_send_ok)
    assert r2["status"] == "skipped" and r2["reason"] == "already_notified"
