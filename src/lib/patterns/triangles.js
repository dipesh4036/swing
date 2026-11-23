/**
 * Triangle Pattern Detection
 * Identifies converging upper resistance and lower support formations:
 * Ascending, Descending, and Symmetrical triangles.
 * Implements U8 (status aging, single events), U9 (no-pierce check), U10 (flat drift in ATR).
 */
import { PATTERN_PARAMS } from './params.js';
import { getLinePrice } from './trendlines.js';

export function findTriangles(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const triangles = [];

  const highs = pivots.highs.slice(-25).map((h) => ({ ...h, lnP: Math.log(h.price) }));
  const lows = pivots.lows.slice(-25).map((l) => ({ ...l, lnP: Math.log(l.price) }));

  if (highs.length < 2 || lows.length < 2) return [];

  // Enumerate upper lines
  const upperLines = [];
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const hA = highs[i];
      const hB = highs[j];
      const span = hB.idx - hA.idx;
      if (span < 5 || span > PATTERN_PARAMS.max_span_bars) continue;
      const slope = (hB.lnP - hA.lnP) / span;
      if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) continue;

      // Count touches
      const touches = [];
      const lnHA = hA.lnP;
      for (const h of highs) {
        const expectedP = Math.exp(lnHA + slope * (h.idx - hA.idx));
        if (Math.abs(h.price - expectedP) / (h.atr || 1) <= PATTERN_PARAMS.touch_tol) {
          touches.push(h);
        }
      }
      if (touches.length >= 2) {
        // Pre-validate no-pierce for upper candidate line over upFirst .. upLast
        const upFirst = touches[0].idx;
        const upLast = touches[touches.length - 1].idx;
        let upPierced = false;
        for (let bar = upFirst; bar <= upLast; bar++) {
          const c = candles[bar];
          const barAtr = atrs[bar] || 1;
          const lineP = Math.exp(lnHA + slope * (bar - hA.idx));
          if (c.close - lineP > PATTERN_PARAMS.pierce_tol * barAtr) {
            upPierced = true;
            break;
          }
        }
        if (!upPierced) {
          upperLines.push({ hA, hB, slope, touches, span, upFirst, upLast });
        }
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
      const slope = (lB.lnP - lA.lnP) / span;
      if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) continue;

      const touches = [];
      const lnLA = lA.lnP;
      for (const l of lows) {
        const expectedP = Math.exp(lnLA + slope * (l.idx - lA.idx));
        if (Math.abs(l.price - expectedP) / (l.atr || 1) <= PATTERN_PARAMS.touch_tol) {
          touches.push(l);
        }
      }
      if (touches.length >= 2) {
        // Pre-validate no-pierce for lower candidate line over lowFirst .. lowLast
        const lowFirst = touches[0].idx;
        const lowLast = touches[touches.length - 1].idx;
        let lowPierced = false;
        for (let bar = lowFirst; bar <= lowLast; bar++) {
          const c = candles[bar];
          const barAtr = atrs[bar] || 1;
          const lineP = Math.exp(lnLA + slope * (bar - lA.idx));
          if (lineP - c.close > PATTERN_PARAMS.pierce_tol * barAtr) {
            lowPierced = true;
            break;
          }
        }
        if (!lowPierced) {
          lowerLines.push({ lA, lB, slope, touches, span, lowFirst, lowLast });
        }
      }
    }
  }

  // Pair upper and lower lines
  for (const up of upperLines) {
    for (const low of lowerLines) {
      const upFirst = up.upFirst;
      const upLast = up.upLast;
      const lowFirst = low.lowFirst;
      const lowLast = low.lowLast;

      const startIdx = Math.min(upFirst, lowFirst);
      const endIdx = Math.max(upLast, lowLast);
      const duration = endIdx - startIdx;

      if (duration < PATTERN_PARAMS.triangle_min_duration || duration > PATTERN_PARAMS.triangle_max_duration) {
        continue;
      }

      // Upper and lower lines are already guaranteed unpierced over their own spans.
      const upStartP = getLinePrice(up.hA.idx, up.hA.price, up.slope, upFirst);
      const lowStartP = getLinePrice(low.lA.idx, low.lA.price, low.slope, lowFirst);
      const upEndP = getLinePrice(up.hA.idx, up.hA.price, up.slope, upLast);
      const lowEndP = getLinePrice(low.lA.idx, low.lA.price, low.slope, lowLast);

      const startWidth = getLinePrice(up.hA.idx, up.hA.price, up.slope, startIdx) - getLinePrice(low.lA.idx, low.lA.price, low.slope, startIdx);
      const endWidth = getLinePrice(up.hA.idx, up.hA.price, up.slope, endIdx) - getLinePrice(low.lA.idx, low.lA.price, low.slope, endIdx);

      // Must be converging and positive width
      if (startWidth <= 0 || endWidth <= 0 || endWidth > PATTERN_PARAMS.triangle_end_width_ratio * startWidth) {
        continue;
      }

      // U10: Replace per-bar slope with total drift measured in ATR over drawn span
      const endAtr = atrs[endIdx] || 1;
      const maxDrift = PATTERN_PARAMS.flat_drift_atr * endAtr;

      const upIsFlat = Math.abs(upEndP - upStartP) <= maxDrift;
      const lowIsFlat = Math.abs(lowEndP - lowStartP) <= maxDrift;
      const upIsFalling = upEndP < upStartP - maxDrift;
      const lowIsRising = lowEndP > lowStartP + maxDrift;

      let type = null;
      let title = '';

      if (upIsFlat && lowIsRising) {
        type = 'ascending_triangle';
        title = 'Ascending triangle';
      } else if (lowIsFlat && upIsFalling) {
        type = 'descending_triangle';
        title = 'Descending triangle';
      } else if (upIsFalling && lowIsRising) {
        type = 'symmetrical_triangle';
        title = 'Symmetrical triangle';
      }

      if (!type) continue;

      // Evaluate breakout / breakdown after the first line's last touch (U8, U9)
      const scanStart = Math.min(upLast, lowLast) + 1;
      let broke = false;
      let breakoutIdx = -1;
      let side = 'neutral';
      let piercedAfter = false;

      let breakoutEvent = null;
      let retestEvent = null;
      let closeBackInsideEvent = null;

      for (let bar = scanStart; bar < n; bar++) {
        const c = candles[bar];
        const barAtr = atrs[bar] || 1;
        const curUpP = getLinePrice(up.hA.idx, up.hA.price, up.slope, bar);
        const curLowP = getLinePrice(low.lA.idx, low.lA.price, low.slope, bar);

        if (!broke) {
          if (bar > upLast && c.close > curUpP + PATTERN_PARAMS.breakout_atr * barAtr) {
            broke = true;
            breakoutIdx = bar;
            side = 'resistance';
            breakoutEvent = { type: 'breakout', idx: bar, date: c.date, price: c.close };
          } else if (bar > lowLast && c.close < curLowP - PATTERN_PARAMS.breakout_atr * barAtr) {
            broke = true;
            breakoutIdx = bar;
            side = 'support';
            breakoutEvent = { type: 'breakdown', idx: bar, date: c.date, price: c.close };
          } else {
            // Check piercing before breaking (U9)
            if (bar > upLast && c.close - curUpP > PATTERN_PARAMS.pierce_tol * barAtr) {
              piercedAfter = true;
              break;
            }
            if (bar > lowLast && curLowP - c.close > PATTERN_PARAMS.pierce_tol * barAtr) {
              piercedAfter = true;
              break;
            }
          }
        } else {
          // Check at most 1 retest and at most 1 close_back_inside (U8)
          const targetLineP = side === 'resistance' ? curUpP : curLowP;
          const distToLine = Math.abs(c.close - targetLineP) / barAtr;

          if (!retestEvent && distToLine <= PATTERN_PARAMS.retest_atr) {
            retestEvent = { type: 'retest', idx: bar, date: c.date, price: c.close };
          }

          if (!closeBackInsideEvent) {
            if (side === 'resistance' && c.close < targetLineP) {
              closeBackInsideEvent = { type: 'close_back_inside', idx: bar, date: c.date, price: c.close };
            } else if (side === 'support' && c.close > targetLineP) {
              closeBackInsideEvent = { type: 'close_back_inside', idx: bar, date: c.date, price: c.close };
            }
          }
        }
      }

      if (piercedAfter) continue;

      const events = [];
      if (breakoutEvent) events.push(breakoutEvent);
      if (retestEvent) events.push(retestEvent);
      if (closeBackInsideEvent) events.push(closeBackInsideEvent);

      const lastBarIdx = n - 1;
      const lastClose = candles[lastBarIdx].close;
      const lastAtr = atrs[lastBarIdx] || 1;
      const curUpP = getLinePrice(up.hA.idx, up.hA.price, up.slope, lastBarIdx);
      const curLowP = getLinePrice(low.lA.idx, low.lA.price, low.slope, lastBarIdx);

      let status = 'forming';
      let atrBeyond = 0;

      if (broke) {
        const breakAge = lastBarIdx - breakoutIdx;
        const lineP = side === 'resistance' ? curUpP : curLowP;
        atrBeyond = (lastClose - lineP) / lastAtr;

        if (breakAge > PATTERN_PARAMS.recent_break_bars) {
          status = 'historical';
        } else {
          const stillBeyond = side === 'resistance' ? lastClose >= curUpP : lastClose <= curLowP;
          if (stillBeyond) {
            status = side === 'resistance' ? 'broke_out' : 'broke_down';
          } else {
            status = 'failed_break';
          }
        }
      } else {
        // Unbroken: check max_pattern_age_bars (U8.3)
        const ageSinceEnd = lastBarIdx - endIdx;
        if (ageSinceEnd > PATTERN_PARAMS.max_pattern_age_bars) {
          continue; // Drop pattern if triangle convergence ended > max_pattern_age_bars ago
        }

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
            idx1: upFirst,
            p1: upStartP,
            idx2: upLast,
            p2: upEndP,
            slope: up.slope,
            touches: up.touches.map((t) => ({ idx: t.idx, price: t.price, date: t.date })),
          },
          {
            role: 'lower_support',
            idx1: lowFirst,
            p1: lowStartP,
            idx2: lowLast,
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
