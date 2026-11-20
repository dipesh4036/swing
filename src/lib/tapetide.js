/**
 * src/lib/tapetide.js
 *
 * Tapetide markdown parser, LRU caching, rate-limiting, and single-flight fetcher.
 * Pure functions for parsing and sanitizing third-party fundamentals data.
 */

// Whitelisted labels for snapshot
export const SNAPSHOT_WHITELIST = [
  "Market Cap",
  "P/E",
  "P/E (TTM)",
  "P/B",
  "ROE",
  "ROCE",
  "Debt to Equity",
  "Promoter Holding",
  "Dividend Yield",
  "Book Value",
  "EPS (TTM)",
  "EBITDA",
  "52W High",
  "52W Low",
  "Price",
  "Sales",
  "Revenue",
  "Net Profit",
];

/**
 * Sanitize text: strip HTML/markdown, cap length, normalize whitespace.
 */
export function sanitizeText(val, maxLen = 80) {
  if (val === null || val === undefined) return "";
  let s = String(val);
  // Strip HTML tags
  s = s.replace(/<[^>]*>/g, "");
  // Strip markdown links [text](url) -> text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Strip markdown formatting characters (*, _, `)
  s = s.replace(/[*_`#]/g, "");
  // Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen).trim();
  }
  return s;
}

/**
 * Parse numeric values from Indian financial strings.
 * Examples: "₹1,234 Cr", "12.5%", "-3.2", "-₹10.00 Cr", "+1.09 pp", "4,24,899"
 * Returns null for "Turned to profit", "NA", "—", "-", etc.
 */
export function parseNumeric(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (
    !s ||
    s === "—" ||
    s === "-" ||
    s === "NA" ||
    s === "N/A" ||
    s === "null" ||
    s === "undefined"
  ) {
    return null;
  }

  // Remove commas
  const cleaned = s.replace(/,/g, "");

  // Match optional leading +/- or sign, optional rupee symbol, and decimal number
  const match = cleaned.match(/([+-]?\s*₹?\s*[+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;

  // Normalize sign and remove rupee/spaces
  let numStr = match[1].replace(/[₹\s]/g, "");
  // If double sign like -+ or +-
  if (numStr.startsWith("+-") || numStr.startsWith("-+")) {
    numStr = "-" + numStr.slice(2);
  } else if (numStr.startsWith("++")) {
    numStr = numStr.slice(2);
  } else if (numStr.startsWith("+")) {
    numStr = numStr.slice(1);
  }

  const num = Number(numStr);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse frontmatter block from markdown text.
 */
function parseFrontmatter(text) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fmMatch) return {};
  const lines = fmMatch[1].split(/\r?\n/);
  const data = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      // Remove quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
  }
  return data;
}

/**
 * Parse Tapetide markdown into structured fundamentals object.
 * Returns null if text is invalid, garbage, HTML error, or unparseable.
 */
export function parseTapetideMarkdown(text, fallbackSymbol = "") {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Detect pure HTML error page (e.g. <html><head><title>404</title>...)
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<?xml")
  ) {
    return null;
  }

  // Must contain markdown section headers or frontmatter
  if (!trimmed.includes("##") && !trimmed.startsWith("---")) {
    return null;
  }

  const frontmatter = parseFrontmatter(trimmed);
  const symbol = (
    frontmatter.symbol ||
    frontmatter.nse_symbol ||
    fallbackSymbol
  ).trim();

  // If we can't establish a symbol or company, it's not valid tapetide markdown
  if (!symbol && !frontmatter.company) {
    const headingMatch = trimmed.match(/^#\s+([^(]+)\(([A-Z0-9&-]+)\)/m);
    if (!headingMatch && !fallbackSymbol) {
      return null;
    }
  }

  const resolvedSymbol = symbol || fallbackSymbol;
  const source_url =
    frontmatter.canonical ||
    `https://tapetide.com/stocks/${encodeURIComponent(resolvedSymbol)}`;
  const generated_at = frontmatter.generated_at
    ? sanitizeText(frontmatter.generated_at, 40)
    : null;

  // Split content by markdown headings (##)
  const sections = {};
  const rawSections = trimmed.split(/^##\s+/m);
  for (let i = 1; i < rawSections.length; i++) {
    const s = rawSections[i];
    const nlIdx = s.indexOf("\n");
    if (nlIdx !== -1) {
      const title = s.slice(0, nlIdx).trim();
      const body = s.slice(nlIdx + 1);
      sections[title] = body;
    }
  }

  // 1. Snapshot: extract key metrics from Key Fundamentals and Key Facts
  const snapshotMap = new Map();

  const parseBullets = (body) => {
    if (!body) return;
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const bMatch = line.match(/^\s*-\s+\*\*([^*:]+):\*\*\s*(.*)$/);
      if (bMatch) {
        const rawLabel = bMatch[1].trim();
        const rawVal = bMatch[2].trim();
        const cleanLabel = sanitizeText(rawLabel, 60);
        const cleanVal = sanitizeText(rawVal, 80);

        // Check against whitelist (case-insensitive)
        const lowerLabel = cleanLabel.toLowerCase();
        let matchedWl = null;
        for (const wl of SNAPSHOT_WHITELIST) {
          if (lowerLabel === wl.toLowerCase()) {
            matchedWl = wl;
            break;
          }
          // Also match "P/E" with "P/E (TTM)"
          if (wl === "P/E" && lowerLabel.startsWith("p/e")) {
            matchedWl = cleanLabel.includes("TTM") ? "P/E (TTM)" : "P/E";
            break;
          }
          // Match "EPS" with "EPS (TTM)"
          if (wl === "EPS (TTM)" && lowerLabel.startsWith("eps")) {
            matchedWl = cleanLabel.includes("TTM") ? "EPS (TTM)" : "EPS";
            break;
          }
        }

        if (matchedWl && !snapshotMap.has(matchedWl)) {
          snapshotMap.set(matchedWl, {
            label: matchedWl,
            value_text: cleanVal,
            value_num: parseNumeric(cleanVal),
          });
        }
      }
    }
  };

  parseBullets(sections["Key Fundamentals"]);
  parseBullets(sections["Key Facts"]);

  const snapshot = Array.from(snapshotMap.values());

  // 2. Growth: parse table under ## Growth Rate
  const growth = [];
  const growthBody = sections["Growth Rate"];
  if (growthBody) {
    const lines = growthBody.split(/\r?\n/);
    for (const line of lines) {
      if (!line.startsWith("|") || line.includes("---") || line.toLowerCase().includes("metric")) {
        continue;
      }
      const parts = line.split("|").map((p) => p.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (parts.length >= 3) {
        const label = sanitizeText(parts[0], 60);
        const period = sanitizeText(parts[1], 20);
        const valText = sanitizeText(parts[2], 80);
        if (label && period) {
          growth.push({
            label,
            period,
            value_num: parseNumeric(valText),
            value_text: valText,
          });
        }
      }
    }
  }

  // 3. Quarters: parse table under Financial Statements -> Quarterly Results
  const quarters = [];
  const finBody = sections["Financial Statements"] || trimmed;
  const qResultsMatch = finBody.match(/###\s+Quarterly Results[\s\S]*?(?=###\s+|^##\s+|$)/i);
  if (qResultsMatch) {
    const qLines = qResultsMatch[0].split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
    if (qLines.length >= 2) {
      // Line 0 is header: | Item | Sep 2025 | Jun 2026 | Sep 2026 |
      const headerCols = qLines[0]
        .split("|")
        .map((c) => sanitizeText(c, 30))
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      // Period names start at column index 1
      const periods = headerCols.slice(1);

      const rowMap = {};
      for (let i = 1; i < qLines.length; i++) {
        const line = qLines[i];
        if (line.includes("---")) continue;
        const cols = line
          .split("|")
          .map((c) => sanitizeText(c, 50))
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cols.length > 0) {
          const itemKey = cols[0].toLowerCase();
          rowMap[itemKey] = cols.slice(1);
        }
      }

      // Find relevant rows
      const findRow = (keywords) => {
        for (const [k, v] of Object.entries(rowMap)) {
          if (keywords.some((kw) => k.includes(kw))) {
            return v;
          }
        }
        return [];
      };

      const salesRow = findRow(["sales", "revenue"]);
      const npRow = findRow(["net profit"]);
      const opmRow = findRow(["opm"]);
      const epsRow = findRow(["eps"]);

      for (let pIdx = 0; pIdx < periods.length; pIdx++) {
        const period = periods[pIdx];
        if (!period) continue;
        quarters.push({
          period,
          sales: parseNumeric(salesRow[pIdx]),
          net_profit: parseNumeric(npRow[pIdx]),
          opm: parseNumeric(opmRow[pIdx]),
          eps: parseNumeric(epsRow[pIdx]),
        });
      }
    }
  }

  // Cap to up to 8 quarters (oldest -> newest)
  const cappedQuarters = quarters.length > 8 ? quarters.slice(-8) : quarters;

  // 4. Shareholding: parse Quarterly Shareholding
  let shareholding = null;
  const shPatternMatch = (sections["Shareholding Pattern"] || trimmed).match(
    /###\s+Quarterly Shareholding[\s\S]*?(?=###\s+|^##\s+|$)/i
  );
  if (shPatternMatch) {
    const shLines = shPatternMatch[0].split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
    if (shLines.length >= 2) {
      const headerCols = shLines[0]
        .split("|")
        .map((c) => sanitizeText(c, 30))
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      const periods = headerCols.slice(1);
      const shRowMap = {};
      for (let i = 1; i < shLines.length; i++) {
        const line = shLines[i];
        if (line.includes("---")) continue;
        const cols = line
          .split("|")
          .map((c) => sanitizeText(c, 50))
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cols.length > 0) {
          shRowMap[cols[0].toLowerCase()] = cols.slice(1);
        }
      }

      const getVal = (keywords, idx) => {
        for (const [k, v] of Object.entries(shRowMap)) {
          if (keywords.some((kw) => k.includes(kw))) {
            return parseNumeric(v[idx]);
          }
        }
        return null;
      };

      if (periods.length >= 1) {
        const lastIdx = periods.length - 1;
        const latest = {
          period: periods[lastIdx],
          promoters: getVal(["promoter"], lastIdx),
          fii: getVal(["fii"], lastIdx),
          dii: getVal(["dii"], lastIdx),
          public: getVal(["public"], lastIdx),
        };

        let previous = null;
        if (periods.length >= 2) {
          const prevIdx = lastIdx - 1;
          previous = {
            period: periods[prevIdx],
            promoters: getVal(["promoter"], prevIdx),
            fii: getVal(["fii"], prevIdx),
            dii: getVal(["dii"], prevIdx),
            public: getVal(["public"], prevIdx),
          };
        }

        shareholding = { latest, previous };
      }
    }
  }

  // 5. Strengths and Weaknesses: under Key Insights
  const strengths = [];
  const weaknesses = [];
  const insightsBody = sections["Key Insights"] || trimmed;

  const strengthsMatch = insightsBody.match(/###\s+Strengths[\s\S]*?(?=###\s+|^##\s+|$)/i);
  if (strengthsMatch) {
    const sLines = strengthsMatch[0].split(/\r?\n/);
    for (const line of sLines) {
      const b = line.match(/^\s*-\s+(.*)$/);
      if (b && strengths.length < 8) {
        const clean = sanitizeText(b[1], 200);
        if (clean) strengths.push(clean);
      }
    }
  }

  const weaknessesMatch = insightsBody.match(/###\s+Weaknesses[\s\S]*?(?=###\s+|^##\s+|$)/i);
  if (weaknessesMatch) {
    const wLines = weaknessesMatch[0].split(/\r?\n/);
    for (const line of wLines) {
      const b = line.match(/^\s*-\s+(.*)$/);
      if (b && weaknesses.length < 8) {
        const clean = sanitizeText(b[1], 200);
        if (clean) weaknesses.push(clean);
      }
    }
  }

  // 6. Signals: under ## Technical Indicators
  let signals = null;
  const techBody = sections["Technical Indicators"];
  if (techBody) {
    const tLines = techBody.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
    if (tLines.length >= 2) {
      const sigMap = {};
      for (const line of tLines) {
        if (line.includes("---") || line.toLowerCase().includes("group")) continue;
        const cols = line
          .split("|")
          .map((c) => sanitizeText(c, 30))
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cols.length >= 5) {
          const group = cols[0];
          const signal = cols[1];
          const bearish = parseNumeric(cols[2]) ?? 0;
          const neutral = parseNumeric(cols[3]) ?? 0;
          const bullish = parseNumeric(cols[4]) ?? 0;
          if (group.toLowerCase() === "overall") {
            sigMap.overall = signal;
            sigMap.bearish = bearish;
            sigMap.neutral = neutral;
            sigMap.bullish = bullish;
          } else if (group.toLowerCase().includes("oscillator")) {
            sigMap.oscillators = signal;
          } else if (group.toLowerCase().includes("moving average")) {
            sigMap.moving_averages = signal;
          }
        }
      }
      if (Object.keys(sigMap).length > 0) {
        signals = sigMap;
      }
    }
  }

  return {
    available: true,
    symbol: resolvedSymbol,
    source_url,
    generated_at,
    snapshot,
    growth,
    quarters: cappedQuarters,
    shareholding,
    strengths,
    weaknesses,
    signals,
  };
}

/**
 * LRU In-Memory Cache with TTL support.
 */
export class TapetideLRUCache {
  constructor(maxSize = 200) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    // Refresh LRU
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key, data, ttlMs, isNegative = false) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
      isNegative,
    });
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

/**
 * Global rate limiter: up to N requests per windowMs.
 */
export class TapetideRateLimiter {
  constructor(maxRequests = 20, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  canFetch() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((ts) => now - ts < this.windowMs);
    return this.timestamps.length < this.maxRequests;
  }

  recordFetch() {
    this.timestamps.push(Date.now());
  }

  reset() {
    this.timestamps = [];
  }
}

// Global singletons for server runtime
export const globalTapetideCache = new TapetideLRUCache(200);
export const globalTapetideLimiter = new TapetideRateLimiter(20, 60000);
export const globalInFlightFetches = new Map();

const TTL_SUCCESS_MS = 24 * 60 * 60 * 1000; // 24 hours
const TTL_NEGATIVE_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB
const FETCH_TIMEOUT_MS = 8000; // 8 seconds

/**
 * Fetch and parse Tapetide fundamentals with LRU caching, single-flight, rate-limiting,
 * timeout, and stream size guard.
 */
export async function getTapetideFundamentals(
  symbol,
  options = {}
) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  const source_url = `https://tapetide.com/stocks/${encodeURIComponent(cleanSymbol)}`;

  const cache = options.cache || globalTapetideCache;
  const limiter = options.limiter || globalTapetideLimiter;
  const inFlight = options.inFlight || globalInFlightFetches;
  const fetchFn = options.fetchFn || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;

  // 1. Check in-memory cache
  const cached = cache.get(cleanSymbol);
  if (cached) {
    return cached.data;
  }

  // 2. Single-flight per symbol: concurrent requests share the same promise
  if (inFlight.has(cleanSymbol)) {
    return inFlight.get(cleanSymbol);
  }

  // 3. Rate-limiting check: ~20 upstream fetches/min/instance
  if (!limiter.canFetch()) {
    const rateLimitedRes = {
      available: false,
      reason: "rate_limited",
      source_url,
    };
    return rateLimitedRes;
  }

  const fetchPromise = (async () => {
    limiter.recordFetch();

    const controller = new AbortController();
    let isTimeout = false;
    const timeoutId = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
      const upstreamUrl = `https://tapetide.com/stocks/${encodeURIComponent(cleanSymbol)}.md`;
      const response = await fetchFn(upstreamUrl, {
        signal: controller.signal,
        headers: {
          Accept: "text/markdown",
          "User-Agent": "swing-dashboard/1.0 (personal use)",
        },
        redirect: "manual",
      });

      clearTimeout(timeoutId);

      // Check redirects: manual redirect causes opaqueredirect or 3xx status
      if (
        response.status >= 300 &&
        response.status < 400
      ) {
        const failureData = { available: false, reason: "upstream_error", source_url };
        cache.set(cleanSymbol, failureData, TTL_NEGATIVE_MS, true);
        return failureData;
      }

      if (response.status === 404) {
        const notFoundData = { available: false, reason: "not_found", source_url };
        cache.set(cleanSymbol, notFoundData, TTL_NEGATIVE_MS, true);
        return notFoundData;
      }

      if (!response.ok) {
        const errorData = { available: false, reason: "upstream_error", source_url };
        cache.set(cleanSymbol, errorData, TTL_NEGATIVE_MS, true);
        return errorData;
      }

      // Read response stream up to maxBytes (1 MB)
      let text = "";
      if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let totalBytes = 0;
        let exceeded = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > maxBytes) {
            exceeded = true;
            controller.abort();
            break;
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();

        if (exceeded) {
          const sizeExceededData = { available: false, reason: "upstream_error", source_url };
          cache.set(cleanSymbol, sizeExceededData, TTL_NEGATIVE_MS, true);
          return sizeExceededData;
        }
      } else {
        // Fallback for mocked or simple fetch
        text = await response.text();
        if (text.length > maxBytes) {
          const sizeExceededData = { available: false, reason: "upstream_error", source_url };
          cache.set(cleanSymbol, sizeExceededData, TTL_NEGATIVE_MS, true);
          return sizeExceededData;
        }
      }

      const parsed = parseTapetideMarkdown(text, cleanSymbol);
      if (!parsed) {
        const parseErrData = { available: false, reason: "parse_error", source_url };
        cache.set(cleanSymbol, parseErrData, TTL_NEGATIVE_MS, true);
        return parseErrData;
      }

      // Success: cache for 24 hours
      cache.set(cleanSymbol, parsed, TTL_SUCCESS_MS, false);
      return parsed;
    } catch (err) {
      clearTimeout(timeoutId);
      let reason = "upstream_error";
      if (isTimeout || err.name === "AbortError") {
        reason = isTimeout ? "timeout" : "upstream_error";
      }
      const errData = { available: false, reason, source_url };
      cache.set(cleanSymbol, errData, TTL_NEGATIVE_MS, true);
      return errData;
    } finally {
      inFlight.delete(cleanSymbol);
    }
  })();

  inFlight.set(cleanSymbol, fetchPromise);
  return fetchPromise;
}
