"""
tests/test_auth.py

Test suite validating Part 1 Authentication:
1. Executes Node unit/integration tests (tests/test_auth.mjs)
2. Validates Migration 007 SQL structure and web_readonly privilege boundaries
3. Validates database permission enforcement if connected
"""

import os
import shutil
import subprocess
from pathlib import Path
import pytest


def test_auth_node_test_suite():
    """Run Node auth test suite covering bcryptjs, jose, IP hashing, and requireAuth."""
    node_bin = shutil.which("node") or ("/opt/homebrew/bin/node" if Path("/opt/homebrew/bin/node").exists() else "node")
    cmd = [node_bin, "tests/test_auth.mjs"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"Node auth tests failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    assert "All Auth Tests Passed Successfully!" in res.stdout


def test_migration_007_sql_structure():
    """Verify 007_auth.sql creates tables and restricts web_readonly permissions."""
    sql_path = Path("pipeline/migrations/007_auth.sql")
    assert sql_path.exists(), "pipeline/migrations/007_auth.sql must exist"
    content = sql_path.read_text()

    assert "CREATE TABLE IF NOT EXISTS app_users" in content
    assert "CREATE TABLE IF NOT EXISTS login_attempts" in content
    assert "GRANT SELECT ON TABLE app_users TO web_readonly;" in content or "GRANT SELECT ON app_users TO web_readonly;" in content
    assert "GRANT SELECT, INSERT, DELETE ON TABLE login_attempts TO web_readonly;" in content or "GRANT SELECT, INSERT, DELETE ON login_attempts TO web_readonly;" in content

    # Ensure no write privileges to app_users
    assert "GRANT INSERT ON app_users" not in content
    assert "GRANT UPDATE ON app_users" not in content
    assert "GRANT DELETE ON app_users" not in content


def test_create_user_script_safety():
    """Verify scripts/create-user.mjs enforces safety guards."""
    script_path = Path("scripts/create-user.mjs")
    assert script_path.exists(), "scripts/create-user.mjs must exist"
    content = script_path.read_text()

    assert "--replace" in content
    assert "bcrypt.hash(password, 12)" in content
    assert "promptHidden" in content


def test_api_routes_require_auth():
    """Verify requireAuth is called in all protected API routes."""
    routes = [
        "src/app/api/terminal/data/route.js",
        "src/app/api/terminal/screener/route.js",
        "src/app/api/terminal/screener/chart/route.js",
    ]
    for route in routes:
        path = Path(route)
        assert path.exists(), f"{route} must exist"
        code = path.read_text()
        assert "requireAuth" in code, f"{route} must call requireAuth"
        assert "Unauthorized" in code, f"{route} must return Unauthorized when unauthenticated"


@pytest.mark.skipif(
    not os.getenv("READONLY_DATABASE_URL") and not os.getenv("DATABASE_URL"),
    reason="Database URL not configured for live privilege test",
)
def test_web_readonly_privileges_live():
    """Verify live web_readonly role cannot write to app_users or core data tables."""
    import psycopg2
    from psycopg2 import errors

    db_url = os.getenv("READONLY_DATABASE_URL") or os.getenv("DATABASE_URL")
    # Only test if connecting as web_readonly
    if "web_readonly" not in db_url:
        pytest.skip("Not connected as web_readonly user")

    conn = psycopg2.connect(db_url, sslmode="require")
    try:
        with conn.cursor() as cur:
            # 1. Reading app_users should succeed
            cur.execute("SELECT COUNT(*) FROM app_users;")
            _ = cur.fetchone()

            # 2. Writing to app_users must be rejected
            with pytest.raises(errors.InsufficientPrivilege):
                cur.execute("INSERT INTO app_users (email, password_hash) VALUES ('test@hack.com', 'dummy');")
        conn.rollback()

        with conn.cursor() as cur:
            # 3. Writing to daily_market_breadth must be rejected
            with pytest.raises(errors.InsufficientPrivilege):
                cur.execute("DELETE FROM daily_market_breadth WHERE trade_date = '2099-01-01';")
        conn.rollback()
    finally:
        conn.close()
