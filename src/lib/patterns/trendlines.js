/**
 * Sloped Trendline Pattern Detection
 * Identifies resistance and support trendlines in ln(price) space.
 */
import { PATTERN_PARAMS } from './params.js';

/**
 * Evaluates line price in linear space from ln-space slope and intercept.
 */
export function getLinePrice(idx1, p1, slope, targetIdx) {
  const lnP1 = Math.log(p1);
  const targetLn = lnP1 + slope * (targetIdx - idx1);
  return Math.exp(targetLn);
}

/**
 * Evaluates breakout, retest, and back-inside events for a sloped line.
 */
function evaluateSlopedEvents(candles, atrs, idx1, p1, slope, side, lastTouchIdx) {
  const n = candles.length;
  const events = [];
  let broke = false;
  let breakoutIdx = -1;
  const isResistance = side === 'resistance';

  for (let i = lastTouchIdx + 1; i < n; i++) {
    const c = candles[i];
    const atr = atrs[i] || 1;
    const linePrice = getLinePrice(idx1, p1, slope, i);
    const diff = c.close - linePrice;

    if (!broke) {
      if (isResistance && diff > PATTERN_PARAMS.breakout_atr * atr) {
        broke = true;
        breakoutIdx = i;
        events.push({
          type: 'breakout',
          idx: i,
          date: c.date,
          price: c.close,
        });
      } else if (!isResistance && diff < -PATTERN_PARAMS.breakout_atr * atr) {
        broke = true;
        breakoutIdx = i;
        events.push({
          type: 'breakdown',
          idx: i,
          date: c.date,
          price: c.close,
        });
      }
    } else {
      const distToLine = Math.abs(c.close - linePrice) / atr;
      const extremumDist = isResistance
        ? Math.abs(c.low - linePrice) / atr
        : Math.abs(c.high - linePrice) / atr;

      if (distToLine <= PATTERN_PARAMS.retest_atr || extremumDist <= PATTERN_PARAMS.retest_atr) {
        events.push({
          type: 'retest',
          idx: i,
          date: c.date,
          price: c.close,
        });
      }

      if (isResistance && c.close < linePrice) {
        events.push({
          type: 'close_back_inside',
          idx: i,
          date: c.date,
          price: c.close,
        });
      } else if (!isResistance && c.close > linePrice) {
        events.push({
          type: 'close_back_inside',
          idx: i,
          date: c.date,
          price: c.close,
        });
      }
    }
  }

  return { broke, breakoutIdx, events };
}

/**
 * Finds sloped trendline patterns.
 * @param {Array<{open: number, high: number, low: number, close: number, date: string}>} candles
 * @param {number[]} atrs
 * @param {{ highs: Array<{idx: number, price: number, date: string, atr: number}>, lows: Array<{idx: number, price: number, date: string, atr: number}> }} pivots
 * @returns {Array<object>} Detected trendlines
 */
export function findTrendlines(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const candidatePatterns = [];

  const sides = [
    { name: 'resistance', type: 'sloped_resistance', title: 'Resistance trendline', points: pivots.highs },
    { name: 'support', type: 'sloped_support', title: 'Support trendline', points: pivots.lows },
  ];

  for (const { name: side, type, title, points } of sides) {
    if (points.length < PATTERN_PARAMS.min_touches) continue;

    // Cap points to 30 most recent
    const activePoints = points.slice(-30);
    const validLines = [];
    const isResistance = side === 'resistance';

    for (let i = 0; i < activePoints.length; i++) {
      for (let j = i + 1; j < activePoints.length; j++) {
        const pA = activePoints[i];
        const pB = activePoints[j];
        const spanBars = pB.idx - pA.idx;

        if (spanBars < PATTERN_PARAMS.min_span_bars || spanBars > PATTERN_PARAMS.max_span_bars) {
          continue;
        }

        const slope = (Math.log(pB.price) - Math.log(pA.price)) / spanBars;
        if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) {
          continue;
        }

        // Check piercing between pA.idx and pB.idx
        let pierced = false;
        let nearPierces = 0;

        for (let bar = pA.idx; bar <= pB.idx; bar++) {
          const c = candles[bar];
          const barAtr = atrs[bar] || 1;
          const lineP = getLinePrice(pA.idx, pA.price, slope, bar);

          if (isResistance) {
            const diff = c.close - lineP;
            if (diff > PATTERN_PARAMS.pierce_tol * barAtr) {
              pierced = true;
              break;
            } else if (diff > 0) {
              nearPierces++;
            }
          } else {
            const diff = lineP - c.close;
            if (diff > PATTERN_PARAMS.pierce_tol * barAtr) {
              pierced = true;
              break;
            } else if (diff > 0) {
              nearPierces++;
            }
          }
        }

        if (pierced) continue;

        // Count touches across all activePoints
        const touches = [];
        for (const pt of activePoints) {
          const expectedP = getLinePrice(pA.idx, pA.price, slope, pt.idx);
          const distAtr = Math.abs(pt.price - expectedP) / (pt.atr || 1);
          if (distAtr <= PATTERN_PARAMS.touch_tol) {
            touches.push(pt);
          }
        }

        // Filter touches to ensure at least min_bars_between_touches
        const spacedTouches = [];
        for (const t of touches) {
          if (spacedTouches.length === 0 || t.idx - spacedTouches[spacedTouches.length - 1].idx >= PATTERN_PARAMS.min_bars_between_touches) {
            spacedTouches.push(t);
          }
        }

        if (spacedTouches.length >= PATTERN_PARAMS.min_touches) {
          const firstTouch = spacedTouches[0];
          const lastTouch = spacedTouches[spacedTouches.length - 1];

          validLines.push({
            pA,
            pB,
            slope,
            firstTouch,
            lastTouch,
            touches: spacedTouches,
            nearPierces,
            spanBars: lastTouch.idx - firstTouch.idx,
          });
        }
      }
    }

    if (validLines.length === 0) continue;

    // Rank candidate lines: more touches, longer span, fewer near-pierces
    validLines.sort((a, b) => {
      if (b.touches.length !== a.touches.length) {
        return b.touches.length - a.touches.length;
      }
      if (b.spanBars !== a.spanBars) {
        return b.spanBars - a.spanBars;
      }
      return a.nearPierces - b.nearPierces;
    });

    // Keep the best non-overlapping lines
    const kept = [];
    for (const line of validLines) {
      const overlaps = kept.some((k) => {
        const overlapStart = Math.max(k.firstTouch.idx, line.firstTouch.idx);
        const overlapEnd = Math.min(k.lastTouch.idx, line.lastTouch.idx);
        if (overlapEnd <= overlapStart) return false;
        const overlapLen = overlapEnd - overlapStart;
        return overlapLen / Math.min(k.spanBars, line.spanBars) >= PATTERN_PARAMS.line_overlap_threshold;
      });

      if (!overlaps) {
        kept.push(line);
        if (kept.length >= 2) break;
      }
    }

    for (const line of kept) {
      const { firstTouch, lastTouch, slope, touches } = line;
      const { broke, events } = evaluateSlopedEvents(
        candles,
        atrs,
        firstTouch.idx,
        firstTouch.price,
        slope,
        side,
        lastTouch.idx
      );

      const lastClose = candles[n - 1].close;
      const lastAtr = atrs[n - 1] || 1;
      const currentLinePrice = getLinePrice(firstTouch.idx, firstTouch.price, slope, n - 1);
      const diffAtr = (lastClose - currentLinePrice) / lastAtr;

      let status = 'forming';
      if (broke) {
        status = isResistance ? 'broke_out' : 'broke_down';
      } else if (Math.abs(diffAtr) <= PATTERN_PARAMS.at_line_atr) {
        status = 'at_line';
      }

      candidatePatterns.push({
        id: `${type}_${firstTouch.idx}_${lastTouch.idx}`,
        type,
        side,
        status,
        title: `${title} ×${touches.length}`,
        lines: [
          {
            role: side,
            idx1: firstTouch.idx,
            p1: firstTouch.price,
            idx2: lastTouch.idx,
            p2: getLinePrice(firstTouch.idx, firstTouch.price, slope, lastTouch.idx),
            slope,
            touches: touches.map((t) => ({ idx: t.idx, price: t.price, date: t.date })),
          },
        ],
        band: { half_width_atr: PATTERN_PARAMS.retest_band_half_width_atr },
        events,
        window: {
          start_date: candles[firstTouch.idx].date,
          end_date: candles[lastTouch.idx].date,
          found_date: candles[n - 1].date,
        },
        metrics: {
          touches: touches.length,
          atr_beyond: Number(diffAtr.toFixed(2)),
          span_bars: line.spanBars,
        },
      });
    }
  }

  return candidatePatterns;
}
