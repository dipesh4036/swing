import os
import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

def test_storage_guard_under_threshold():
    """Verify storage guard does not prune or alert if DB is under 700 MB."""
    from pipeline.workflow import check_storage_guard_and_prune

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_conn.__enter__.return_value = mock_conn

    # 100 MB in bytes
    mock_cursor.fetchone.return_value = (100 * 1024 * 1024,)

    with patch("pipeline.db.get_connection", return_value=mock_conn):
        with patch("pipeline.workflow.send_telegram_alert") as mock_alert:
            result = check_storage_guard_and_prune()

            assert result["exceeded"] is False
            assert result["pruned_count"] == 0
            mock_alert.assert_not_called()
            mock_cursor.execute.assert_called_once_with("SELECT pg_database_size(current_database());")

def test_storage_guard_over_threshold_prunes_and_alerts():
    """Verify storage guard sends Telegram alert and prunes ingest_runs older than 90 days if DB > 700 MB."""
    from pipeline.workflow import check_storage_guard_and_prune

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_conn.__enter__.return_value = mock_conn

    # 750 MB in bytes (exceeds 700 MB)
    mock_cursor.fetchone.return_value = (750 * 1024 * 1024,)
    mock_cursor.rowcount = 42

    with patch("pipeline.db.get_connection", return_value=mock_conn):
        with patch("pipeline.workflow.send_telegram_alert") as mock_alert:
            result = check_storage_guard_and_prune()

            assert result["exceeded"] is True
            assert result["pruned_count"] == 42
            mock_alert.assert_called_once()
            assert "750.0 MB" in mock_alert.call_args[0][0]
            # Ensure 90 days pruning query was executed
            calls = [c[0][0] for c in mock_cursor.execute.call_args_list]
            assert any("DELETE FROM ingest_runs WHERE started_at < NOW() - INTERVAL '90 days'" in c for c in calls)

def test_weekly_backup_pruning_retains_last_four():
    """Verify prune_dated_backups retains exactly 4 newest dated files and deletes older ones."""
    from pipeline.store import GitHubReleaseStorage

    storage = GitHubReleaseStorage(token="fake_token")

    # Mock 6 dated backup assets in release
    fake_assets = [
        {"name": "equity_ohlcv_20261115.parquet", "url": "https://api.github.com/assets/1"},
        {"name": "equity_ohlcv_20261108.parquet", "url": "https://api.github.com/assets/2"},
        {"name": "equity_ohlcv_20261101.parquet", "url": "https://api.github.com/assets/3"},
        {"name": "equity_ohlcv_20261025.parquet", "url": "https://api.github.com/assets/4"},
        {"name": "equity_ohlcv_20261018.parquet", "url": "https://api.github.com/assets/5"},
        {"name": "equity_ohlcv_20261011.parquet", "url": "https://api.github.com/assets/6"},
        {"name": "equity_ohlcv.parquet", "url": "https://api.github.com/assets/current"},
    ]

    mock_release = {
        "assets": fake_assets,
        "upload_url": "https://uploads.github.com/releases/123/assets{?name,label}"
    }

    deleted_urls = []
    def fake_urlopen(req, timeout=15):
        if req.get_method() == "DELETE":
            deleted_urls.append(req.full_url)
            m = MagicMock()
            m.status = 204
            return m
        raise NotImplementedError

    with patch.object(storage, "_get_or_create_release", return_value=mock_release):
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            pruned = storage.prune_dated_backups("equity_ohlcv_", max_keep=4)

            assert pruned == 2
            # 2 oldest assets should have been deleted: 20261018 and 20261011
            assert "https://api.github.com/assets/5" in deleted_urls
            assert "https://api.github.com/assets/6" in deleted_urls

