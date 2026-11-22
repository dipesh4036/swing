/**
 * src/lib/sector-math.js
 * Pure mathematical functions for Sector Rotation analytics:
 * - Canonical SECTORS taxonomy (mirrored from Python pipeline/sectors.py)
 * - Session-based percentage returns (5, 22, 64, 126 sessions)
 * - Relative Strength (RS) vs benchmark
 * - Simplified RS trend quadrant (x: RS vs 50 SMA %, y: 10-session RS momentum %)
 * - Rebased RS series for charts
 * - Sector Leader rules & evaluator
 */

export const SECTORS = [
  {
    key: "bank",
    label: "Bank",
    short: "Bank",
    index_name: "NIFTY BANK",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "financial_services",
    label: "Financial Services (ex-Bank)",
    short: "FinSvc",
    index_name: "NIFTY FINANCIAL SERVICES",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "it",
    label: "IT",
    short: "IT",
    index_name: "NIFTY IT",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "healthcare",
    label: "Healthcare (Pharma + Hospitals)",
    short: "Health",
    index_name: "NIFTY HEALTHCARE (EW)",
    group_type: "index",
    price_source: "equal_weight",
  },
  {
    key: "auto",
    label: "Auto",
    short: "Auto",
    index_name: "NIFTY AUTO",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "consumer_durables",
    label: "Consumer Durables",
    short: "ConsDur",
    index_name: "NIFTY CONSUMER DURABLES (EW)",
    group_type: "index",
    price_source: "equal_weight",
  },
  {
    key: "fmcg",
    label: "FMCG",
    short: "FMCG",
    index_name: "NIFTY FMCG",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "metal",
    label: "Metal",
    short: "Metal",
    index_name: "NIFTY METAL",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "oil_gas",
    label: "Oil & Gas",
    short: "Oil&Gas",
    index_name: "NIFTY OIL & GAS (EW)",
    group_type: "index",
    price_source: "equal_weight",
  },
  {
    key: "realty",
    label: "Realty",
    short: "Realty",
    index_name: "NIFTY REALTY",
    group_type: "index",
    price_source: "official",
  },
  {
    key: "media",
    label: "Media",
    short: "Media",
    index_name: "NIFTY MEDIA",
    group_type: "index",
    price_source: "official",
  },
  // Industry-based groups covering remaining Nifty 500 stocks (group_type='industry')
  {
    key: "capital_goods",
    label: "Capital Goods",
    short: "CapGoods",
    index_name: "NIFTY CAPITAL GOODS (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "chemicals",
    label: "Chemicals",
    short: "Chem",
    index_name: "NIFTY CHEMICALS (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "power",
    label: "Power",
    short: "Power",
    index_name: "NIFTY POWER (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "telecom",
    label: "Telecommunication",
    short: "Telecom",
    index_name: "NIFTY TELECOM (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "consumer_services",
    label: "Consumer Services",
    short: "ConsSvc",
    index_name: "NIFTY CONS SERVICES (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "services",
    label: "Services",
    short: "Services",
    index_name: "NIFTY SERVICES (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "construction",
    label: "Construction",
    short: "Constr",
    index_name: "NIFTY CONSTRUCTION (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "construction_materials",
    label: "Construction Materials",
    short: "ConstMat",
    index_name: "NIFTY CONST MAT (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "textiles",
    label: "Textiles",
    short: "Textiles",
    index_name: "NIFTY TEXTILES (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
  {
    key: "diversified",
    label: "Diversified",
    short: "Divers",
    index_name: "NIFTY DIVERSIFIED (EW)",
    group_type: "industry",
    price_source: "equal_weight",
  },
];

export const SECTOR_KEYS = SECTORS.map((s) => s.key);
export const SECTORS_BY_KEY = Object.fromEntries(SECTORS.map((s) => [s.key, s]));

export const SECTOR_LEADER_RULES = {
  above_50dma: true,
  above_200dma: true,
  pct_from_52w_high_min: -15.0,
  min_rs_rank: 70,
};

export function isSectorLeader(stock, rules = SECTOR_LEADER_RULES) {
  if (!stock) return false;
  if (rules.above_50dma && stock.above_50dma !== true) return false;
  if (rules.above_200dma && stock.above_200dma !== true) return false;
  if (
    stock.pct_from_52w_high == null ||
    stock.pct_from_52w_high < rules.pct_from_52w_high_min
  ) {
    return false;
  }
  if (stock.rs_rank == null || stock.rs_rank < rules.min_rs_rank) {
    return false;
  }
  return true;
}

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
  const currentRS = alignedRS[n - 1].rs;
  const tenSessionsAgoRS = alignedRS[n - 11].rs;

  // 50-session SMA of RS
  let sum50 = 0;
  for (let i = n - 50; i < n; i++) {
    sum50 += alignedRS[i].rs;
  }
  const sma50 = sum50 / 50.0;

  if (sma50 === 0 || tenSessionsAgoRS === 0) {
    return { quadrant: null, x: null, y: null };
  }

  const x = Number((((currentRS / sma50) - 1.0) * 100.0).toFixed(2));
  const y = Number((((currentRS / tenSessionsAgoRS) - 1.0) * 100.0).toFixed(2));

  let quadrant = "Lagging";
  if (x > 0 && y > 0) {
    quadrant = "Leading";
  } else if (x > 0 && y <= 0) {
    quadrant = "Weakening";
  } else if (x <= 0 && y > 0) {
    quadrant = "Improving";
  } else {
    quadrant = "Lagging";
  }

  return { quadrant, x, y };
}

/**
 * Rebased RS series rebased to 100.0 on the first session of the window.
 * @param {Array<{trade_date: string, rs: number}>} alignedRS
 * @param {number} sessions
 * @returns {Array<{date: string, value: number}>}
 */
export function computeRSSeries(alignedRS, sessions = 120) {
  if (!alignedRS || alignedRS.length === 0) return [];
  const windowSlice = alignedRS.slice(-sessions);
  if (windowSlice.length === 0) return [];

  const baseRS = windowSlice[0].rs;
  if (baseRS === 0 || baseRS == null) return [];

  return windowSlice.map((item) => ({
    date: item.trade_date,
    value: Number(((item.rs / baseRS) * 100.0).toFixed(2)),
  }));
}
