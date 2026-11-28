import assert from "node:assert/strict";
import {
  parseTrackRecordParams,
  dedupeFirstInWindow,
  summarizeGroup,
  buildExcessHistogram,
} from "../src/lib/track-record.ts";

// 1. Param validation & allowlists
{
  const ok = parseTrackRecordParams(new URLSearchParams(""));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.params, {
      horizon: 5,
      ref: "open",
      source: "all",
      dedupe: "first",
      version: "plan_v1",
    });
  }

  for (const bad of ["horizon=3", "ref=high", "source=backfill", "dedupe=none", "version=bad;sql"]) {
    const res = parseTrackRecordParams(new URLSearchParams(bad));
    assert.equal(res.ok, false, `Expected '${bad}' to be rejected`);
  }
}

// 2. First-appearance dedupe within 10-session rolling window
{
  const tdIdx = new Map([
    ["2026-11-01", 0],
    ["2026-11-05", 4],
    ["2026-11-12", 10],
  ]);
  const rows = [
    { plan_date: "2026-11-01", token: 101 },
    { plan_date: "2026-11-05", token: 101 }, // within 10 sessions -> skipped
    { plan_date: "2026-11-12", token: 101 }, // idx 10 - 0 = 10 -> included
  ];
  const deduped = dedupeFirstInWindow(rows, tdIdx, 10);
  assert.equal(deduped.length, 2);
  assert.deepEqual(
    deduped.map((r) => r.plan_date),
    ["2026-11-01", "2026-11-12"]
  );
}

// 3. Summarize group & histogram
{
  const rows = [
    {
      plan_date: "2026-11-01",
      token: 1,
      symbol: "AAA",
      industry_label: "IndA",
      source: "live",
      horizon: 5,
      ret_from_close_pct: 5.0,
      ret_from_open_pct: 4.0,
      bench_ret_from_close_pct: 1.0,
      bench_ret_from_open_pct: 1.0,
      excess_from_close_pct: 4.0,
      excess_from_open_pct: 3.0,
      status: "matured",
      missing_reason: null,
    },
    {
      plan_date: "2026-11-02",
      token: 2,
      symbol: "BBB",
      industry_label: "IndA",
      source: "backfill",
      horizon: 5,
      ret_from_close_pct: null,
      ret_from_open_pct: null,
      bench_ret_from_close_pct: null,
      bench_ret_from_open_pct: null,
      excess_from_close_pct: null,
      excess_from_open_pct: null,
      status: "missing",
      missing_reason: "missing_candle",
    },
  ];
  const s = summarizeGroup("candidates", "Plan candidates", rows, "open");
  assert.equal(s.n_rows, 1);
  assert.equal(s.n_missing, 1);
  assert.equal(s.n_beat_bench, 1);
  assert.equal(s.median_excess, 3.0);

  const hist = buildExcessHistogram([3.0, -6.0], [1.0]);
  assert.equal(hist.find((b) => b.label === "+2 to +5%")?.candidates, 1);
  assert.equal(hist.find((b) => b.label === "-10 to -5%")?.candidates, 1);
  assert.equal(hist.find((b) => b.label === "0 to +2%")?.baseline, 1);
}

console.log("✓ Track Record param validation, dedupe & summary tests passed!");
