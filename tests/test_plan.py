"""Tests for Tab 4 Daily Plan rules, filtering, ordering, missing blocks, and P3 Gemini/template summary."""

from unittest.mock import MagicMock

from pipeline.plan import (
    build_plan_template_summary,
    evaluate_cap_leadership,
    evaluate_follow_through,
    evaluate_market_state,
    filter_and_order_candidates,
    generate_plan_summary,
    validate_plan_summary,
)


def test_market_state_branches():
    strong = evaluate_market_state(65.0, 55.0, 12, pct_50_prev5=58.0, as_of="2026-11-23")
    assert strong["status"] == "available"
    assert strong["state"] == "Strong"
    assert strong["delta_50sma_5d"] == 7.0

    weak_50 = evaluate_market_state(38.0, 55.0, 10)
    assert weak_50["state"] == "Weak"

    weak_200 = evaluate_market_state(50.0, 34.0, 10)
    assert weak_200["state"] == "Weak"

    mixed = evaluate_market_state(62.0, 52.0, -5)  # net_highs_20d <= 0 -> Mixed
    assert mixed["state"] == "Mixed"

    unavail = evaluate_market_state(None, 50.0, 5)
    assert unavail["status"] == "unavailable"


def test_cap_leadership_gap_rule():
    segs_lead = [
        {"key": "large", "label": "Large Cap", "ret_20d": 4.5, "ret_5d": 1.0, "pct_above_50sma": 60.0},
        {"key": "mid", "label": "Mid Cap", "ret_20d": 2.0, "ret_5d": 0.5, "pct_above_50sma": 50.0},
        {"key": "small", "label": "Small Cap", "ret_20d": 1.0, "ret_5d": 0.2, "pct_above_50sma": 40.0},
    ]
    res1 = evaluate_cap_leadership(segs_lead)
    assert res1["leader"] == "Large Cap"
    assert res1["gap_pp"] == 2.5

    segs_close = [
        {"key": "large", "label": "Large Cap", "ret_20d": 4.5, "ret_5d": 1.0, "pct_above_50sma": 60.0},
        {"key": "mid", "label": "Mid Cap", "ret_20d": 3.8, "ret_5d": 0.5, "pct_above_50sma": 50.0},
        {"key": "small", "label": "Small Cap", "ret_20d": 1.0, "ret_5d": 0.2, "pct_above_50sma": 40.0},
    ]
    res2 = evaluate_cap_leadership(segs_close)
    assert res2["leader"] == "no clear leader"
    assert res2["gap_pp"] == 0.7


def test_follow_through_sample_size_guard():
    small_sample = [(i, 100.0) for i in range(1, 10)]
    closes = {i: 105.0 for i in range(1, 15)}
    res_small = evaluate_follow_through(small_sample, closes)
    assert res_small["n"] == 9
    assert res_small["pct"] is None
    assert res_small["label"] == "too few to judge"

    full_sample = [(i, 100.0) for i in range(1, 11)]
    closes_full = {i: (105.0 if i <= 7 else 95.0) for i in range(1, 11)}
    res_full = evaluate_follow_through(full_sample, closes_full)
    assert res_full["n"] == 10
    assert res_full["holding_count"] == 7
    assert res_full["pct"] == 70.0


def test_candidate_filter_exclusions_ordering_and_cap():
    top_ind = [
        {"pos": 1, "label": "Healthcare Services"},
        {"pos": 2, "label": "Personal Products"},
        {"pos": 3, "label": "Beverages"},
    ]
    # Test each exclusion individually + ordering + cap at 20
    stocks = [
        # Excluded: wrong industry
        {"token": 1, "symbol": "OUT_IND", "industry": "Banks", "is_liquid": True, "rs_rating": 95, "stage": 2, "pct_from_52w_high": 5.0, "close": 100, "ret_1d_pct": 1.0},
        # Excluded: not liquid
        {"token": 2, "symbol": "OUT_LIQ", "industry": "Healthcare Services", "is_liquid": False, "rs_rating": 95, "stage": 2, "pct_from_52w_high": 5.0, "close": 100, "ret_1d_pct": 1.0},
        # Excluded: RS < 70
        {"token": 3, "symbol": "OUT_RS", "industry": "Healthcare Services", "is_liquid": True, "rs_rating": 69.9, "stage": 2, "pct_from_52w_high": 5.0, "close": 100, "ret_1d_pct": 1.0},
        # Excluded: stage != 2
        {"token": 4, "symbol": "OUT_STG", "industry": "Healthcare Services", "is_liquid": True, "rs_rating": 95, "stage": 3, "pct_from_52w_high": 5.0, "close": 100, "ret_1d_pct": 1.0},
        # Excluded: > 25% below 52W high
        {"token": 5, "symbol": "OUT_52W", "industry": "Healthcare Services", "is_liquid": True, "rs_rating": 95, "stage": 2, "pct_from_52w_high": 25.1, "close": 100, "ret_1d_pct": 1.0},
    ]
    # Add 22 qualifying stocks distributed across 5 industries (so global cap of 20 triggers cleanly)
    extra_top = top_ind + [
        {"pos": 4, "label": "IT - Software"},
        {"pos": 5, "label": "Auto Components"},
    ]
    ind_names = ["Personal Products", "Beverages", "Healthcare Services", "IT - Software", "Auto Components"]
    for i in range(22):
        stocks.append({
            "token": 100 + i,
            "symbol": f"CAND{i:02d}",
            "industry": ind_names[i % 5],
            "is_liquid": True,
            "rs_rating": 70.0 + i,
            "stage": 2,
            "pct_from_52w_high": 10.0,
            "close": 200.0,
            "ret_1d_pct": 1.5,
        })
    # Give CAND00 a stage2_breakout hit so it must rank #1 despite lower RS than CAND21
    hits = {100: ["stage2_breakout"], 101: ["vcp"]}

    capped, total = filter_and_order_candidates(stocks, extra_top, hits)
    assert total == 22
    assert len(capped) == 20
    assert capped[0]["symbol"] == "CAND00"
    assert capped[1]["symbol"] == "CAND01"
    assert capped[2]["symbol"] == "CAND21"  # highest RS among non-hit rows
    assert all(s["symbol"] not in {c["symbol"] for c in capped} for s in stocks[:5])


def test_per_industry_cap_hidden_count_and_ordering():
    top_ind = [
        {"pos": 1, "label": "Healthcare Services"},
        {"pos": 2, "label": "Personal Products"},
        {"pos": 3, "label": "Beverages"},
    ]
    stocks = []
    # 8 qualifying stocks in Healthcare Services (cap = 5 -> 3 hidden)
    for i in range(8):
        stocks.append({
            "token": 200 + i,
            "symbol": f"HC{i:02d}",
            "industry": "Healthcare Services",
            "is_liquid": True,
            "rs_rating": 75.0 + i,
            "stage": 2,
            "pct_from_52w_high": 8.0,
            "close": 100.0 + i,
            "ret_1d_pct": 1.0,
        })
    # 3 qualifying stocks in Personal Products (< 5 -> 0 hidden)
    for i in range(3):
        stocks.append({
            "token": 300 + i,
            "symbol": f"PP{i:02d}",
            "industry": "Personal Products",
            "is_liquid": True,
            "rs_rating": 80.0 + i,
            "stage": 2,
            "pct_from_52w_high": 6.0,
            "close": 200.0 + i,
            "ret_1d_pct": 2.0,
        })
    # Give HC00 a vcp hit so it beats higher-RS HC07 inside the group
    hits = {200: ["vcp"]}
    hidden = {}
    capped, total = filter_and_order_candidates(stocks, top_ind, hits, hidden_by_industry_out=hidden)
    assert total == 11
    assert len(capped) == 8  # 5 from Healthcare Services + 3 from Personal Products
    hc_shown = [c for c in capped if c["industry_label"] == "Healthcare Services"]
    pp_shown = [c for c in capped if c["industry_label"] == "Personal Products"]
    assert [c["symbol"] for c in hc_shown] == ["HC00", "HC07", "HC06", "HC05", "HC04"]
    assert [c["symbol"] for c in pp_shown] == ["PP02", "PP01", "PP00"]
    assert hidden["Healthcare Services"] == 3
    assert hidden["Personal Products"] == 0
    assert hidden["Beverages"] == 0


def test_plan_summary_gemini_and_fallbacks(monkeypatch):
    payload = {
        "plan_date": "2026-11-23",
        "market": {"status": "available", "state": "Mixed", "pct_above_50sma": 48.0, "pct_above_200sma": 42.0, "net_highs_20d": -10},
        "caps": {"status": "available", "leader": "no clear leader"},
        "breakouts": {"status": "available", "stage2_pct": {"nifty500": 35.2}},
        "top_industries": {"status": "available", "groups": [{"label": "Healthcare Services"}, {"label": "Personal Products"}, {"label": "Beverages"}]},
        "total_candidates": 8,
    }
    tpl = build_plan_template_summary(payload)
    assert "Mixed" in tpl

    # Missing key -> template
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    txt, src = generate_plan_summary(payload)
    assert src == "template" and txt == tpl

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-flash")

    def _mock(text):
        m = MagicMock()
        m.status_code = 200
        m.json.return_value = {"candidates": [{"content": {"parts": [{"text": text}]}}]}
        return m

    good = "Market is Mixed at 48% >50 SMA and 42% >200 SMA. Cap leadership shows no clear leader. Healthcare Services, Personal Products, and Beverages lead with 8 candidates."
    assert validate_plan_summary(good, payload) is True
    t2, s2 = generate_plan_summary(payload, http_post=lambda *a, **k: _mock(good))
    assert s2 == "gemini" and t2 == good

    bad = "Market is Mixed, buy Healthcare Services now."
    t3, s3 = generate_plan_summary(payload, http_post=lambda *a, **k: _mock(bad))
    assert s3 == "template" and t3 == tpl

    invented = "Market is Mixed at 99.9% >50 SMA."
    t4, s4 = generate_plan_summary(payload, http_post=lambda *a, **k: _mock(invented))
    assert s4 == "template" and t4 == tpl

    def _timeout(*a, **k):
        raise TimeoutError("timeout")
    t5, s5 = generate_plan_summary(payload, http_post=_timeout)
    assert s5 == "template" and t5 == tpl
