/**
 * src/lib/sector-math.js
 * Pure mathematical functions for Sector Rotation analytics:
 * - Session-based percentage returns (5, 22, 64, 126 sessions)
 * - Relative Strength (RS) vs benchmark
 * - Simplified RRG RS trend quadrant (x: RS vs 50 SMA %, y: 10-session RS momentum %)
 * - Rebased RS series for charts
 */

export const SECTORS = [
  { key: "bank", label: "Bank", index_name: "NIFTY BANK" },
  { key: "financial_services", label: "Financial Services (ex-Bank)", index_name: "NIFTY FINANCIAL SERVICES" },
  { key: "it", label: "IT", index_name: "NIFTY IT" },
  { key: "pharma", label: "Pharma", index_name: "NIFTY PHARMA" },
  { key: "healthcare", label: "Healthcare", index_name: "NIFTY HEALTHCARE" },
  { key: "auto", label: "Auto", index_name: "NIFTY AUTO" },
  { key: "consumer_durables", label: "Consumer Durables", index_name: "NIFTY CONSUMER DURABLES" },
  { key: "fmcg", label: "FMCG", index_name: "NIFTY FMCG" },
  { key: "metal", label: "Metal", index_name: "NIFTY METAL" },
  { key: "oil_gas", label: "Oil & Gas", index_name: "NIFTY OIL & GAS" },
  { key: "realty", label: "Realty", index_name: "NIFTY REALTY" },
  { key: "media", label: "Media", index_name: "NIFTY MEDIA" },
];

export const SECTOR_KEYS = SECTORS.map((s) => s.key);

/**
 * Computes return over specified session count.
 * @param {Array<{trade_date: string, close: number}>} candles - sorted oldest to newest
 * @param {number} sessions
 * @returns {number|null} percentage return rounded to 2 decimal places, or null
 */
export function computeSessionReturn(candles, sessions) {
  if (!candles || candles.length <= sessions) {
    return null;
  }
  const latest = candles[candles.length - 1];
  const prior = candles[candles.length - 1 - sessions];
  if (!latest || !prior || prior.close === 0 || prior.close == null || latest.close == null) {
    return null;
  }
  const ret = ((latest.close - prior.close) / prior.close) * 100.0;
  return Number(ret.toFixed(2));
}

/**
 * Computes returns over standard windows: 1W (5), 1M (22), 3M (64), 6M (126).
 */
export function computeStandardReturns(candles) {
  return {
    ret_1w: computeSessionReturn(candles, 5),
    ret_1m: computeSessionReturn(candles, 22),
    ret_3m: computeSessionReturn(candles, 64),
    ret_6m: computeSessionReturn(candles, 126),
  };
}

/**
 * Aligns sector closes and benchmark closes by common trade dates in chronological order.
 * @returns {Array<{trade_date: string, rs: number}>}
 */
export function computeAlignedRS(sectorCandles, benchmarkCandles) {
  if (!sectorCandles || !benchmarkCandles) return [];

  const benchMap = new Map();
  for (const b of benchmarkCandles) {
    if (b.trade_date && b.close != null && b.close > 0) {
      benchMap.set(b.trade_date, Number(b.close));
    }
  }

  const aligned = [];
  for (const s of sectorCandles) {
    if (s.trade_date && s.close != null && benchMap.has(s.trade_date)) {
      const bClose = benchMap.get(s.trade_date);
      const sClose = Number(s.close);
      aligned.push({
        trade_date: s.trade_date,
        rs: sClose / bClose,
      });
    }
  }

  aligned.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return aligned;
}

/**
 * Computes simplified RS Trend Quadrant per spec:
 * RS = sector_close / NIFTY500_close (aligned on common trade dates only).
 * x = (RS / SMA(RS, 50) - 1) * 100
 * y = (RS / RS[10 sessions ago] - 1) * 100
 * Quadrant:
 * - Leading: x > 0, y > 0
 * - Weakening: x > 0, y <= 0
 * - Lagging: x <= 0, y <= 0
 * - Improving: x <= 0, y > 0
 * Requires >= 60 aligned sessions, else null.
 */
export function computeQuadrant(alignedRS) {
  if (!alignedRS || alignedRS.length < 60) {
    return { quadrant: null, x: null, y: null };
  }

  const n = alignedRS.length;
  const latestRS = alignedRS[n - 1].rs;

  // 50-session SMA of RS
  let sum50 = 0;
  for (let i = n - 50; i < n; i++) {
    sum50 += alignedRS[i].rs;
  }
  const sma50 = sum50 / 50.0;
  if (sma50 <= 0) {
    return { quadrant: null, x: null, y: null };
  }

  const prior10RS = alignedRS[n - 1 - 10].rs;
  if (prior10RS <= 0) {
    return { quadrant: null, x: null, y: null };
  }

  const x = ((latestRS / sma50) - 1.0) * 100.0;
  const y = ((latestRS / prior10RS) - 1.0) * 100.0;

  let quadrant = "lagging";
  if (x > 0 && y > 0) {
    quadrant = "leading";
  } else if (x > 0 && y <= 0) {
    quadrant = "weakening";
  } else if (x <= 0 && y <= 0) {
    quadrant = "lagging";
  } else if (x <= 0 && y > 0) {
    quadrant = "improving";
  }

  return {
    quadrant,
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
  };
}

/**
 * Returns last N sessions of RS series rebased to 100.0 at the window start.
 * @param {Array<{trade_date: string, rs: number}>} alignedRS
 * @param {number} window - default 120
 */
export function computeRSSeries(alignedRS, window = 120) {
  if (!alignedRS || alignedRS.length === 0) return [];
  const slice = alignedRS.slice(-window);
  const baseRS = slice[0].rs;
  if (!baseRS || baseRS <= 0) return [];

  return slice.map((item) => ({
    time: item.trade_date,
    value: Number(((item.rs / baseRS) * 100.0).toFixed(2)),
  }));
}
