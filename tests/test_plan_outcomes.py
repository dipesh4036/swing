from pipeline.plan_outcomes import compute_outcome_row, select_control_candidates


def test_horizon_holiday_gap_and_reference_prices():
    # Holiday between 2026-11-24 and 2026-11-26 (2026-11-25 is absent from trading_days)
    trading_days = ["2026-11-23", "2026-11-24", "2026-11-26", "2026-11-27", "2026-11-30", "2026-12-01"]
    candles = {
        "2026-11-23": {"open": 98.0, "close": 100.0},
        "2026-11-24": {"open": 102.0, "close": 104.0},
        "2026-11-26": {"open": 104.0, "close": 106.0},
        "2026-11-27": {"open": 106.0, "close": 108.0},
        "2026-11-30": {"open": 108.0, "close": 110.0},
        "2026-12-01": {"open": 110.0, "close": 112.2},  # h=5 after 2026-11-23
    }
    bench = {
        "2026-11-23": {"open": 990.0, "close": 1000.0},
        "2026-11-24": {"open": 1010.0, "close": 1015.0},
        "2026-11-26": {"open": 1015.0, "close": 1020.0},
        "2026-11-27": {"open": 1020.0, "close": 1025.0},
        "2026-11-30": {"open": 1025.0, "close": 1030.0},
        "2026-12-01": {"open": 1030.0, "close": 1050.0},
    }

    # h=1 -> fwd_date=2026-11-24
    r1 = compute_outcome_row("2026-11-23", 1, "TEST", "IndA", "plan_v1", "live", 1, trading_days, candles, bench)
    assert r1 is not None and r1["status"] == "matured"
    assert r1["fwd_date"] == "2026-11-24"
    assert round(r1["ret_from_close_pct"], 2) == 4.00
    assert round(r1["ret_from_open_pct"], 2) == round((104.0 / 102.0 - 1) * 100, 2)
    assert round(r1["bench_ret_from_close_pct"], 2) == 1.50
    assert round(r1["excess_from_close_pct"], 2) == 2.50

    # h=5 across holiday -> fwd_date=2026-12-01
    r5 = compute_outcome_row("2026-11-23", 1, "TEST", "IndA", "plan_v1", "live", 5, trading_days, candles, bench)
    assert r5 is not None and r5["status"] == "matured"
    assert r5["fwd_date"] == "2026-12-01"
    assert round(r5["ret_from_close_pct"], 2) == 12.20
    assert round(r5["ret_from_open_pct"], 2) == 10.00
    assert round(r5["bench_ret_from_close_pct"], 2) == 5.00
    assert round(r5["excess_from_close_pct"], 2) == 7.20

    # h=10 not yet matured -> None (row absent)
    r10 = compute_outcome_row("2026-11-23", 1, "TEST", "IndA", "plan_v1", "live", 10, trading_days, candles, bench)
    assert r10 is None


def test_missing_candle_and_split_jump_handling():
    trading_days = ["2026-11-23", "2026-11-24", "2026-11-25"]
    bench = {
        "2026-11-23": {"open": 1000.0, "close": 1000.0},
        "2026-11-24": {"open": 1000.0, "close": 1000.0},
        "2026-11-25": {"open": 1000.0, "close": 1000.0},
    }

    # Missing candle at fwd_date -> status='missing', never dropped or forward-filled
    candles_missing = {
        "2026-11-23": {"open": 100.0, "close": 100.0},
        "2026-11-24": {"open": 101.0, "close": 102.0},
    }
    rm = compute_outcome_row("2026-11-23", 2, "MISS", "IndA", "plan_v1", "backfill", 2, trading_days, candles_missing, bench)
    assert rm is not None and rm["status"] == "missing"
    assert rm["missing_reason"] == "missing_candle"
    assert rm["ret_from_close_pct"] is None

    # Split-like > 40% 1-day drop -> status='missing', split_or_corporate_action
    candles_split = {
        "2026-11-23": {"open": 200.0, "close": 200.0},
        "2026-11-24": {"open": 100.0, "close": 100.0},  # -50% split
    }
    rs = compute_outcome_row("2026-11-23", 3, "SPLIT", "IndA", "plan_v2", "live", 1, trading_days, candles_split, bench)
    assert rs is not None and rs["status"] == "missing"
    assert rs["missing_reason"] == "split_or_corporate_action"
    assert rs["rules_version"] == "plan_v2"


def test_control_selection_reproducible_and_capped():
    top_ind = [{"pos": 1, "label": "TopInd"}]
    stocks = []
    # TopInd excluded from control
    stocks.append({"token": 1, "symbol": "TOP1", "industry": "TopInd", "is_liquid": True, "rs_rating": 95, "stage": 2, "pct_from_52w_high": 5.0})
    # 10 stocks in OtherA (cap 5), 10 in OtherB (cap 5), 10 in OtherC (cap 5), 10 in OtherD (cap 5) -> 20 total
    for idx, ind in enumerate(["OtherA", "OtherB", "OtherC", "OtherD", "OtherE"]):
        for j in range(8):
            stocks.append({
                "token": 100 + idx * 20 + j,
                "symbol": f"{ind}_{j}",
                "industry": ind,
                "is_liquid": True,
                "rs_rating": 80.0,
                "stage": 2,
                "pct_from_52w_high": 10.0,
            })

    c1 = select_control_candidates(stocks, top_ind, "2026-11-27")
    c2 = select_control_candidates(stocks, top_ind, "2026-11-27")
    assert c1 == c2
    assert len(c1) == 20
    assert all(x["industry_label"] != "TopInd" for x in c1)
    by_ind = {}
    for x in c1:
        by_ind[x["industry_label"]] = by_ind.get(x["industry_label"], 0) + 1
    assert all(cnt <= 5 for cnt in by_ind.values())
