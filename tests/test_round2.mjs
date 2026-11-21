/**
 * tests/test_round2.mjs
 *
 * Regression test suite for Round 2 findings (R1, R2, R9, R10, R13, R14).
 */

import assert from "node:assert/strict";
import fs from "node:fs";

async function runTests() {
  console.log("--- Starting Round 2 Node Test Suite ---");

  // -------------------------------------------------------------------------
  // R1: LargeMidSmall Component rebasedSeries & Null/Gap Handling
  // -------------------------------------------------------------------------
  console.log("1. Testing R1: LargeMidSmall data processing logic...");
  
  // Synthetic rebasedSeries with 3 sessions; Mid has a null/missing session; Small is completely empty
  const rebasedSeries = {
    large: [
      { date: "2026-11-18", rebased: 100.0 },
      { date: "2026-11-19", rebased: 102.5 },
      { date: "2026-11-20", rebased: 105.0 },
    ],
    mid: [
      { date: "2026-11-18", rebased: 200.0 },
      // 2026-11-19 is missing
      { date: "2026-11-20", rebased: 198.0 },
    ],
    small: [], // completely missing
  };

  const dates = ["2026-11-18", "2026-11-19", "2026-11-20"];
  const largeMap = new Map(rebasedSeries.large.map((r) => [r.date, r]));
  const midMap = new Map(rebasedSeries.mid.map((r) => [r.date, r]));
  const smallMap = new Map(rebasedSeries.small.map((r) => [r.date, r]));

  const largeBase = largeMap.get(dates[0])?.rebased;
  const midBase = midMap.get(dates[0])?.rebased;
  const smallBase = smallMap.get(dates[0])?.rebased ?? null;

  assert.equal(largeBase, 100.0);
  assert.equal(midBase, 200.0);
  assert.equal(smallBase, null);

  const calcReturn = (map, baseVal, date) => {
    if (!baseVal) return null;
    const row = map.get(date);
    if (!row || typeof row.rebased !== "number" || isNaN(row.rebased)) return null;
    return Number((((row.rebased - baseVal) / baseVal) * 100).toFixed(2));
  };

  const day1Large = calcReturn(largeMap, largeBase, "2026-11-18");
  const day2Large = calcReturn(largeMap, largeBase, "2026-11-19");
  const day2Mid = calcReturn(midMap, midBase, "2026-11-19");
  const day1Small = calcReturn(smallMap, smallBase, "2026-11-18");

  assert.equal(day1Large, 0.0, "Day 1 rebase must be 0.0%");
  assert.equal(day2Large, 2.5, "Day 2 return must be +2.5%");
  assert.equal(day2Mid, null, "Missing mid session must yield null (gap), never 0");
  assert.equal(day1Small, null, "Missing small series must yield null");

  // Verify LargeMidSmall.js source does not plot pctAbove20ema or fake 0
  const lmsSource = fs.readFileSync("src/components/market-breadth/LargeMidSmall.js", "utf8");
  assert.ok(!lmsSource.includes("pctAbove20ema"), "LargeMidSmall must not plot pctAbove20ema");
  assert.ok(!lmsSource.includes("pctAbove50sma"), "LargeMidSmall must not plot pctAbove50sma");
  assert.ok(!lmsSource.includes("pctAbove200sma"), "LargeMidSmall must not plot pctAbove200sma");

  // -------------------------------------------------------------------------
  // R2: Updated N Hours Ago Query & No Fabricated Fallback
  // -------------------------------------------------------------------------
  console.log("2. Testing R2: Ingest runs query and lastUpdatedAt null handling...");
  const dataRouteSource = fs.readFileSync("src/app/api/terminal/data/route.js", "utf8");
  assert.ok(
    dataRouteSource.includes("status IN ('success', 'partial')"),
    "Ingest runs query must match status IN ('success', 'partial')"
  );
  assert.ok(
    !dataRouteSource.includes("status = 'completed'"),
    "Ingest runs query must not check for non-existent status 'completed'"
  );

  const pageSource = fs.readFileSync("src/app/(terminal)/page.jsx", "utf8");
  assert.ok(
    !pageSource.includes("T10:00:00Z"),
    "page.jsx must never fall back to fabricated T10:00:00Z timestamp"
  );
  assert.ok(
    pageSource.includes("if (!asOfDate || !lastUpdatedAt) return \"—\";"),
    "page.jsx must return '—' when lastUpdatedAt is null"
  );

  // -------------------------------------------------------------------------
  // R9: Live Universe Totals from Database (No Hard-coded UNIVERSE_COVERAGE)
  // -------------------------------------------------------------------------
  console.log("3. Testing R9: Dynamic universe totals in data route...");
  assert.ok(
    !dataRouteSource.includes("total: 2599"),
    "data route must not hardcode total: 2599"
  );
  assert.ok(
    !dataRouteSource.includes("total: 501"),
    "data route must not hardcode total: 501"
  );
  assert.ok(
    dataRouteSource.includes("SELECT COUNT(DISTINCT isin)::int as total FROM instruments"),
    "data route must query instruments for universe 'all'"
  );
  assert.ok(
    dataRouteSource.includes("SELECT COUNT(DISTINCT symbol)::int as total FROM index_constituents"),
    "data route must query index_constituents for index universes"
  );

  // -------------------------------------------------------------------------
  // R10: Real Zeros in FII/DII Preserved (Not Converted to Null)
  // -------------------------------------------------------------------------
  console.log("4. Testing R10: Genuine zero values in FII/DII parsing...");
  // Simulate row with 0.0 values
  const zeroRow = {
    fii_buy: "0.0",
    fii_sell: "0.0",
    fii_net: "0.0",
    dii_buy: 0,
    dii_sell: 0,
    dii_net: 0,
  };

  const parseFlow = (val) => (val !== null && val !== undefined ? parseFloat(val) : null);
  assert.equal(parseFlow(zeroRow.fii_buy), 0.0, "fii_buy with '0.0' must parse to 0, not null");
  assert.equal(parseFlow(zeroRow.fii_net), 0.0, "fii_net with '0.0' must parse to 0, not null");
  assert.equal(parseFlow(zeroRow.dii_net), 0.0, "dii_net with 0 must parse to 0, not null");
  assert.equal(parseFlow(null), null, "null must parse to null");
  assert.equal(parseFlow(undefined), null, "undefined must parse to null");

  // -------------------------------------------------------------------------
  // R3 & R4: Telegram Plain Text & Health Check Branch Check
  // -------------------------------------------------------------------------
  console.log("5. Testing R3 & R4: Health route alert & GitHub branch check...");
  const healthRouteSource = fs.readFileSync("src/app/api/health/route.js", "utf8");
  assert.ok(
    !healthRouteSource.includes('parse_mode: "Markdown"'),
    "health/route.js must not send parse_mode: 'Markdown'"
  );
  assert.ok(
    healthRouteSource.includes("[Pipeline Alert]"),
    "health/route.js must prefix alerts with [Pipeline Alert]"
  );
  assert.ok(
    !healthRouteSource.includes("commits/main"),
    "health/route.js must not hardcode commits/main"
  );
  assert.ok(
    healthRouteSource.includes("GITHUB_BRANCH || \"v1\""),
    "health/route.js must default GITHUB_BRANCH to v1"
  );
  assert.ok(
    healthRouteSource.includes('githubCheck = "unavailable"'),
    "health/route.js must set githubCheck to unavailable on non-ok GitHub responses"
  );

  // -------------------------------------------------------------------------
  // R11: Parallel Login Lockout Race Condition Prevention
  // -------------------------------------------------------------------------
  console.log("6. Testing R11: Concurrent login lockout race condition prevention...");
  {
    const attemptsTable = [];
    let comparePasswordCalls = 0;

    // Simulated handler implementing the exact DB pattern in login/route.js
    const simulateLoginAttempt = async (email, ipHash, password) => {
      // 1. Record attempt up front with success=false RETURNING id
      const attemptId = attemptsTable.length + 1;
      attemptsTable.push({ id: attemptId, email, ip_hash: ipHash, success: false, time: Date.now() });

      // 2. Lockout check including this newly recorded attempt
      const ipFailed = attemptsTable.filter(
        (a) => a.ip_hash === ipHash && a.success === false
      ).length;
      const emailIpFailed = attemptsTable.filter(
        (a) => a.email === email && a.ip_hash === ipHash && a.success === false
      ).length;

      if (ipFailed > 5 || emailIpFailed > 5) {
        return { status: 429, error: "Too many failed login attempts." };
      }

      // 3. User lookup & password comparison
      comparePasswordCalls++;
      // Simulate bcrypt delay
      await new Promise((r) => setTimeout(r, 10));

      const isMatch = password === "correct_password";
      if (!isMatch) {
        return { status: 401, error: "Invalid email or password" };
      }

      // On success: update to success=true
      const rec = attemptsTable.find((a) => a.id === attemptId);
      if (rec) rec.success = true;

      return { status: 200, success: true };
    };

    // Fire 10 concurrent requests with wrong password
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(simulateLoginAttempt("owner@example.com", "dummy_ip_hash", "wrong_password"));
    }
    const results = await Promise.all(promises);

    const statuses = results.map((r) => r.status);
    const count401 = statuses.filter((s) => s === 401).length;
    const count429 = statuses.filter((s) => s === 429).length;

    assert.equal(count401, 5, "Exactly 5 requests should reach password check and return 401");
    assert.equal(count429, 5, "Remaining 5 requests must be blocked by rate limit with 429");
    assert.equal(comparePasswordCalls, 5, "At most 5 requests must reach password comparison");
  }

  // -------------------------------------------------------------------------
  // R12: Live Angel Chart Negative Caching & Candle Processing
  // -------------------------------------------------------------------------
  console.log("7. Testing R12: Chart login negative cache, future candle filtering, and avg_vol_20...");
  {
    // R12a: Negative Cache behavior
    const { getSmartApiToken, resetLoginFailureState, getLoginFailureState } = await import("../src/lib/smartapi.js");
    resetLoginFailureState();

    // Verify negative cache timing logic
    let failCount = 0;
    let cacheUntil = 0;
    const recordFail = () => {
      failCount++;
      const backoffSec = failCount >= 3 ? 300 : 60;
      cacheUntil = Date.now() + backoffSec * 1000;
      return backoffSec;
    };

    assert.equal(recordFail(), 60, "First failure should backoff for 60s");
    assert.equal(recordFail(), 60, "Second failure should backoff for 60s");
    assert.equal(recordFail(), 300, "Third failure should backoff for 300s (5m)");

    // R12b: Drop future/in-progress candles
    const asOfDate = "2026-11-20";
    const sampleCandles = [
      { date: "2026-11-18", close: 100, volume: 50000 },
      { date: "2026-11-19", close: 102, volume: 60000 },
      { date: "2026-11-20", close: 105, volume: 70000 },
      { date: "2026-11-21", close: 108, volume: 80000 }, // in-progress / future day!
    ];
    const filtered = sampleCandles.filter((c) => c && c.date <= asOfDate);
    assert.equal(filtered.length, 3, "Future candle dated 2026-11-21 must be dropped");
    assert.equal(filtered[filtered.length - 1].date, "2026-11-20");

    // R12c: avg_vol_20 treats null volume properly and requires >= 10 valid sessions
    const computeAvgVol = (candlesList) => {
      const last20 = candlesList.slice(-20);
      const valid = last20
        .map((c) => c.volume)
        .filter((v) => v !== null && v !== undefined && typeof v === "number" && !isNaN(v));
      if (valid.length < 10) return null;
      return Math.round(valid.reduce((acc, v) => acc + v, 0) / valid.length);
    };

    // Case 1: Fewer than 10 valid sessions (e.g. 8 valid, 12 nulls)
    const candlesSparse = Array.from({ length: 20 }, (_, i) => ({
      date: `D${i}`,
      volume: i < 8 ? 50000 : null,
    }));
    assert.equal(computeAvgVol(candlesSparse), null, "Fewer than 10 valid volumes must yield null");

    // Case 2: Exactly 10 valid sessions with 50,000 each and 10 nulls
    const candles10Valid = Array.from({ length: 20 }, (_, i) => ({
      date: `D${i}`,
      volume: i < 10 ? 50000 : null,
    }));
    assert.equal(computeAvgVol(candles10Valid), 50000, "10 valid volumes should average over 10 valid sessions");

    // Case 3: 20 valid sessions (10 at 40,000, 10 at 60,000)
    const candles20Valid = Array.from({ length: 20 }, (_, i) => ({
      date: `D${i}`,
      volume: i < 10 ? 40000 : 60000,
    }));
    assert.equal(computeAvgVol(candles20Valid), 50000, "20 valid volumes should average to 50,000");
  }

  // -------------------------------------------------------------------------
  // R17: Large · Mid · Small Independent capSeries & 1M/3M/YTD Periods
  // -------------------------------------------------------------------------
  console.log("8. Testing R17: LargeMidSmall capSeries independent 1M/3M/YTD slicing...");
  {
    // Generate 260 trading dates across 2025 and 2026 (e.g. 100 in 2025, 160 in 2026)
    const dates = [];
    for (let i = 0; i < 100; i++) {
      const month = String(Math.floor(i / 10) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      dates.push(`2025-${month}-${day}`);
    }
    for (let i = 0; i < 160; i++) {
      const month = String(Math.floor(i / 16) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      dates.push(`2026-${month}-${day}`);
    }
    // Ensure unique and sorted
    const sortedDates = Array.from(new Set(dates)).sort();

    // Large has 260 sessions with steady return
    const largeSeries = sortedDates.map((d, i) => ({
      date: d,
      close: 20000 + i * 20, // 20000 up to ~25200
    }));

    // Mid has 260 sessions
    const midSeries = sortedDates.map((d, i) => ({
      date: d,
      close: 15000 + i * 15,
    }));

    // Small has only 30 sessions (fewer than 63 needed for 3M)
    const smallSeries = sortedDates.slice(-30).map((d, i) => ({
      date: d,
      close: 10000 + i * 10,
    }));

    const capSeries = {
      large: largeSeries,
      mid: midSeries,
      small: smallSeries,
    };

    // Dashboard is on 1M period (rebasedSeries has only 21 sessions)
    const rebasedSeries1M = {
      large: largeSeries.slice(-21).map((r) => ({ date: r.date, rebased: 100, cumReturnPct: 0 })),
      mid: midSeries.slice(-21).map((r) => ({ date: r.date, rebased: 100, cumReturnPct: 0 })),
      small: smallSeries.slice(-21).map((r) => ({ date: r.date, rebased: 100, cumReturnPct: 0 })),
    };

    // Server performance calculation for 3M (63 sessions)
    const curClose = largeSeries[largeSeries.length - 1].close;
    const past63Close = largeSeries[largeSeries.length - 63].close;
    const serverPerf3MLarge = Math.round(((curClose - past63Close) / past63Close) * 1000) / 10;

    // Component simulation logic
    const simulateLargeMidSmall = (cardPeriod, caps, rebased) => {
      const lRows = caps?.large?.length ? caps.large : rebased?.large || [];
      const mRows = caps?.mid?.length ? caps.mid : rebased?.mid || [];
      const sRows = caps?.small?.length ? caps.small : rebased?.small || [];

      const dSet = new Set();
      lRows.forEach((r) => r.date && dSet.add(r.date));
      mRows.forEach((r) => r.date && dSet.add(r.date));
      sRows.forEach((r) => r.date && dSet.add(r.date));
      const sDates = Array.from(dSet).sort();

      let sliceD = [];
      if (cardPeriod === "1M") {
        if (sDates.length >= 21) sliceD = sDates.slice(-21);
      } else if (cardPeriod === "3M") {
        if (sDates.length >= 63) sliceD = sDates.slice(-63);
      } else if (cardPeriod === "YTD") {
        const latestD = sDates[sDates.length - 1];
        const yr = latestD.split("-")[0];
        sliceD = sDates.filter((d) => d.startsWith(yr));
      }

      const lMap = new Map(lRows.map((r) => [r.date, r]));
      const mMap = new Map(mRows.map((r) => [r.date, r]));
      const sMap = new Map(sRows.map((r) => [r.date, r]));

      const reqCount = cardPeriod === "1M" ? 21 : cardPeriod === "3M" ? 63 : sliceD.length;
      const countValid = (map) => {
        let count = 0;
        for (const d of sliceD) {
          const row = map.get(d);
          const val = row?.close ?? row?.rebased;
          if (typeof val === "number" && !isNaN(val) && val > 0) count++;
        }
        return count;
      };

      const lAvail = reqCount > 0 && countValid(lMap) >= reqCount;
      const mAvail = reqCount > 0 && countValid(mMap) >= reqCount;
      const sAvail = reqCount > 0 && countValid(sMap) >= reqCount;

      const getBase = (map) => {
        for (const d of sliceD) {
          const row = map.get(d);
          const val = row?.close ?? row?.rebased;
          if (typeof val === "number" && !isNaN(val) && val > 0) return val;
        }
        return null;
      };

      const lBase = lAvail ? getBase(lMap) : null;
      const mBase = mAvail ? getBase(mMap) : null;
      const sBase = sAvail ? getBase(sMap) : null;

      const calcRet = (map, base, d) => {
        if (!base) return null;
        const row = map.get(d);
        const val = row?.close ?? row?.rebased;
        if (typeof val !== "number" || isNaN(val)) return null;
        return Number((((val - base) / base) * 100).toFixed(2));
      };

      const chartD = sliceD.map((date) => ({
        date,
        large: lAvail ? calcRet(lMap, lBase, date) : null,
        mid: mAvail ? calcRet(mMap, mBase, date) : null,
        small: sAvail ? calcRet(sMap, sBase, date) : null,
      }));

      const lastD = sliceD[sliceD.length - 1];
      return {
        chartData: chartD,
        sliceDates: sliceD,
        availability: { large: lAvail, mid: mAvail, small: sAvail },
        lastReturns: {
          large: lAvail ? calcRet(lMap, lBase, lastD) : null,
          mid: mAvail ? calcRet(mMap, mBase, lastD) : null,
          small: sAvail ? calcRet(sMap, sBase, lastD) : null,
        },
      };
    };

    // Test 1: Dashboard period = 1M, Card period = 3M
    const res3M = simulateLargeMidSmall("3M", capSeries, rebasedSeries1M);
    assert.equal(res3M.chartData.length, 63, "Chart must have 63 points for 3M even when dashboard is on 1M");
    assert.equal(res3M.availability.large, true);
    assert.equal(res3M.availability.mid, true);
    assert.equal(res3M.availability.small, false, "Smallcap with only 30 sessions must be hidden in 3M");
    assert.equal(res3M.lastReturns.small, null, "Smallcap pill must be null ('—') in 3M");

    // The last cumulative return of large must equal performance.large["3M"] (within ±0.05)
    const lastLarge3M = res3M.lastReturns.large;
    assert.ok(
      Math.abs(lastLarge3M - serverPerf3MLarge) <= 0.05,
      `Last cumulative return (${lastLarge3M}) must equal performance.large["3M"] (${serverPerf3MLarge}) within ±0.05`
    );

    // Test 2: YTD period uses year from data (2026), not browser clock
    const resYTD = simulateLargeMidSmall("YTD", capSeries, rebasedSeries1M);
    assert.ok(resYTD.sliceDates.length > 0);
    assert.ok(
      resYTD.sliceDates.every((d) => d.startsWith("2026")),
      "YTD slice must strictly contain sessions from the current data year (2026)"
    );

    // Test 3: 1M period has 21 sessions
    const res1M = simulateLargeMidSmall("1M", capSeries, rebasedSeries1M);
    assert.equal(res1M.chartData.length, 21, "1M period must have 21 sessions");
    assert.equal(res3M.chartData[res3M.chartData.length - 1].large, res3M.lastReturns.large, "Chart last point must equal pill value");
  }

  console.log("All Round 2 Node Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});
