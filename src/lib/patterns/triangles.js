/**
 * Triangle Pattern Detection
 * Identifies converging upper resistance and lower support formations:
 * Ascending, Descending, and Symmetrical triangles.
 */
import { PATTERN_PARAMS } from './params.js';
import { getLinePrice } from './trendlines.js';

export function findTriangles(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const triangles = [];

  const highs = pivots.highs.slice(-25);
  const lows = pivots.lows.slice(-25);

  if (highs.length < 2 || lows.length < 2) return [];

  // Enumerate upper lines
  const upperLines = [];
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const hA = highs[i];
      const hB = highs[j];
      const span = hB.idx - hA.idx;
      if (span < 5 || span > PATTERN_PARAMS.max_span_bars) continue;
      const slope = (Math.log(hB.price) - Math.log(hA.price)) / span;
      if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) continue;

      // Count touches
      const touches = [];
      for (const h of highs) {
        const expectedP = getLinePrice(hA.idx, hA.price, slope, h.idx);
        if (Math.abs(h.price - expectedP) / (h.atr || 1) <= PATTERN_PARAMS.touch_tol) {
          touches.push(h);
        }
      }
      if (touches.length >= 2) {
        upperLines.push({ hA, hB, slope, touches, span });
      }
    }
  }

  // Enumerate lower lines
  const lowerLines = [];
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const lA = lows[i];
      const lB = lows[j];
      const span = lB.idx - lA.idx;
      if (span < 5 || span > PATTERN_PARAMS.max_span_bars) continue;
      const slope = (Math.log(lB.price) - Math.log(lA.price)) / span;
      if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) continue;

      const touches = [];
      for (const l of lows) {
        const expectedP = getLinePrice(lA.idx, lA.price, slope, l.idx);
        if (Math.abs(l.price - expectedP) / (l.atr || 1) <= PATTERN_PARAMS.touch_tol) {
          touches.push(l);
        }
      }
      if (touches.length >= 2) {
        lowerLines.push({ lA, lB, slope, touches, span });
      }
    }
  }

  // Pair upper and lower lines
  for (const up of upperLines) {
    for (const low of lowerLines) {
      const startIdx = Math.min(up.touches[0].idx, low.touches[0].idx);
      const endIdx = Math.max(
        up.touches[up.touches.length - 1].idx,
        low.touches[low.touches.length - 1].idx
      );
      const duration = endIdx - startIdx;

      if (duration < PATTERN_PARAMS.triangle_min_duration || duration > PATTERN_PARAMS.triangle_max_duration) {
        continue;
      }

      const upStartP = getLinePrice(up.hA.idx, up.hA.price, up.slope, startIdx);
      const lowStartP = getLinePrice(low.lA.idx, low.lA.price, low.slope, startIdx);
      const upEndP = getLinePrice(up.hA.idx, up.hA.price, up.slope, endIdx);
      const lowEndP = getLinePrice(low.lA.idx, low.lA.price, low.slope, endIdx);

      const startWidth = upStartP - lowStartP;
      const endWidth = upEndP - lowEndP;

      // Must be converging and positive width
      if (startWidth <= 0 || endWidth <= 0 || endWidth > PATTERN_PARAMS.triangle_end_width_ratio * startWidth) {
        continue;
      }

      // Determine triangle classification
      const flatSlope = PATTERN_PARAMS.flat_slope;
      let type = null;
      let title = '';

      if (Math.abs(up.slope) <= flatSlope && low.slope > flatSlope) {
        type = 'ascending_triangle';
        title = 'Ascending triangle';
      } else if (Math.abs(low.slope) <= flatSlope && up.slope < -flatSlope) {
        type = 'descending_triangle';
        title = 'Descending triangle';
      } else if (up.slope < -flatSlope && low.slope > flatSlope) {
        type = 'symmetrical_triangle';
        title = 'Symmetrical triangle';
      }

      if (!type) continue;

      // Evaluate breakout / breakdown after endIdx
      let broke = false;
      let side = 'neutral';
      const events = [];

      for (let bar = endIdx + 1; bar < n; bar++) {
        const c = candles[bar];
        const barAtr = atrs[bar] || 1;
        const curUpP = getLinePrice(up.hA.idx, up.hA.price, up.slope, bar);
        const curLowP = getLinePrice(low.lA.idx, low.lA.price, low.slope, bar);

        if (!broke) {
          if (c.close > curUpP + PATTERN_PARAMS.breakout_atr * barAtr) {
            broke = true;
            side = 'resistance';
            events.push({ type: 'breakout', idx: bar, date: c.date, price: c.close });
          } else if (c.close < curLowP - PATTERN_PARAMS.breakout_atr * barAtr) {
            broke = true;
            side = 'support';
            events.push({ type: 'breakdown', idx: bar, date: c.date, price: c.close });
          }
        } else {
          // Check retest
          const targetLineP = side === 'resistance' ? curUpP : curLowP;
          const distToLine = Math.abs(c.close - targetLineP) / barAtr;
          if (distToLine <= PATTERN_PARAMS.retest_atr) {
            events.push({ type: 'retest', idx: bar, date: c.date, price: c.close });
          }
          if (side === 'resistance' && c.close < targetLineP) {
            events.push({ type: 'close_back_inside', idx: bar, date: c.date, price: c.close });
          } else if (side === 'support' && c.close > targetLineP) {
            events.push({ type: 'close_back_inside', idx: bar, date: c.date, price: c.close });
          }
        }
      }

      const lastClose = candles[n - 1].close;
      const lastAtr = atrs[n - 1] || 1;
      const curUpP = getLinePrice(up.hA.idx, up.hA.price, up.slope, n - 1);
      const curLowP = getLinePrice(low.lA.idx, low.lA.price, low.slope, n - 1);

      let status = 'forming';
      let atrBeyond = 0;

      if (broke) {
        status = side === 'resistance' ? 'broke_out' : 'broke_down';
        const lineP = side === 'resistance' ? curUpP : curLowP;
        atrBeyond = (lastClose - lineP) / lastAtr;
      } else {
        const distUp = Math.abs(lastClose - curUpP) / lastAtr;
        const distLow = Math.abs(lastClose - curLowP) / lastAtr;
        if (distUp <= PATTERN_PARAMS.at_line_atr || distLow <= PATTERN_PARAMS.at_line_atr) {
          status = 'at_line';
        }
        atrBeyond = (lastClose - (curUpP + curLowP) / 2) / lastAtr;
      }

      triangles.push({
        id: `${type}_${startIdx}_${endIdx}`,
        type,
        side: side === 'neutral' ? 'both' : side,
        status,
        title,
        lines: [
          {
            role: 'upper_resistance',
            idx1: up.hA.idx,
            p1: up.hA.price,
            idx2: endIdx,
            p2: upEndP,
            slope: up.slope,
            touches: up.touches.map((t) => ({ idx: t.idx, price: t.price, date: t.date })),
          },
          {
            role: 'lower_support',
            idx1: low.lA.idx,
            p1: low.lA.price,
            idx2: endIdx,
            p2: lowEndP,
            slope: low.slope,
            touches: low.touches.map((t) => ({ idx: t.idx, price: t.price, date: t.date })),
          },
        ],
        band: { half_width_atr: PATTERN_PARAMS.retest_band_half_width_atr },
        events,
        window: {
          start_date: candles[startIdx].date,
          end_date: candles[endIdx].date,
          found_date: candles[n - 1].date,
        },
        metrics: {
          touches: up.touches.length + low.touches.length,
          atr_beyond: Number(atrBeyond.toFixed(2)),
          span_bars: duration,
        },
      });
    }
  }

  // Deduplicate overlapping triangles
  triangles.sort((a, b) => b.metrics.touches - a.metrics.touches || b.metrics.span_bars - a.metrics.span_bars);
  return triangles.slice(0, 2);
}
