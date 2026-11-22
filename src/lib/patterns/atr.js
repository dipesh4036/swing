/**
 * Wilder's Average True Range (ATR)
 * All pattern geometric tolerances and distances are scaled in ATR units.
 */

/**
 * Calculates Wilder's ATR(14) across chronological candles.
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} period Smoothing period (default: 14)
 * @returns {number[]} Array of ATR values aligned with input candles
 */
export function computeATR(candles, period = 14) {
  const n = candles.length;
  if (n === 0) return [];
  const atrs = new Array(n).fill(0);
  const trs = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (i === 0) {
      trs[i] = Math.max(0, c.high - c.low);
    } else {
      const prevClose = candles[i - 1].close;
      trs[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
    }
  }

  // Initial smoothing: average of first 'period' bars
  let sum = 0;
  const initialBars = Math.min(n, period);
  for (let i = 0; i < initialBars; i++) {
    sum += trs[i];
    atrs[i] = sum / (i + 1);
  }

  // Wilder smoothing for subsequent bars
  for (let i = period; i < n; i++) {
    atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
  }

  return atrs;
}
