import crypto from "crypto";

/**
 * Base32 decode for TOTP secrets
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

// In-memory session cache for Angel One SmartAPI JWT
let sessionCache = {
  jwtToken: null,
  expiresAt: 0,
};

// In-memory candle cache: token -> { candles, cachedAt }
const candleCache = new Map();
const CANDLE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache

/**
 * Authenticates with Angel One SmartAPI and returns a valid jwtToken
 */
async function getSmartApiToken() {
  const apiKey = process.env.API_KEY;
  const clientId = process.env.CLIENT_ID;
  const pin = process.env.PIN;
  const totpSecret = process.env.TOTP_SECRET;

  if (!apiKey || !clientId || !pin || !totpSecret) {
    return null;
  }

  // Reuse active token if still valid (valid for 12 hours)
  if (sessionCache.jwtToken && Date.now() < sessionCache.expiresAt) {
    return sessionCache.jwtToken;
  }

  try {
    const totp = generateTOTP(totpSecret);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "106.193.147.98",
      "X-MACAddress": "fe80::216:3eff:fe12:3456",
      "X-PrivateKey": apiKey,
    };

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
      }
    );

    const data = await res.json();
    if (data && data.status && data.data?.jwtToken) {
      sessionCache = {
        jwtToken: data.data.jwtToken,
        expiresAt: Date.now() + 12 * 3600 * 1000, // 12 hours validity
      };
      return sessionCache.jwtToken;
    }
    console.warn("SmartAPI login response:", data?.message || "Unknown error");
    return null;
  } catch (err) {
    console.error("SmartAPI login error:", err.message);
    return null;
  }
}

/**
 * Fetch all historical candles for a token from Angel One SmartAPI with caching.
 * Returns array of { date, open, high, low, close, volume } or null on failure.
 */
export async function fetchAllCandlesFromSmartAPI(token) {
  const tokenStr = String(token);

  // 1. Check in-memory cache
  const cached = candleCache.get(tokenStr);
  if (cached && Date.now() - cached.cachedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  // 2. Obtain SmartAPI JWT token
  const jwtToken = await getSmartApiToken();
  if (!jwtToken) {
    return null;
  }

  const apiKey = process.env.API_KEY;
  const now = new Date();
  const toDateStr = `${now.toISOString().split("T")[0]} 15:30`;

  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "106.193.147.98",
      "X-MACAddress": "fe80::216:3eff:fe12:3456",
      "X-PrivateKey": apiKey,
      Authorization: `Bearer ${jwtToken}`,
    };

    // Request all historical data from 2010 to current date
    const res = await fetch(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          exchange: "NSE",
          symboltoken: tokenStr,
          interval: "ONE_DAY",
          fromdate: "2010-01-01 09:15",
          todate: toDateStr,
        }),
      }
    );

    const json = await res.json();
    if (json && json.status && Array.isArray(json.data) && json.data.length > 0) {
      const candles = json.data.map((c) => ({
        date: c[0].split("T")[0],
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5]),
      }));

      // Cache the candles
      candleCache.set(tokenStr, {
        candles,
        cachedAt: Date.now(),
      });

      return candles;
    }

    console.warn(`SmartAPI returned no candle data for token ${tokenStr}:`, json?.message);
    return null;
  } catch (err) {
    console.error(`SmartAPI getCandleData error for token ${tokenStr}:`, err.message);
    return null;
  }
}

