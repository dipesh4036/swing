/**
 * src/lib/indicators.js
 *
 * Core technical indicator helpers shared across server routes and client chart components.
 * Standardizes SMA-seeded Exponential Moving Average (EMA) and weekly candle aggregation.
 */

/**
 * Computes a single SMA-seeded Exponential Moving Average (EMA) for an array of candles.
 * 
 * Seed: Simple Moving Average (SMA) of the first `period` sessions.
 * Multiplier: k = 2 / (period + 1)
 * Subsequent: EMA_t = (Close_t - EMA_{t-1}) * k + EMA_{t-1}
 *
 * @param {Array<{close: number}>} candles - Chronologically sorted candles.
 * @param {number} period - EMA period length (e.g. 10, 20, 50, 200).
 * @returns {Array<number|null>} Array of EMA values matching candle array indices.
 */
export function computeEMA(candles, period) {
  if (!Array.isArray(candles) || candles.length === 0 || period <= 0) {
    return [];
  }

  const result = new Array(candles.length).fill(null);
  if (candles.length < period) {
    return result;
  }

  // 1. Initial SMA seed over first `period` items
  let sum = 0;
  for (let i = 0; i < period; i++) {
    const val = Number(candles[i]?.close);
    if (isNaN(val)) return result;
    sum += val;
  }
  let prevEma = sum / period;
  result[period - 1] = Math.round(prevEma * 100) / 100;

  // 2. Exponential accumulation for remaining items
  const k = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    const close = Number(candles[i]?.close);
    if (isNaN(close)) {
      result[i] = null;
      continue;
    }
    prevEma = (close - prevEma) * k + prevEma;
    result[i] = Math.round(prevEma * 100) / 100;
  }

  return result;
}

/**
 * Attaches standard EMAs (default: 10, 20, 50, 200) to an array of chronological candles.
 *
 * @param {Array<Object>} candles - Chronologically sorted candles.
 * @param {Array<number>} periods - Array of EMA periods (default [10, 20, 50, 200]).
 * @returns {Array<Object>} New array of candles with `ema_${period}` properties attached.
 */
export function attachEMAs(candles, periods = [10, 20, 50, 200]) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const emaSeries = {};
  for (const p of periods) {
    emaSeries[p] = computeEMA(candles, p);
  }

  return candles.map((c, i) => {
    const copy = { ...c };
    for (const p of periods) {
      copy[`ema_${p}`] = emaSeries[p][i];
    }
    return copy;
  });
}

/**
 * Aggregates chronological daily candles into weekly candles (Monday-start).
 *
 * @param {Array<{date: string, open: number, high: number, low: number, close: number, volume: number}>} dailyCandles
 * @returns {Array<Object>} Weekly candles.
 */
export function aggregateWeekly(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length === 0) {
    return [];
  }

  const weeks = [];
  let currWeek = null;

  for (const c of dailyCandles) {
    const d = new Date(c.date);
    const day = d.getUTCDay();
    // Monday of the candle's week
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
    const weekKey = monday.toISOString().split("T")[0];

    const cHigh = c.high !== null && c.high !== undefined && !isNaN(c.high) ? Number(c.high) : Number(c.close);
    const cLow = c.low !== null && c.low !== undefined && !isNaN(c.low) ? Number(c.low) : Number(c.close);
    const cOpen = c.open !== null && c.open !== undefined && !isNaN(c.open) ? Number(c.open) : Number(c.close);
    const cClose = Number(c.close);
    const cVol = c.volume !== null && c.volume !== undefined && !isNaN(c.volume) ? Number(c.volume) : 0;

    if (!currWeek || currWeek.weekKey !== weekKey) {
      if (currWeek) {
        weeks.push(currWeek);
      }
      currWeek = {
        weekKey,
        date: c.date,
        open: cOpen,
        high: cHigh,
        low: cLow,
        close: cClose,
        volume: cVol,
      };
    } else {
      currWeek.date = c.date; // Ending session of the week
      currWeek.high = Math.max(currWeek.high, cHigh);
      currWeek.low = Math.min(currWeek.low, cLow);
      currWeek.close = cClose;
      currWeek.volume += cVol;
    }
  }

  if (currWeek) {
    weeks.push(currWeek);
  }

  return weeks;
}

/**
 * Slices an array of candles to the last `n` items.
 *
 * @param {Array<Object>} candles - Array of chronological candles.
 * @param {number} n - Maximum number of trailing candles to return.
 * @returns {Array<Object>} Sliced array of candles.
 */
export function sliceLast(candles, n) {
  if (!Array.isArray(candles) || candles.length === 0 || n <= 0) {
    return [];
  }
  if (candles.length <= n) {
    return candles;
  }
  return candles.slice(-n);
}

