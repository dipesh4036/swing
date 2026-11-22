/**
 * Swing Pivot Detection
 * Identifies local price extrema with strict no-lookahead guarantee.
 */
import { PATTERN_PARAMS } from './params.js';

/**
 * Finds confirmed swing highs and lows in a candle series.
 * A pivot at bar i requires k neighbor bars on each side and is confirmed ONLY at bar i + k.
 * Therefore, the last k bars (N-k .. N-1) never serve as confirmed touches.
 *
 * @param {Array<{high: number, low: number, close: number, date: string}>} candles
 * @param {number[]} atrs
 * @param {number} [k=3]
 * @param {number} [prominenceAtr=0.5]
 * @returns {{ highs: Array<{idx: number, price: number, date: string, atr: number}>, lows: Array<{idx: number, price: number, date: string, atr: number}> }}
 */
export function findPivots(
  candles,
  atrs,
  k = PATTERN_PARAMS.pivot_k,
  prominenceAtr = PATTERN_PARAMS.pivot_prominence_atr
) {
  const n = candles.length;
  const highs = [];
  const lows = [];

  // Guard: need at least 2k + 1 bars
  if (n < 2 * k + 1) return { highs, lows };

  // A pivot at bar i can only be confirmed if i + k < n (strictly no lookahead)
  const maxPivotIdx = n - 1 - k;

  for (let i = k; i <= maxPivotIdx; i++) {
    const curHigh = candles[i].high;
    const curLow = candles[i].low;
    const atr = atrs[i] || 1;

    // Check Swing High
    let isHigh = true;
    let minLowInWindow = curLow;
    for (let j = i - k; j <= i + k; j++) {
      if (j !== i && candles[j].high >= curHigh) {
        isHigh = false;
        break;
      }
      if (candles[j].low < minLowInWindow) {
        minLowInWindow = candles[j].low;
      }
    }
    if (isHigh && (curHigh - minLowInWindow) >= prominenceAtr * atr) {
      highs.push({
        idx: i,
        price: curHigh,
        date: candles[i].date,
        atr,
      });
    }

    // Check Swing Low
    let isLow = true;
    let maxHighInWindow = curHigh;
    for (let j = i - k; j <= i + k; j++) {
      if (j !== i && candles[j].low <= curLow) {
        isLow = false;
        break;
      }
      if (candles[j].high > maxHighInWindow) {
        maxHighInWindow = candles[j].high;
      }
    }
    if (isLow && (maxHighInWindow - curLow) >= prominenceAtr * atr) {
      lows.push({
        idx: i,
        price: curLow,
        date: candles[i].date,
        atr,
      });
    }
  }

  return { highs, lows };
}
