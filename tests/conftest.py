import os
import pytest
from unittest.mock import patch

@pytest.fixture(autouse=True)
def block_real_db(monkeypatch):
    """
    Prevents tests from connecting to real database.
    Invalidates DATABASE_URL and patches pipeline.db.get_connection to raise RuntimeError immediately
    unless a test explicitly mocks it.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr("pipeline.db.DATABASE_URL", None)

    def blocked_get_connection(*args, **kwargs):
        raise RuntimeError("Real DB connection blocked in tests! Mock pipeline.db.get_connection or provide a fake connection.")

    monkeypatch.setattr("pipeline.db.get_connection", blocked_get_connection)

    # Mock send_telegram_alert so tests never emit real Telegram notifications
    with patch("pipeline.alerts.send_telegram_alert"):
        yield

