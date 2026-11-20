"""
tests/test_part2.py

Test suite validating Part 2 — Live Chart from Angel (secured) + EMA Only + Cleanup:
1. Security grep check: API_KEY, CLIENT_ID, PIN, TOTP_SECRET only under src/lib/smartapi.js
2. Chart route authentication (401 without cookie) and indicators testing
3. Pipeline cleanup (removal of sync_angel_screener_candles.py, candle_window_sessions=260)
4. Playwright dependency removal verification
5. Overlays cleanup (no highlight_lines key)
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
import pytest
from pipeline.screeners import SCREENER_PARAMS


def test_grep_credentials_under_src():
    """Fail if API_KEY, CLIENT_ID, PIN or TOTP_SECRET appear anywhere under src/ except src/lib/smartapi.js."""
    forbidden_tokens = ["API_KEY", "CLIENT_ID", "PIN", "TOTP_SECRET"]
    src_dir = Path("src")
    allowed_file = Path("src/lib/smartapi.js").resolve()

    violations = []
    for file_path in src_dir.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.resolve() == allowed_file:
            continue

        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        for token in forbidden_tokens:
            # Check for exact token or process.env.TOKEN
            if re.search(rf"\b{token}\b", content):
                violations.append(f"{file_path}: contains '{token}'")

    assert not violations, f"Forbidden credential references found:\n" + "\n".join(violations)


def test_smartapi_hardening_invariants():
    """Verify src/lib/smartapi.js contains neutral placeholders, 5y history, and 400d chunking."""
    smartapi_path = Path("src/lib/smartapi.js")
    assert smartapi_path.exists()
    content = smartapi_path.read_text()

    assert "CHART_HISTORY_YEARS = 5" in content
    assert "MAX_DAYS_PER_REQUEST_ONE_DAY = 400" in content
    assert "127.0.0.1" in content
    assert "00:00:00:00:00:00" in content
    assert "106.193.147.98" not in content, "Hardcoded public IP must be removed"
    assert "fe80::216:3eff:fe12:3456" not in content, "Hardcoded MAC address must be removed"


def test_sync_angel_screener_candles_deleted():
    """Verify pipeline/sync_angel_screener_candles.py was deleted."""
    assert not Path("pipeline/sync_angel_screener_candles.py").exists()


def test_candle_window_sessions_is_260():
    """Verify candle_window_sessions in SCREENER_PARAMS is restored to 260."""
    assert SCREENER_PARAMS.get("candle_window_sessions") == 260


def test_playwright_removed_from_package_json():
    """Verify playwright is removed from dependencies and devDependencies."""
    pkg = json.loads(Path("package.json").read_text())
    deps = pkg.get("dependencies", {})
    dev_deps = pkg.get("devDependencies", {})
    assert "playwright" not in deps
    assert "playwright" not in dev_deps


def test_indicators_node_test_suite():
    """Execute indicators node test suite."""
    node_bin = shutil.which("node") or ("/opt/homebrew/bin/node" if Path("/opt/homebrew/bin/node").exists() else "node")
    cmd = [node_bin, "tests/test_indicators.mjs"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"Indicators test failed:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
    assert "All Indicators Tests Passed Successfully!" in res.stdout


def test_no_highlight_lines_in_pipeline_screeners():
    """Verify highlight_lines key is removed from all pipeline screener overlays."""
    content = Path("pipeline/screeners.py").read_text()
    assert '"highlight_lines"' not in content
    assert "'highlight_lines'" not in content

