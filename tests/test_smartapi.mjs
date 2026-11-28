import assert from "node:assert/strict";
import {
  fetchAllCandlesFromSmartAPI,
  clearSmartApiCandleCache,
  invalidateSmartApiSession,
  resetLoginFailureState,
} from "../src/lib/smartapi.js";

// Dummy test credentials (never real secrets)
process.env.API_KEY = "dummy_key";
process.env.CLIENT_ID = "dummy_client";
process.env.PIN = "0000";
process.env.TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function makeResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function resetAll() {
  clearSmartApiCandleCache();
  invalidateSmartApiSession();
  resetLoginFailureState();
}

const origFetch = globalThis.fetch;

try {
  // 1. One failing chunk -> returns null
  {
    resetAll();
    let chunkCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("loginByPassword")) {
        return makeResponse(200, { status: true, data: { jwtToken: "fake-jwt" } });
      }
      chunkCalls++;
      if (chunkCalls === 2) {
        return makeResponse(500, { status: false, errorcode: "AB1004", message: "error" });
      }
      return makeResponse(200, {
        status: true,
        data: [["2026-11-24T00:00:00+05:30", 100, 102, 99, 101, 1000]],
      });
    };
    const res = await fetchAllCandlesFromSmartAPI(999001);
    assert.equal(res, null, "One failing chunk must abort and return null");
  }

  // 2. data:null chunk -> treated as empty and rest kept
  {
    resetAll();
    let chunkCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("loginByPassword")) {
        return makeResponse(200, { status: true, data: { jwtToken: "fake-jwt" } });
      }
      chunkCalls++;
      if (chunkCalls === 1) {
        return makeResponse(200, { status: true, data: null });
      }
      if (chunkCalls === 2) {
        return makeResponse(200, {
          status: true,
          data: [
            ["2026-11-24T00:00:00+05:30", 100, 102, 99, 101, 1000],
            ["2026-11-25T00:00:00+05:30", 101, 103, 100, 102, 1100],
          ],
        });
      }
      return makeResponse(200, { status: true, data: [] });
    };
    const res = await fetchAllCandlesFromSmartAPI(999002);
    assert.ok(Array.isArray(res) && res.length === 2, "data:null chunk should be treated as empty and rest kept");
  }

  // 3. 403 -> exactly one request (no retry/backoff)
  {
    resetAll();
    let candleCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("loginByPassword")) {
        return makeResponse(200, { status: true, data: { jwtToken: "fake-jwt" } });
      }
      candleCalls++;
      return makeResponse(403, { status: false, errorcode: "FORBIDDEN", message: "forbidden" });
    };
    const res = await fetchAllCandlesFromSmartAPI(999003);
    assert.equal(res, null);
    assert.equal(candleCalls, 1, "403 must not be retried with backoff");
  }

  // 4. Gap > 7 calendar days -> returns null
  {
    resetAll();
    let chunkCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("loginByPassword")) {
        return makeResponse(200, { status: true, data: { jwtToken: "fake-jwt" } });
      }
      chunkCalls++;
      if (chunkCalls === 1) {
        return makeResponse(200, {
          status: true,
          data: [
            ["2026-11-01T00:00:00+05:30", 100, 102, 99, 101, 1000],
            ["2026-11-12T00:00:00+05:30", 102, 104, 101, 103, 1200], // 11-day gap
          ],
        });
      }
      return makeResponse(200, { status: true, data: [] });
    };
    const res = await fetchAllCandlesFromSmartAPI(999004);
    assert.equal(res, null, "Gap > 7 calendar days must return null");
  }

  // 5. Duplicate rows removed and sorted ascending
  {
    resetAll();
    let chunkCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("loginByPassword")) {
        return makeResponse(200, { status: true, data: { jwtToken: "fake-jwt" } });
      }
      chunkCalls++;
      if (chunkCalls === 1) {
        return makeResponse(200, {
          status: true,
          data: [
            ["2026-11-26T00:00:00+05:30", 102, 104, 101, 103, 1200],
            ["2026-11-24T00:00:00+05:30", 100, 102, 99, 101, 1000],
            ["2026-11-24T09:15:00+05:30", 100, 102, 99, 101.5, 1050], // duplicate date
          ],
        });
      }
      return makeResponse(200, { status: true, data: [] });
    };
    const res = await fetchAllCandlesFromSmartAPI(999005);
    assert.ok(Array.isArray(res) && res.length === 2, "Duplicate date rows must be deduplicated");
    assert.deepEqual(
      res.map((r) => r.date),
      ["2026-11-24", "2026-11-26"]
    );
  }

  console.log("✓ SmartAPI candle integrity & 403/gap tests passed!");
} finally {
  globalThis.fetch = origFetch;
}
