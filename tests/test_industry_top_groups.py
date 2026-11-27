"""Tests for UX1 (minimax Top 3 across timeframes) and UX2 (constrained Gemini/template summary)."""

from unittest.mock import MagicMock

from pipeline.industry_top_groups import (
    build_template_note,
    compute_top_groups_for_slice,
    generate_note,
    validate_gemini_note,
)


def _row(gid, label, d, w, m, q, elig=10, trend=1):
    return {
        "group_id": gid,
        "label": label,
        "n_eligible": elig,
        "median_1d": d,
        "median_1w": w,
        "median_1m": m,
        "median_3m": q,
        "n_20d_high": 2,
        "n_20d_low": 1,
        "pct_above_50dma": 65.0,
        "rank_trend": trend,
    }


def test_minimax_ordering_and_independent_rankings():
    # Group A: consistent (#2, #2, #2, #2 -> worst=2, mean=2.0)
    # Group B: spiky (#1, #1, #1, #4 -> worst=4, mean=1.75) -> loses to A on worst_rank!
    # Group C: (#3, #3, #3, #3 -> worst=3, mean=3.0) -> beats B on worst_rank!
    # Group D: (#4, #4, #4, #1 -> worst=4, mean=3.25) -> loses to B on mean_rank!
    # Group Small: n_eligible=4 (< 5) -> excluded
    # Group Null: median_3m=None -> excluded
    rows = [
        _row("gA", "Alpha", 4.0, 4.0, 4.0, 4.0, elig=10, trend=3),
        _row("gB", "Beta", 5.0, 5.0, 5.0, 1.0, elig=10, trend=1),
        _row("gC", "Gamma", 3.0, 3.0, 3.0, 3.0, elig=10, trend=2),
        _row("gD", "Delta", 1.0, 1.0, 1.0, 5.0, elig=10, trend=4),
        _row("gSmall", "Tiny", 99.0, 99.0, 99.0, 99.0, elig=4, trend=1),
        _row("gNull", "NullQ", 99.0, 99.0, 99.0, None, elig=10, trend=1),
    ]
    top = compute_top_groups_for_slice(rows, "2026-11-26", "industry", "all")
    assert [t["group_id"] for t in top] == ["gA", "gC", "gB"]
    assert [t["pos"] for t in top] == [1, 2, 3]
    assert top[0]["worst_rank"] == 2
    assert top[1]["worst_rank"] == 3
    assert top[2]["worst_rank"] == 4
    # Verify independent rankings: Beta is #1 on 1D/1W/1M, #4 on 3M
    assert (top[2]["r_1d"], top[2]["r_1w"], top[2]["r_1m"], top[2]["r_3m"]) == (1, 1, 1, 4)


def test_ties_and_fewer_than_3_qualify_and_determinism():
    rows = [
        _row("g2", "Zebra", 5.0, 5.0, 5.0, 5.0, trend=2),
        _row("g1", "Aardvark", 5.0, 5.0, 5.0, 5.0, trend=2),
    ]
    top1 = compute_top_groups_for_slice(rows, "2026-11-26", "macro", "liquid")
    top2 = compute_top_groups_for_slice(list(reversed(rows)), "2026-11-26", "macro", "liquid")
    assert len(top1) == 2  # Never pad
    assert [t["group_id"] for t in top1] == ["g1", "g2"]  # Label tie-break
    assert top1 == top2
    assert (top1[0]["r_1d"], top1[1]["r_1d"]) == (1, 1)  # Dense rank tie


def test_gemini_note_validation_and_fallbacks(monkeypatch):
    entry = {
        "label": "Private Sector Bank",
        "level": "basic_industry",
        "r_1d": 1,
        "r_1w": 2,
        "r_1m": 1,
        "r_3m": 3,
        "worst_rank": 3,
        "med_1d": 1.45,
        "med_1w": 3.20,
        "med_1m": 6.80,
        "med_3m": 12.10,
        "n_20d_high": 4,
        "n_20d_low": 0,
        "pct_above_50dma": 72.5,
        "n_eligible": 12,
    }
    tpl = build_template_note(entry)

    # 1. Missing key -> template
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    txt, src = generate_note(entry)
    assert src == "template" and txt == tpl

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-flash")

    def _mock_resp(text, status=200):
        m = MagicMock()
        m.status_code = status
        m.json.return_value = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        return m

    # 2. Accepted valid sentence
    good = "Private Sector Bank ranks #1 on 1D (+1.45%), #2 on 1W (+3.2%), #1 on 1M (+6.8%), and #3 on 3M (+12.1%) with 72.5% above 50 DMA."
    assert validate_gemini_note(good, entry) is True
    txt2, src2 = generate_note(entry, http_post=lambda *a, **k: _mock_resp(good))
    assert src2 == "gemini" and txt2 == good

    # 3. Banned word -> template
    bad_word = "Private Sector Bank is a strong buy at #1 on 1D (+1.45%)."
    txt3, src3 = generate_note(entry, http_post=lambda *a, **k: _mock_resp(bad_word))
    assert src3 == "template" and txt3 == tpl

    # 4. Invented number -> template
    invented = "Private Sector Bank ranks #1 on 1D (+9.99%) across 12 stocks."
    txt4, src4 = generate_note(entry, http_post=lambda *a, **k: _mock_resp(invented))
    assert src4 == "template" and txt4 == tpl

    # 5. Altered group name -> template
    altered = "Private Banks rank #1 on 1D (+1.45%)."
    txt5, src5 = generate_note(entry, http_post=lambda *a, **k: _mock_resp(altered))
    assert src5 == "template" and txt5 == tpl

    # 6. Timeout -> template
    def _timeout(*a, **k):
        raise TimeoutError("timed out")
    txt6, src6 = generate_note(entry, http_post=_timeout)
    assert src6 == "template" and txt6 == tpl
