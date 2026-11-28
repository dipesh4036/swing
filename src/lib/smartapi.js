import crypto from "crypto";

/**
 * Constants & Configuration
 */
export const CHART_HISTORY_YEARS = 5;

export function hasAngelCredentials() {
  return Boolean(
    process.env.API_KEY &&
      process.env.CLIENT_ID &&
      process.env.PIN &&
      process.env.TOTP_SECRET
  );
}
export const MAX_DAYS_PER_REQUEST_ONE_DAY = 400; // SmartAPI ONE_DAY chunk size
const CANDLE_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours in-memory cache
const MAX_CANDLE_CACHE_TOKENS = 100; // Cap candle cache at 100 tokens
const MAX_CONCURRENT_CALLS = 2; // Max 2 concurrent SmartAPI calls per instance
const MIN_REQUEST_INTERVAL_MS = 400; // Rate <= 2.5 requests/second (1000ms / 2.5 = 400ms)
const REQUEST_TIMEOUT_MS = 8000; // 8 seconds per request

/**
 * RFC 6238 Base32 decode for TOTP secrets
 */
function base32Decode(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(Math.floor((base32.length * 5) / 8));
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i].toUpperCase());
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return Buffer.from(output.buffer, output.byteOffset, index);
}

/**
 * RFC 6238 Time-based One-Time Password generator (zero external dependencies)
 */
function generateTOTP(secret) {
  const key = base32Decode(secret.replace(/\s+/g, ""));
  const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}

/**
 * Global instance rate limiter & concurrency semaphore
 */
let activeCalls = 0;
const callQueue = [];
let lastCallTimestamp = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot() {
  while (activeCalls >= MAX_CONCURRENT_CALLS) {
    await new Promise((resolve) => callQueue.push(resolve));
  }
  activeCalls++;

  const now = Date.now();
  const elapsed = now - lastCallTimestamp;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastCallTimestamp = Date.now();
}

function releaseSlot() {
  activeCalls--;
  if (callQueue.length > 0) {
    const next = callQueue.shift();
    next();
  }
}

/**
 * Common SmartAPI Headers
 */
function getSmartApiHeaders(jwtToken = null) {
  const apiKey = process.env.API_KEY || "";
  const clientPublicIp = process.env.ANGEL_CLIENT_PUBLIC_IP || "127.0.0.1";
  const macAddress = process.env.ANGEL_MAC || "00:00:00:00:00:00";

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": clientPublicIp,
    "X-MACAddress": macAddress,
    "X-PrivateKey": apiKey,
  };

  if (jwtToken) {
    headers.Authorization = `Bearer ${jwtToken}`;
  }

  return headers;
}

/**
 * Single-flight in-memory session cache & negative backoff
 */
let sessionCache = {
  jwtToken: null,
  expiresAt: 0,
};
let loginPromise = null;
let loginFailureCount = 0;
let loginNegativeCacheUntil = 0;

export function invalidateSmartApiSession() {
  sessionCache = { jwtToken: null, expiresAt: 0 };
}

export function resetLoginFailureState() {
  loginFailureCount = 0;
  loginNegativeCacheUntil = 0;
}

export function getLoginFailureState() {
  return { loginFailureCount, loginNegativeCacheUntil };
}

/**
 * Authenticates with Angel One SmartAPI and returns a valid jwtToken
 * Concurrent requests share one in-flight login promise.
 */
export async function getSmartApiToken() {
  const apiKey = process.env.API_KEY;
  const clientId = process.env.CLIENT_ID;
  const pin = process.env.PIN;
  const totpSecret = process.env.TOTP_SECRET;

  if (!apiKey || !clientId || !pin || !totpSecret) {
    return null;
  }

  // If negative cache is active after failure, return null immediately
  if (Date.now() < loginNegativeCacheUntil) {
    return null;
  }

  // Reuse active token if valid (cache up to 12 hours)
  if (sessionCache.jwtToken && Date.now() < sessionCache.expiresAt) {
    return sessionCache.jwtToken;
  }

  // Return shared login promise if login is already in-flight
  if (loginPromise) {
    return loginPromise;
  }

  loginPromise = (async () => {
    await acquireSlot();
    try {
      const totp = generateTOTP(totpSecret);
      const headers = getSmartApiHeaders();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(
        "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientcode: clientId,
            password: pin,
            totp,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      const data = await res.json().catch(() => null);
      if (data && data.status && data.data?.jwtToken) {
        sessionCache = {
          jwtToken: data.data.jwtToken,
          expiresAt: Date.now() + 12 * 3600 * 1000,
        };
        loginFailureCount = 0;
        loginNegativeCacheUntil = 0;
        return sessionCache.jwtToken;
      }

      // Record failure & negative cache (60s, or 300s after 3 failures)
      // Never log request body or data containing credentials
      loginFailureCount++;
      const backoffSec = loginFailureCount >= 3 ? 300 : 60;
      loginNegativeCacheUntil = Date.now() + backoffSec * 1000;
      console.warn(`SmartAPI login failed (count ${loginFailureCount}). Backing off for ${backoffSec}s.`);
      return null;
    } catch {
      loginFailureCount++;
      const backoffSec = loginFailureCount >= 3 ? 300 : 60;
      loginNegativeCacheUntil = Date.now() + backoffSec * 1000;
      console.warn(`SmartAPI login error (count ${loginFailureCount}). Backing off for ${backoffSec}s.`);
      return null;
    } finally {
      releaseSlot();
      loginPromise = null;
    }
  })();

  return loginPromise;
}

/**
 * In-memory candle cache: token -> { candles, cachedAt }
 */
const candleCache = new Map();

export function clearSmartApiCandleCache() {
  candleCache.clear();
}

/**
 * Fetch a single candle chunk from SmartAPI with timeout and exponential backoff
 */
async function fetchCandleChunk(tokenStr, fromDateStr, toDateStr, allowReauth = true) {
  const jwtToken = await getSmartApiToken();
  if (!jwtToken) return null;

  const EXPIRY_CODES = new Set(["AG8001", "AG8002", "AG8003"]);
  let backoffMs = 1000;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await acquireSlot();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(
        "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
        {
          method: "POST",
          headers: getSmartApiHeaders(jwtToken),
          body: JSON.stringify({
            exchange: "NSE",
            symboltoken: tokenStr,
            interval: "ONE_DAY",
            fromdate: fromDateStr,
            todate: toDateStr,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      const json = await res.json().catch(() => null);
      if (json && json.status && Array.isArray(json.data)) {
        return json.data;
      }
      if (json && json.status && json.data === null) {
        return [];
      }

      const errCode = String(json?.errorcode || "");
      const msg = String(json?.message || "").toLowerCase();

      // 403 means blocked/unauthorised — do not retry with back-off
      if (res.status === 403) {
        console.warn(`SmartAPI getCandleData returned status=403 code=${errCode} for token=${tokenStr}`);
        return null;
      }

      // Rate limit backoff (429 / exceeding access rate only)
      if (res.status === 429 || msg.includes("exceeding access rate") || msg.includes("too many requests")) {
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 8000);
        continue;
      }

      // Session expiry handling (re-login at most once)
      const isExpired =
        EXPIRY_CODES.has(errCode) ||
        msg.includes("invalid token") ||
        msg.includes("token expired") ||
        msg.includes("session expired");

      if (isExpired && allowReauth) {
        invalidateSmartApiSession();
        return fetchCandleChunk(tokenStr, fromDateStr, toDateStr, false);
      }

      console.warn(`SmartAPI getCandleData returned status=${res.status} code=${errCode} for token=${tokenStr}`);
      return null;
    } catch {
      if (attempt === maxRetries - 1) return null;
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 8000);
    } finally {
      releaseSlot();
    }
  }

  return null;
}

/**
 * Fetch all historical candles for a token for the last 5 years in 400-day chunks.
 * Merges, de-duplicates, and sorts chronologically.
 *
 * @param {string|number} token - NSE Symbol Token.
 * @returns {Promise<Array<{date: string, open: number, high: number, low: number, close: number, volume: number}>|null>}
 */
export async function fetchAllCandlesFromSmartAPI(token) {
  const tokenStr = String(token);

  // 1. Check in-memory 3-hour cache
  const cached = candleCache.get(tokenStr);
  if (cached && Date.now() - cached.cachedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  // Check if credentials exist
  if (!process.env.API_KEY || !process.env.CLIENT_ID || !process.env.PIN || !process.env.TOTP_SECRET) {
    return null;
  }

  const now = new Date();
  const toDateTotal = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fromDateTotal = new Date(toDateTotal.getTime() - CHART_HISTORY_YEARS * 365 * 24 * 60 * 60 * 1000);

  // Split [fromDateTotal, toDateTotal] into chunks of MAX_DAYS_PER_REQUEST_ONE_DAY
  const chunkRanges = [];
  let chunkStart = new Date(fromDateTotal);

  while (chunkStart < toDateTotal) {
    const chunkEnd = new Date(
      Math.min(
        chunkStart.getTime() + MAX_DAYS_PER_REQUEST_ONE_DAY * 24 * 60 * 60 * 1000,
        toDateTotal.getTime()
      )
    );

    const fromStr = `${chunkStart.toISOString().split("T")[0]} 09:15`;
    const toStr = `${chunkEnd.toISOString().split("T")[0]} 15:30`;
    chunkRanges.push({ fromStr, toStr });

    // Next chunk starts from current chunkEnd + 1 day
    chunkStart = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  // Fetch all chunks sequentially; any failing chunk (null) aborts so caller falls back to DB
  const rawCandleRows = [];

  for (const range of chunkRanges) {
    const rows = await fetchCandleChunk(tokenStr, range.fromStr, range.toStr);
    if (rows === null) {
      return null;
    }
    if (Array.isArray(rows) && rows.length > 0) {
      rawCandleRows.push(...rows);
    }
  }

  if (rawCandleRows.length === 0) {
    return null;
  }

  // De-duplicate and parse candles
  const candleMap = new Map();
  for (const c of rawCandleRows) {
    if (!c || !c[0]) continue;
    const dateStr = String(c[0]).split("T")[0];
    candleMap.set(dateStr, {
      date: dateStr,
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
    });
  }

  const sortedCandles = Array.from(candleMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (sortedCandles.length === 0) {
    return null;
  }

  // Validate continuity: any gap > 7 calendar days aborts so caller falls back to DB
  for (let i = 1; i < sortedCandles.length; i++) {
    const prevDate = sortedCandles[i - 1].date;
    const currDate = sortedCandles[i].date;
    const diffDays = (Date.parse(currDate) - Date.parse(prevDate)) / 86400000;
    if (diffDays > 7) {
      console.warn(`SmartAPI candle gap > 7 days (${prevDate} -> ${currDate}) for token=${tokenStr}`);
      return null;
    }
  }

  // Cache in memory for 3 hours (capped at MAX_CANDLE_CACHE_TOKENS with oldest eviction)
  if (candleCache.has(tokenStr)) {
    candleCache.delete(tokenStr);
  } else if (candleCache.size >= MAX_CANDLE_CACHE_TOKENS) {
    const oldestKey = candleCache.keys().next().value;
    if (oldestKey !== undefined) {
      candleCache.delete(oldestKey);
    }
  }

  candleCache.set(tokenStr, {
    candles: sortedCandles,
    cachedAt: Date.now(),
  });

  return sortedCandles;
}
